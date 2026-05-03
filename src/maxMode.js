import fs from "fs";
import path from "path";
import toml from "toml";
import { error, log } from "./utils.js";

const NOPATCH_DIR = "nopatch";
const MAX_CONFIG_DIR = "max_mode_config";
const MAX_DATA_DIR = "max_mode_data";

function configPath(planName) {
  return path.join(process.cwd(), NOPATCH_DIR, MAX_CONFIG_DIR, `${planName}.toml`);
}

function dataDir(planName) {
  return path.join(process.cwd(), NOPATCH_DIR, MAX_DATA_DIR, planName);
}

function loadConfig(planName) {
  const p = configPath(planName);
  if (!fs.existsSync(p)) return null;
  try {
    return toml.parse(fs.readFileSync(p, "utf8"));
  } catch (e) {
    error(`Error: Failed to parse config: ${p}`);
    error(e.message);
    process.exit(1);
  }
}

function saveConfig(planName, config) {
  const p = configPath(planName);
  let content = fs.readFileSync(p, "utf8");

  content = content.replace(
    /^timestamp\s*=\s*".*"/m,
    `timestamp = "${config.timestamp}"`
  );
  content = content.replace(
    /^enabled\s*=\s*(true|false)/m,
    `enabled = ${config.enabled}`
  );

  fs.writeFileSync(p, content, "utf8");
}

function collectFiles(dir, base = dir, result = []) {
  if (!fs.existsSync(dir)) return result;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectFiles(full, base, result);
    } else {
      result.push({
        rel: path.relative(base, full).replace(/\\/g, "/"),
        abs: full,
      });
    }
  }
  return result;
}

function listPlans() {
  const configDir = path.join(process.cwd(), NOPATCH_DIR, MAX_CONFIG_DIR);
  if (!fs.existsSync(configDir)) return [];
  return fs.readdirSync(configDir)
    .filter(f => f.endsWith(".toml"))
    .map(f => f.slice(0, -".toml".length));
}

export function maxStart(planName) {
  const config = loadConfig(planName);
  if (!config) {
    error(`Error: Plan not found: ${planName}`);
    error(`   Create ${NOPATCH_DIR}/${MAX_CONFIG_DIR}/${planName}.toml first (see _example.toml)`);
    process.exit(1);
  }

  if (config.timestamp) {
    error(`Error: Plan "${planName}" already has a timestamp (${config.timestamp})`);
    error(`   --max-start can only be executed once per plan`);
    process.exit(1);
  }

  config.timestamp = new Date().toISOString();
  config.enabled = true;

  saveConfig(planName, config);
  console.log(`max: plan "${planName}" started`);
  console.log(`     timestamp: ${config.timestamp}`);
}

function validateWatchDirs(watchDirs) {
  if (!watchDirs || watchDirs.length <= 1) return;

  const normalized = watchDirs
    .map(d => d.replace(/\\/g, "/").replace(/\/+$/, ""))
    .sort();

  for (let i = 0; i < normalized.length - 1; i++) {
    const a = normalized[i];
    const b = normalized[i + 1];
    if (b.startsWith(a + "/") || a === b) {
      error(`Error: Nested watch paths detected: "${watchDirs[i]}" and "${watchDirs[i + 1]}"`);
      error(`   Nested paths are not allowed in watch_dirs`);
      process.exit(1);
    }
  }
}

function collectWatchPath(watchPath, cwd, ts, planDataDir) {
  const absPath = path.join(cwd, watchPath);
  if (!fs.existsSync(absPath)) {
    console.log(`  [SKIP] ${watchPath} (not found)`);
    return 0;
  }

  const stat = fs.statSync(absPath);
  let count = 0;

  if (stat.isFile()) {
    if (stat.mtimeMs > ts) {
      const destPath = path.join(planDataDir, `${watchPath}.nopatch_latest`);
      fs.mkdirSync(path.dirname(destPath), { recursive: true });
      fs.copyFileSync(absPath, destPath);
      console.log(`  [ADD] ${watchPath}`);
      count++;
    }
  } else if (stat.isDirectory()) {
    const files = collectFiles(absPath);
    for (const { rel, abs } of files) {
      try {
        const fstat = fs.statSync(abs);
        if (fstat.mtimeMs > ts) {
          const destRel = path.join(watchPath, rel).replace(/\\/g, "/");
          const destPath = path.join(planDataDir, `${destRel}.nopatch_latest`);
          fs.mkdirSync(path.dirname(destPath), { recursive: true });
          fs.copyFileSync(abs, destPath);
          console.log(`  [ADD] ${destRel}`);
          count++;
        }
      } catch (e) {
        log(`  [WARN] Failed to process: ${abs} - ${e.message}`);
      }
    }
  }

  return count;
}

