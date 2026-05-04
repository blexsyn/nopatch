import fs from "fs";
import path from "path";
import Mustache from "mustache";
import toml from "toml";
import { error, log, isBinary } from "./utils.js";

const NOPATCH_DIR = "nopatch";
const TPL_RECORD_DIR = "tpl_record";
const TPL_CONFIG_DIR = "tpl_config";

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

function collectPlanDirs(nopatchRoot) {
  const tplRoot = path.join(nopatchRoot, TPL_RECORD_DIR);
  const cfgRoot = path.join(nopatchRoot, TPL_CONFIG_DIR);
  if (!fs.existsSync(tplRoot)) return [];

  const results = [];

  for (const entry of fs.readdirSync(tplRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const planName = entry.name;
    const configPath = path.join(cfgRoot, `${planName}.toml`);
    results.push({
      planName,
      tplDir: path.join(tplRoot, planName),
      configPath,
    });
  }

  return results;
}

function loadPlanConfig(configPath) {
  if (!fs.existsSync(configPath)) {
    console.log(`No config found at ${configPath}, using defaults`);
    return { vars: {}, outputBase: ".", dynaPaths: [] };
  }

  try {
    const parsed = toml.parse(fs.readFileSync(configPath, "utf8"));
    return {
      vars: parsed.vars || {},
      outputBase: (parsed.output_base || ".").replace(/^[\/\\]+/, ""),
      dynaPaths: parsed.dyna_file_path || [],
    };
  } catch (e) {
    error(`Error: Failed to parse ${configPath}: ${e.message}`);
    process.exit(1);
  }
}

function renderPath(str, vars) {
  const noEscape = str.replace(/\{\{([^{])/g, "{{{$1").replace(/([^}])\}\}/g, "$1}}}");
  return Mustache.render(noEscape, vars);
}

function resolveDestPath(dest, destRoot, destAbs, vars, outputBaseDir) {
  const paths = [];
  if (dest) {
    const rendered = renderPath(dest, vars);
    const resolved = path.resolve(outputBaseDir, rendered);
    log(`dest: "${dest}" -> rendered: "${rendered}" -> resolved: "${resolved}"`);
    paths.push(resolved);
  }
  if (destRoot) {
    const rendered = renderPath(destRoot, vars);
    const resolved = path.resolve(outputBaseDir, rendered);
    log(`destRoot: "${destRoot}" -> rendered: "${rendered}" -> resolved: "${resolved}"`);
    paths.push(resolved);
  }
  if (destAbs) {
    const rendered = renderPath(destAbs, vars);
    const resolved = path.resolve(rendered);
    log(`destAbs: "${destAbs}" -> rendered: "${rendered}" -> resolved: "${resolved}"`);
    paths.push(resolved);
  }
  return paths;
}

export function tplVerify(planName) {
  const nopatchRoot = path.join(process.cwd(), NOPATCH_DIR);
  const tplDir = path.join(nopatchRoot, TPL_RECORD_DIR, planName);
  const configPath = path.join(nopatchRoot, TPL_CONFIG_DIR, `${planName}.toml`);

  if (!fs.existsSync(tplDir)) {
    error(`Error: Template plan not found: ${planName}`);
    error(`   Expected directory: ${tplDir}`);
    process.exit(1);
  }

  if (!fs.existsSync(configPath)) {
    error(`Error: Config not found: ${configPath}`);
    process.exit(1);
  }

  let parsed;
  try {
    parsed = toml.parse(fs.readFileSync(configPath, "utf8"));
  } catch (e) {
    error(`Error: Failed to parse ${configPath}: ${e.message}`);
    process.exit(1);
  }

  const vars = parsed.vars || {};
  const outputBase = (parsed.output_base || ".").replace(/^[\/\\]+/, "");
  const dynaPaths = parsed.dyna_file_path || [];
  const outputBaseDir = path.resolve(process.cwd(), outputBase);

  let errors = 0;
  let warnings = 0;

  const tplFiles = collectFiles(tplDir);
  const tplFileSet = new Set(tplFiles);

  for (const entry of dynaPaths) {
    if (!entry.src) {
      error(`  Error: [[dyna_file_path]] missing 'src' field`);
      errors++;
      continue;
    }

    if (!tplFileSet.has(entry.src)) {
      error(`  Error: [[dyna_file_path]] src not found: ${entry.src}`);
      errors++;
    }

    if (!entry.dest && !entry.destRoot && !entry.destAbs) {
      error(`  Error: [[dyna_file_path]] for '${entry.src}' has no dest, destRoot or destAbs`);
      errors++;
    }

    try {
      resolveDestPath(entry.dest, entry.destRoot, entry.destAbs, vars, outputBaseDir);
    } catch (e) {
      error(`  Error: Path resolution failed for '${entry.src}': ${e.message}`);
      errors++;
    }
  }

  for (const relFile of tplFiles) {
    const srcFile = path.join(tplDir, relFile);
    const isMustache = relFile.endsWith(".mustache");

    if (isMustache) {
      try {
        const content = fs.readFileSync(srcFile, "utf8");
        const usedVars = new Set();
        const re = /\{\{(\w+)\}\}/g;
        let m;
        while ((m = re.exec(content)) !== null) {
          usedVars.add(m[1]);
        }

        for (const v of usedVars) {
          if (!(v in vars)) {
            console.log(`  Warning: variable '{{${v}}}' used in '${relFile}' but not declared in [vars]`);
            warnings++;
          }
        }
      } catch (e) {
        error(`  Error: Failed to read '${relFile}': ${e.message}`);
        errors++;
      }
    }
  }

  if (errors === 0 && warnings === 0) {
    console.log(`tpl: plan "${planName}" verified OK`);
  } else {
    console.log(`tpl: plan "${planName}" verified with ${errors} error(s), ${warnings} warning(s)`);
    if (errors > 0) process.exit(1);
  }
}

export default async function applyTemplate(targetPlan) {
  const nopatchRoot = path.join(process.cwd(), NOPATCH_DIR);
  const cwd = process.cwd();
  log(`cwd: ${cwd}`);

  let plans = collectPlanDirs(nopatchRoot);

  if (plans.length === 0) {
    log("No template plans found, skipping");
    return;
  }

  log(`Found ${plans.length} template plan(s): ${plans.map(p => p.planName).join(", ")}`);

  if (targetPlan) {
    plans = plans.filter((p) => p.planName === targetPlan);
    if (plans.length === 0) {
      error(`Error: No templates found for plan: ${targetPlan}`);
      process.exit(1);
    }
  }

  let applyCount = 0;

  for (const { planName, tplDir, configPath } of plans) {
    const { vars, outputBase, dynaPaths } = loadPlanConfig(configPath);
    const outputBaseDir = path.resolve(cwd, outputBase);

    const dynaMap = new Map();
    for (const entry of dynaPaths) {
      if (!entry.src) {
        error(`Error: [[dyna_file_path]] missing 'src' field in plan "${planName}"`);
        continue;
      }
      const destPaths = resolveDestPath(entry.dest, entry.destRoot, entry.destAbs, vars, outputBaseDir);
      if (destPaths.length === 0) {
        error(`Error: [[dyna_file_path]] for '${entry.src}' has no dest, destRoot or destAbs`);
        continue;
      }
      if (!dynaMap.has(entry.src)) dynaMap.set(entry.src, []);
      dynaMap.get(entry.src).push(...destPaths.map(p => ({ path: p, overwrite: entry.overwrite !== false })));
    }

    const tplFiles = collectFiles(tplDir);

    for (const relFile of tplFiles) {
      const srcFile = path.join(tplDir, relFile);
      const isMustache = relFile.endsWith(".mustache");
      const relOutput = isMustache ? relFile.slice(0, -".mustache".length) : relFile;

      let destEntries;
      if (dynaMap.has(relFile)) {
        destEntries = dynaMap.get(relFile);
      } else {
        destEntries = [{ path: path.join(outputBaseDir, relOutput), overwrite: true }];
      }

      const buf = fs.readFileSync(srcFile);
      const binary = isBinary(buf);

      for (const { path: destPath, overwrite } of destEntries) {
        if (!overwrite && fs.existsSync(destPath)) {
          console.log(`  [SKIP] ${relFile} (skip, target exists)`);
          continue;
        }

        fs.mkdirSync(path.dirname(destPath), { recursive: true });

        if (binary || !isMustache) {
          fs.copyFileSync(srcFile, destPath);
          console.log(`  [ADD] ${relFile}`);
          console.log(`      -> ${destPath}`);
        } else {
          const content = buf.toString("utf8");
          Mustache.escape = (v) => v;
          const rendered = Mustache.render(content, vars);
          fs.writeFileSync(destPath, rendered, "utf8");
          console.log(`  [MOD] ${relFile}`);
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
