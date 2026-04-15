import fs from "fs";
import path from "path";
import Mustache from "mustache";
import toml from "toml";
import { error, log, isBinary } from "./utils.js";

const NOPATCH_DIR = "nopatch";
const TPL_RECORD_DIR = "tpl_record";
const TPL_CONFIG_DIR = "tpl_config";

// 递归收集目录下所有文件相对路径
function collectFiles(dir, base = dir, result = []) {
  if (!fs.existsSync(dir)) return result;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectFiles(full, base, result);
    } else {
      result.push(path.relative(base, full).replace(/\\/g, "/"));
    }
  }
  return result;
}

// 枚举 tpl_record 下所有包目录，返回 { pkgName, version, tplDir, configDir }
function collectPkgDirs(nopatchRoot) {
  const tplRoot = path.join(nopatchRoot, TPL_RECORD_DIR);
  const cfgRoot = path.join(nopatchRoot, TPL_CONFIG_DIR);
  if (!fs.existsSync(tplRoot)) return [];

  const results = [];

  for (const entry of fs.readdirSync(tplRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;

    if (entry.name.startsWith("@")) {
      // scoped: tpl_record/@scope/pkg+ver/
      const scopeDir = path.join(tplRoot, entry.name);
      for (const sub of fs.readdirSync(scopeDir, { withFileTypes: true })) {
        if (!sub.isDirectory()) continue;
        const lastPlus = sub.name.lastIndexOf("+");
        const pkg = sub.name.slice(0, lastPlus);
        const version = sub.name.slice(lastPlus + 1);
        results.push({
          pkgName: `${entry.name}/${pkg}`,
          version,
          tplDir: path.join(scopeDir, sub.name),
          configDir: path.join(cfgRoot, entry.name, sub.name),
        });
      }
    } else {
      const lastPlus = entry.name.lastIndexOf("+");
      const pkg = entry.name.slice(0, lastPlus);
      const version = entry.name.slice(lastPlus + 1);
      results.push({
        pkgName: pkg,
        version,
        tplDir: path.join(tplRoot, entry.name),
        configDir: path.join(cfgRoot, entry.name),
      });
    }
  }

  return results;
}

// 解析 data.toml，返回 { vars, dynaPaths }
function loadDataToml(configDir) {
  const dataPath = path.join(configDir, "data.toml");
  if (!fs.existsSync(dataPath)) {
    log(`No data.toml found in ${configDir}, using defaults`);
    return { vars: {}, dynaPaths: [] };
  }

  try {
    const parsed = toml.parse(fs.readFileSync(dataPath, "utf8"));
    return {
      vars: parsed.vars || {},
      dynaPaths: parsed.dyna_file_path || [],
    };
  } catch (e) {
    error(`❌ Failed to parse ${dataPath}: ${e.message}`);
    process.exit(1);
  }
}

// 用 vars 渲染路径字符串中的 Mustache 变量
// 路径不需要 HTML 转义，使用 triple-stache 语义：关闭转义
function renderPath(str, vars) {
  // 将所有 {{var}} 替换为 {{{var}}} 再渲染，避免 / 被转义为 &#x2F;
  const noEscape = str.replace(/\{\{([^{])/g, "{{{$1").replace(/([^}])\}\}/g, "$1}}}");
  return Mustache.render(noEscape, vars);
}

// 将路径字符串规范化为绝对路径
// dest: 相对于 cwd；destAbs: 操作系统绝对路径
function resolveDestPath(dest, destRoot, destAbs, vars, cwd, pkgDir) {
  const paths = [];
  if (dest) {
    const rendered = renderPath(dest, vars);
    const resolved = path.resolve(cwd, rendered);
    log(`dest: "${dest}" → rendered: "${rendered}" → resolved: "${resolved}"`);
    paths.push(resolved);
  }
  if (destRoot) {
    const rendered = renderPath(destRoot, vars);
    // destRoot 基准是 node_modules/<pkg>/
    const resolved = path.resolve(pkgDir, rendered);
    log(`destRoot: "${destRoot}" → rendered: "${rendered}" → resolved: "${resolved}"`);
    paths.push(resolved);
  }
  if (destAbs) {
    const rendered = renderPath(destAbs, vars);
    const resolved = path.resolve(rendered);
    log(`destAbs: "${destAbs}" → rendered: "${rendered}" → resolved: "${resolved}"`);
    paths.push(resolved);
  }
  return paths;
}

export default async function applyTemplate(targetPkg) {
  const nopatchRoot = path.join(process.cwd(), NOPATCH_DIR);
  const cwd = process.cwd();
  log(`cwd: ${cwd}`);

  let pkgDirs = collectPkgDirs(nopatchRoot);

  if (pkgDirs.length === 0) {
    log("No template directories found, skipping");
    return;
  }

  log(`Found ${pkgDirs.length} template package(s): ${pkgDirs.map(p => p.pkgName).join(", ")}`);

  if (targetPkg) {
    pkgDirs = pkgDirs.filter((p) => p.pkgName === targetPkg);
    if (pkgDirs.length === 0) {
      error(`❌ No templates found for: ${targetPkg}`);
      process.exit(1);
    }
  }

  let applyCount = 0;

  for (const { pkgName, version, tplDir, configDir } of pkgDirs) {
    const pkgDir = path.join(cwd, "node_modules", pkgName);

    if (!fs.existsSync(pkgDir)) {
      console.log(`  [skip] ${pkgName}@${version} not installed`);
      continue;
    }

    const { vars, dynaPaths } = loadDataToml(configDir);

    // 建立 src → [destPaths] 的映射（来自 dyna_file_path）
    const dynaMap = new Map();
    for (const entry of dynaPaths) {
      if (!entry.src) {
        error(`❌ [[dyna_file_path]] missing 'src' field in ${pkgName}`);
        continue;
      }
      const destPaths = resolveDestPath(entry.dest, entry.destRoot, entry.destAbs, vars, cwd, pkgDir);
      if (destPaths.length === 0) {
        error(`❌ [[dyna_file_path]] for '${entry.src}' has no dest or destAbs`);
        continue;
      }
      if (!dynaMap.has(entry.src)) dynaMap.set(entry.src, []);
      dynaMap.get(entry.src).push(...destPaths.map(p => ({ path: p, overwrite: entry.overwrite !== false })));
    }

    // 收集所有模板文件
    const tplFiles = collectFiles(tplDir);

    for (const relFile of tplFiles) {
      const srcFile = path.join(tplDir, relFile);
      const isMustache = relFile.endsWith(".mustache");
      // 输出文件名：去掉 .mustache 后缀
      const relOutput = isMustache ? relFile.slice(0, -".mustache".length) : relFile;

      // 确定输出路径列表
      let destEntries;
      if (dynaMap.has(relFile)) {
        destEntries = dynaMap.get(relFile);
      } else {
        // 默认：输出到 node_modules/<pkg>/ 对应路径，默认覆盖
        destEntries = [{ path: path.join(pkgDir, relOutput), overwrite: true }];
      }

      const buf = fs.readFileSync(srcFile);
      const binary = isBinary(buf);

      for (const { path: destPath, overwrite } of destEntries) {
        // overwrite=false 且目标已存在则跳过
        // skip if overwrite is false and target already exists
        if (!overwrite && fs.existsSync(destPath)) {
          console.log(`  [=] ${relFile} (skip, target exists)`);
          continue;
        }

        fs.mkdirSync(path.dirname(destPath), { recursive: true });

        if (binary || !isMustache) {
          fs.copyFileSync(srcFile, destPath);
          console.log(`  [>] ${relFile}`);
          console.log(`      -> ${destPath}`);
        } else {
          const content = buf.toString("utf8");
          Mustache.escape = (v) => v;
          const rendered = Mustache.render(content, vars);
          fs.writeFileSync(destPath, rendered, "utf8");
          console.log(`  [~] ${relFile}`);
          console.log(`      -> ${destPath}`);
        }
        applyCount++;
      }
    }
  }

  if (applyCount > 0) {
    console.log(`tpl: ${applyCount} applied`);
  }
}