export function maxCollect(planName) {
  const config = loadConfig(planName);
  if (!config) {
    error(`Error: Plan not found: ${planName}`);
    process.exit(1);
  }

  if (!config.enabled) {
    error(`Error: Plan "${planName}" is not enabled (set enabled = true in TOML)`);
    process.exit(1);
  }

  validateWatchDirs(config.watch_dirs);

  const cwd = process.cwd();
  const ts = new Date(config.timestamp).getTime();
  const planDataDir = dataDir(planName);

  if (fs.existsSync(planDataDir)) {
    fs.rmSync(planDataDir, { recursive: true, force: true });
  }

  let collectCount = 0;
  let deleteCount = 0;

  for (const watchPath of config.watch_dirs || []) {
    collectCount += collectWatchPath(watchPath, cwd, ts, planDataDir);
  }

  for (const delPath of config.delete_paths || []) {
    const destPath = path.join(planDataDir, `${delPath}.nopatch_delete`);
    fs.mkdirSync(path.dirname(destPath), { recursive: true });
    fs.writeFileSync(destPath, new Date().toISOString());
    console.log(`  [DEL] ${delPath}`);
    deleteCount++;
  }

  config.enabled = false;
  saveConfig(planName, config);

  console.log(`max: plan "${planName}" collected (${collectCount} files, ${deleteCount} deletes)`);
  console.log(`     set enabled = true in TOML to collect again`);
}

export function maxApply(planNames) {
  let plans = listPlans();
  if (plans.length === 0) {
    log("max: no plans found, skipping");
    return;
  }

  if (planNames && planNames.length > 0) {
    const nameSet = new Set(planNames);
    const notFound = planNames.filter(n => !plans.includes(n));
    if (notFound.length > 0) {
      error(`Error: Plan(s) not found: ${notFound.join(", ")}`);
      process.exit(1);
    }
    plans = plans.filter(p => nameSet.has(p));
  }

  const cwd = process.cwd();
  let totalApply = 0;
  let totalDelete = 0;

  for (const planName of plans) {
    const planDataDir = dataDir(planName);
    if (!fs.existsSync(planDataDir)) continue;

    let applyCount = 0;
    let deleteCount = 0;

    function walk(dir) {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
        } else {
          const rel = path.relative(planDataDir, full).replace(/\\/g, "/");

          if (rel.endsWith(".nopatch_delete")) {
            const targetRel = rel.slice(0, -".nopatch_delete".length);
            const targetPath = path.join(cwd, targetRel);
            if (fs.existsSync(targetPath)) {
              const stat = fs.statSync(targetPath);
              if (stat.isDirectory()) {
                fs.rmSync(targetPath, { recursive: true, force: true });
              } else {
                fs.rmSync(targetPath);
              }
              console.log(`  [DEL] ${targetRel}`);
              deleteCount++;
            } else {
              console.log(`  [SKIP] ${targetRel} (not found, skip)`);
            }
          } else if (rel.endsWith(".nopatch_latest")) {
            const targetRel = rel.slice(0, -".nopatch_latest".length);
            const targetPath = path.join(cwd, targetRel);
            fs.mkdirSync(path.dirname(targetPath), { recursive: true });
            fs.copyFileSync(full, targetPath);
            console.log(`  [ADD] ${targetRel}`);
            applyCount++;
          }
        }
      }
    }

    walk(planDataDir);

    if (applyCount > 0 || deleteCount > 0) {
      console.log(`max: plan "${planName}" applied (${applyCount} files, ${deleteCount} deletes)`);
      totalApply += applyCount;
      totalDelete += deleteCount;
    }
  }

  if (totalApply > 0 || totalDelete > 0) {
    console.log(`max: ${totalApply} files, ${totalDelete} deletes applied`);
  }
}
