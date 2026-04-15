import fs from "fs";
import path from "path";
import os from "os";
import simpleGit from "simple-git";
import { error, log, isBinary, MAX_DIFF_SIZE, loadIgnore } from "./utils.js";

const NOPATCH_DIR = "nopatch";
const RECORD_DIR = "nopatch_record";
const IGNORE_CONFIG_DIR = "nopatch_ignore";

// 补丁记录目录：scoped 包保留真实目录层级
// @yarnpkg/lockfile@1.1.0 → modify_record/@yarnpkg/lockfile+1.1.0/
// braces@3.0.3            → modify_record/braces+3.0.3/
function pkgRecordDir(recordRoot, name, version) {
  if (name.startsWith("@")) {
    const [scope, pkg] = name.split("/");
    return path.join(recordRoot, scope, `${pkg}+${version}`);
  }
  return path.join(recordRoot, `${name}+${version}`);
}

// ignore_config 路径：scoped 包保留目录层级
// @yarnpkg/lockfile@1.1.0 → ignore_config/@yarnpkg/lockfile+1.1.0.gitignore
// braces@3.0.3            → ignore_config/braces+3.0.3.gitignore
function pkgIgnorePath(ignoreConfigDir, name, version) {
  if (name.startsWith("@")) {
    const [scope, pkg] = name.split("/");
    return path.join(ignoreConfigDir, scope, `${pkg}+${version}.gitignore`);
  }
  return path.join(ignoreConfigDir, `${name}+${version}.gitignore`);
}

// 递归收集目录下所有文件的相对路径（支持 ignore 规则）
function collectFiles(dir, base = dir, ig = null, result = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = path.relative(base, path.join(dir, entry.name)).replace(/\\/g, "/");
    if (ig && ig.ignores(entry.isDirectory() ? rel + "/" : rel)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectFiles(full, base, ig, result);
    } else {
      result.push(rel);
    }
  }
  return result;
}

// 用 git diff 生成单文件 patch 文本
async function diffFile(originalFile, modifiedFile) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "nopatch-"));
  const aFile = path.join(tmpDir, "a");

  fs.copyFileSync(originalFile, aFile);

  const git = simpleGit();
  await git
    .cwd({ path: tmpDir, root: true })
    .init()
    .addConfig("user.name", "nopatch", false, "local")
    .addConfig("user.email", "no@patch", false, "local")
    .addConfig("core.autocrlf", false, false, "local")
    .addConfig("commit.gpgsign", false, false, "local")
    .add(["-f", "a"])
    .commit(["--allow-empty", "-m", "init"]);

  fs.copyFileSync(modifiedFile, aFile);
  await git.add(["-f", "a"]);

  const diff = await git.diff([
    "--staged",
    "-U99999",          // 包含足够多的上下文行，确保 IDE 能显示完整文件
    "--ignore-space-at-eol",
    "--no-ext-diff",
    "--src-prefix=a/",
    "--dst-prefix=b/",
  ]);

  fs.rmSync(tmpDir, { recursive: true, force: true });
  return diff;
}

// 初始化 ignore_config 文件（如不存在则创建）
function ensureIgnoreConfig(ignoreConfigDir, name, version) {
  const ignoreFile = pkgIgnorePath(ignoreConfigDir, name, version);
  fs.mkdirSync(path.dirname(ignoreFile), { recursive: true });
  if (!fs.existsSync(ignoreFile)) {
    fs.writeFileSync(
      ignoreFile,
      [
        "# nopatch ignore config — same syntax as .gitignore",
        "node_modules/",
        "build/",
        "dist/",
        ".cache/",
        "coverage/",
        "*.log",
      ].join("\n") + "\n"
    );
  }
  return ignoreFile;
}

export default async function createPatch(packageName) {
  const pkgJsonPath = path.join(process.cwd(), "node_modules", packageName, "package.json");
  if (!fs.existsSync(pkgJsonPath)) {
    error(`❌ Package not found: node_modules/${packageName}`);
    process.exit(1);
  }

  const pkgVersion = JSON.parse(fs.readFileSync(pkgJsonPath, "utf8")).version;
  const pkgDir = path.join(process.cwd(), "node_modules", packageName);

  console.log(`patch: creating ${packageName}@${pkgVersion}`);

  const nopatchRoot = path.join(process.cwd(), NOPATCH_DIR);
  const recordRoot = pkgRecordDir(path.join(nopatchRoot, RECORD_DIR), packageName, pkgVersion);
  const ignoreConfigDir = path.join(nopatchRoot, IGNORE_CONFIG_DIR);
  const ignoreFile = ensureIgnoreConfig(ignoreConfigDir, packageName, pkgVersion);
  const ig = loadIgnore(ignoreFile);

  // 从 npm cache 获取原始包
  const { execSync } = await import("child_process");
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "nopatch-orig-"));

  try {
    execSync(
      `npm pack ${packageName}@${pkgVersion} --pack-destination "${tmpDir}" --prefer-offline`,
      { stdio: "pipe" }
    );
  } catch (e) {
    error("❌ Failed to get original package via npm pack");
    error(e.stderr?.toString() || e.message);
    process.exit(1);
  }

  const tgzFile = fs.readdirSync(tmpDir).find((f) => f.endsWith(".tgz"));
  if (!tgzFile) {
    error("❌ npm pack did not produce a .tgz file");
    process.exit(1);
  }

  const origDir = path.join(tmpDir, "package");
  execSync(`tar -xzf "${path.join(tmpDir, tgzFile)}" -C "${tmpDir}"`, { stdio: "pipe" });

  const modifiedFiles = new Set(collectFiles(pkgDir, pkgDir, ig));
  const originalFiles = new Set(collectFiles(origDir, origDir, ig));
  const allFiles = new Set([...modifiedFiles, ...originalFiles]);

  // 清理旧补丁记录
  if (fs.existsSync(recordRoot)) {
    fs.rmSync(recordRoot, { recursive: true, force: true });
  }
  fs.mkdirSync(recordRoot, { recursive: true });

  const now = new Date().toISOString();
  let patchCount = 0;

  for (const relFile of allFiles) {
    const origFile = path.join(origDir, relFile);
    const modFile = path.join(pkgDir, relFile);
    const outDir = path.join(recordRoot, path.dirname(relFile));
    const baseName = path.basename(relFile);
    const origExt = path.extname(baseName); // 原始后缀，如 .png .js

    const origExists = originalFiles.has(relFile);
    const modExists = modifiedFiles.has(relFile);

    // 文件被删除 → .nopatch_delete 标记（内容为时间戳 / deleted file marker with timestamp）
    if (origExists && !modExists) {
      fs.mkdirSync(outDir, { recursive: true });
      fs.writeFileSync(path.join(outDir, `${baseName}.nopatch_delete`), now);
      console.log(`  [-] ${relFile}`);
      patchCount++;
      continue;
    }

    if (modExists) {
      const buf = fs.readFileSync(modFile);
      const isBig = isBinary(buf) || buf.length > MAX_DIFF_SIZE;

      if (!origExists) {
        // 新增文件
        fs.mkdirSync(outDir, { recursive: true });
        if (isBig) {
          // 二进制/大文件：.nopatch_latest.<原后缀> / binary or large file, copy as-is
          fs.copyFileSync(modFile, path.join(outDir, `${baseName}.nopatch_latest${origExt}`));
          console.log(`  [>] ${relFile} (binary/large, new)`);
          patchCount++;
        } else {
          const emptyTmp = path.join(os.tmpdir(), `nopatch-empty-${Date.now()}`);
          fs.writeFileSync(emptyTmp, "");
          const diff = await diffFile(emptyTmp, modFile);
          fs.unlinkSync(emptyTmp);
          if (diff.trim()) {
            fs.writeFileSync(path.join(outDir, `${baseName}.patch`), diff);
            console.log(`  [+] ${relFile} (new file)`);
            patchCount++;
          }
        }
        continue;
      }

      // 两边都有，检查变化
      const origBuf = fs.readFileSync(origFile);
      if (origBuf.equals(buf)) continue;

      fs.mkdirSync(outDir, { recursive: true });

      if (isBig || isBinary(origBuf) || origBuf.length > MAX_DIFF_SIZE) {
        fs.copyFileSync(modFile, path.join(outDir, `${baseName}.nopatch_latest${origExt}`));
        console.log(`  [>] ${relFile} (binary/large, modified)`);
        patchCount++;
      } else {
        const diff = await diffFile(origFile, modFile);
        if (diff.trim()) {
          fs.writeFileSync(path.join(outDir, `${baseName}.patch`), diff);
          console.log(`  [~] ${relFile}`);
          patchCount++;
        }
      }
    }
  }

  fs.rmSync(tmpDir, { recursive: true, force: true });

  if (patchCount === 0) {
    console.log(`patch: no changes detected for ${packageName}`);
    fs.rmSync(recordRoot, { recursive: true, force: true });
  } else {
    console.log(`patch: ${packageName}@${pkgVersion} done (${patchCount} file(s))`);
  }
}
