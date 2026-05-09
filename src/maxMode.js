import fs from "fs";
import path from "path";
import crypto from "crypto";
import toml from "toml";
import { error, log } from "./utils.js";

const NOPATCH_DIR = "nopatch";
const MAX_CONFIG_DIR = "max_mode_config";
const MAX_DATA_DIR = "max_mode_data";

const HMAC_SECRET = "nopatch_max_state_v2";
const RESTART_DELAY_MS = 500;

function configPath(planName) {
  return path.join(process.cwd(), NOPATCH_DIR, MAX_CONFIG_DIR, `${planName}.toml`);
}

function dataDir(planName) {
  return path.join(process.cwd(), NOPATCH_DIR, MAX_DATA_DIR, planName);
}

function readTomlFile(planName) {
  const p = configPath(planName);
  if (!fs.existsSync(p)) return null;
  try {
    return { parsed: toml.parse(fs.readFileSync(p, "utf8")), raw: fs.readFileSync(p, "utf8"), filePath: p };
  } catch (e) {
    error(`Error: Failed to parse config: ${p}`);
    error(e.message);
    process.exit(1);
  }
}

function signPayload(payload) {
  const json = JSON.stringify(payload);
  const hmac = crypto.createHmac("sha256", HMAC_SECRET).update(json).digest("hex");
  return Buffer.from(json).toString("base64") + "." + hmac;
}

function verifyState(stateStr, planName) {
  if (!stateStr) return null;

  const dotIdx = stateStr.lastIndexOf(".");
  if (dotIdx === -1) return null;

  const b64 = stateStr.slice(0, dotIdx);
  const hmac = stateStr.slice(dotIdx + 1);

  let json;
  try {
    json = Buffer.from(b64, "base64").toString("utf8");
  } catch {
    return null;
  }

  const expectedHmac = crypto.createHmac("sha256", HMAC_SECRET).update(json).digest("hex");
  if (hmac !== expectedHmac) return null;

  let payload;
  try {
    payload = JSON.parse(json);
  } catch {
    return null;
  }

  if (payload.plan !== planName) return null;

  return { timestamp: payload.timestamp, collected: payload.collected };
}

function readState(planName) {
  const result = readTomlFile(planName);
  if (!result) return null;

  const stateStr = result.parsed._state;
  if (!stateStr) return null;

  return verifyState(stateStr, planName);
}

function writeState(planName, state) {
  const p = configPath(planName);
  let content = fs.readFileSync(p, "utf8");

  const payload = {
    plan: planName,
    timestamp: state.timestamp,
    collected: state.collected,
  };
  const signed = signPayload(payload);

  if (content.includes("_state")) {
    content = content.replace(
      /^_state\s*=\s*".*"/m,
      `_state = "${signed}"`
    );
  } else {
    content = content.trimEnd() + `\n\n# 程序状态字段，极其重要，禁止手动修改或删除 | Program state field, extremely important, do NOT modify or delete manually\n_state = "${signed}"\n`;
  }

  fs.writeFileSync(p, content, "utf8");
}

function matchesPattern(filePath, patterns) {
  if (!patterns || patterns.length === 0) return false;
  
  for (const pattern of patterns) {
    if (pattern.endsWith("/")) {
      const dirPattern = pattern.slice(0, -1);
      
      if (dirPattern.startsWith("**/")) {
        const targetDir = dirPattern.slice(3);
        const regex = new RegExp(`(^|/)${targetDir}($|/)`);
        if (regex.test(filePath)) return true;
      } else {
        if (filePath === dirPattern) return true;
        if (filePath.startsWith(dirPattern + "/")) return true;
      }
    } else if (pattern.includes("**")) {
      const [before, after] = pattern.split("**");
      const beforeMatch = !before || filePath.startsWith(before);
      const afterMatch = !after || filePath.endsWith(after);
      if (beforeMatch && afterMatch) return true;
    } else if (pattern.includes("*")) {
      const regexStr = "^" + pattern.replace(/\*/g, "[^/]*") + "$";
      const regex = new RegExp(regexStr);
      if (regex.test(filePath)) return true;
      const fileName = filePath.split("/").pop();
      if (regex.test(fileName)) return true;
    } else {
      if (filePath === pattern) return true;
      if (filePath.startsWith(pattern + "/")) return true;
    }
  }
  return false;
}

function collectFiles(dir, base = dir, result = [], ignorePatterns = [], rootPath = null) {
  if (!fs.existsSync(dir)) return result;
  if (rootPath === null) rootPath = base;
  
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    const rel = path.relative(base, full).replace(/\\/g, "/");
    const fullRelPath = path.relative(rootPath, full).replace(/\\/g, "/");
    
    if (matchesPattern(fullRelPath, ignorePatterns)) {
      if (entry.isDirectory()) {
        console.log(`  [SKIP DIR] ${fullRelPath} (ignored)`);
      }
      continue;
    }
    
    if (entry.isDirectory()) {
      collectFiles(full, base, result, ignorePatterns, rootPath);
    } else {
      result.push({
        rel: rel,
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
  const result = readTomlFile(planName);
  if (!result) {
    error(`Error: Plan not found: ${planName}`);
    error(`   Create ${NOPATCH_DIR}/${MAX_CONFIG_DIR}/${planName}.toml first (see _example.toml)`);
    process.exit(1);
  }

  const existingState = readState(planName);
  if (existingState) {
    error(`Error: Plan "${planName}" already started (timestamp: ${existingState.timestamp})`);
    error(`   --max-start can only be executed once per plan`);
    process.exit(1);
  }

  const state = {
    timestamp: new Date().toISOString(),
    collected: false,
  };
  writeState(planName, state);
  console.log(`max: plan "${planName}" started`);
  console.log(`     timestamp: ${state.timestamp}`);
}

function validateWatchDirs(watchDirs) {
  if (!watchDirs || watchDirs.length === 0) return;

  const normalized = watchDirs.map(d => d.replace(/\\/g, "/").replace(/\/+$/, ""));

  const seen = new Set();
  for (const p of normalized) {
    if (seen.has(p)) {
      error(`Error: Duplicate watch path: "${p}"`);
      process.exit(1);
    }
    seen.add(p);
  }

  if (normalized.length <= 1) return;

  const sorted = [...normalized].sort();

  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i];
    const b = sorted[i + 1];
    if (b.startsWith(a + "/")) {
      error(`Error: Nested watch paths detected: "${watchDirs[normalized.indexOf(a)]}" and "${watchDirs[normalized.indexOf(b)]}"`);
      error(`   Nested paths are not allowed in watch_dirs`);
      process.exit(1);
    }
  }
}

function writeMetaFile(srcAbsPath, destLatestPath) {
  const stat = fs.statSync(srcAbsPath);
  const metaPath = destLatestPath.replace(/\.nopatch_latest$/, ".nopatch_meta");
  const meta = [
    `birthtime = ${stat.birthtimeMs}`,
    `mtime = ${stat.mtimeMs}`,
    `atime = ${stat.atimeMs}`,
    `size = ${stat.size}`,
    `mode = ${stat.mode}`,
  ].join("\n");
  fs.writeFileSync(metaPath, meta);
}

function collectWatchPath(watchPath, cwd, ts, planDataDir, ignorePatterns = []) {
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
      writeMetaFile(absPath, destPath);
      console.log(`  [ADD] ${watchPath}`);
      count++;
    }
  } else if (stat.isDirectory()) {
    const files = collectFiles(absPath, absPath, [], ignorePatterns, cwd);
    for (const { rel, abs } of files) {
      try {
        const fstat = fs.statSync(abs);
        if (fstat.mtimeMs > ts) {
          const destRel = path.join(watchPath, rel).replace(/\\/g, "/");
          const destPath = path.join(planDataDir, `${destRel}.nopatch_latest`);
          fs.mkdirSync(path.dirname(destPath), { recursive: true });
          fs.copyFileSync(abs, destPath);
          writeMetaFile(abs, destPath);
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
  const result = readTomlFile(planName);
  if (!result) {
    error(`Error: Plan not found: ${planName}`);
    process.exit(1);
  }

  const state = readState(planName);
  if (!state) {
    error(`Error: Plan "${planName}" has not been started (run --max-start first)`);
    process.exit(1);
  }

  if (state.collected) {
    error(`Error: Plan "${planName}" has already been collected (run --max-restart first)`);
    process.exit(1);
  }

  validateWatchDirs(result.parsed.watch_dirs);

  const cwd = process.cwd();
  const ts = new Date(state.timestamp).getTime();
  const planDataDir = dataDir(planName);

  if (fs.existsSync(planDataDir)) {
    fs.rmSync(planDataDir, { recursive: true, force: true });
  }

  let collectCount = 0;

  const ignorePatterns = result.parsed.ignore_patterns || [];

  for (const watchPath of result.parsed.watch_dirs || []) {
    collectCount += collectWatchPath(watchPath, cwd, ts, planDataDir, ignorePatterns);
  }

  state.collected = true;
  writeState(planName, state);

  console.log(`max: plan "${planName}" collected (${collectCount} files)`);
}

export function maxCollectForce(planName) {
  const result = readTomlFile(planName);
  if (!result) {
    error(`Error: Plan not found: ${planName}`);
    process.exit(1);
  }

  const state = readState(planName);
  if (!state) {
    error(`Error: Plan "${planName}" has not been started (run --max-start first)`);
    process.exit(1);
  }

  validateWatchDirs(result.parsed.watch_dirs);

  const cwd = process.cwd();
  const ts = new Date(state.timestamp).getTime();
  const planDataDir = dataDir(planName);

  if (fs.existsSync(planDataDir)) {
    fs.rmSync(planDataDir, { recursive: true, force: true });
  }

  let collectCount = 0;

  const ignorePatterns = result.parsed.ignore_patterns || [];

  for (const watchPath of result.parsed.watch_dirs || []) {
    collectCount += collectWatchPath(watchPath, cwd, ts, planDataDir, ignorePatterns);
  }

  console.log(`max: plan "${planName}" force collected (${collectCount} files)`);
}

export function maxReset(planName, filePath) {
  const result = readTomlFile(planName);
  if (!result) {
    error(`Error: Plan not found: ${planName}`);
    process.exit(1);
  }

  let state = readState(planName);
  if (!state) {
    console.log(`max: plan "${planName}" not started, auto-starting...`);
    state = {
      timestamp: new Date().toISOString(),
      collected: false,
    };
    writeState(planName, state);
    console.log(`     timestamp: ${state.timestamp}`);
  }

  const absPath = path.resolve(filePath);
  if (!fs.existsSync(absPath)) {
    error(`Error: File not found: ${absPath}`);
    process.exit(1);
  }

  const fileStat = fs.statSync(absPath);
  const fileMtime = new Date(fileStat.mtimeMs + 5000);

  const newState = {
    timestamp: fileMtime.toISOString(),
    collected: false,
  };
  writeState(planName, newState);

  console.log(`max: plan "${planName}" reset`);
  console.log(`     source: ${absPath}`);
  console.log(`     timestamp: ${newState.timestamp}`);
}

export async function maxCollectFile(planName, absFilePath) {
  const result = readTomlFile(planName);
  if (!result) {
    error(`Error: Plan not found: ${planName}`);
    process.exit(1);
  }

  const state = readState(planName);
  if (!state) {
    error(`Error: Plan "${planName}" has not been started (run --max-start first)`);
    process.exit(1);
  }

  const absPath = path.resolve(absFilePath);
  if (!fs.existsSync(absPath)) {
    error(`Error: File not found: ${absPath}`);
    process.exit(1);
  }

  const stat = fs.statSync(absPath);
  if (!stat.isFile()) {
    error(`Error: Not a file: ${absPath}`);
    process.exit(1);
  }

  const cwd = process.cwd();
  const watchPath = path.relative(cwd, absPath).replace(/\\/g, "/");
  const watchDirs = result.parsed.watch_dirs || [];

  let isInWatchDir = false;
  for (const wd of watchDirs) {
    if (watchPath.startsWith(wd + "/") || watchPath === wd) {
      isInWatchDir = true;
      break;
    }
  }

  if (!isInWatchDir) {
    const readline = await import("readline");
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    
    const fileDir = path.dirname(watchPath);
    
    await new Promise((resolve) => {
      rl.question(
        `\n⚠  Warning: File "${watchPath}" is not in any watched directory of plan "${planName}".\n` +
        `   Current watch_dirs: ${watchDirs.length > 0 ? watchDirs.join(", ") : "none"}\n` +
        `   Would you like to add its parent directory "${fileDir}" to watch_dirs? (y/n): `,
        async (answer) => {
          rl.close();
          if (answer.trim().toLowerCase() === "y") {
            const raw = fs.readFileSync(result.filePath, "utf8");
            const watchDirsRegex = /(watch_dirs\s*=\s*\[)([^\]]*)(\])/s;
            const match = raw.match(watchDirsRegex);
            if (match) {
              const inner = match[2];
              const entries = inner.match(/"[^"]+"/g) || [];
              entries.push(`"${fileDir}"`);
              const newInner = "\n  " + entries.join(",\n  ") + ",\n";
              const newRaw = raw.replace(watchDirsRegex, match[1] + newInner + match[3]);
              fs.writeFileSync(result.filePath, newRaw);
            }
            console.log(`   Added "${fileDir}" to watch_dirs`);
          } else {
            console.log(`   Cancelled. File not collected.`);
            process.exit(0);
          }
          resolve();
        }
      );
    });
  }

  const planDataDir = dataDir(planName);
  const destPath = path.join(planDataDir, `${watchPath}.nopatch_latest`);
  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  fs.copyFileSync(absPath, destPath);
  writeMetaFile(absPath, destPath);

  console.log(`max: plan "${planName}" collected file`);
  console.log(`     source: ${absPath}`);
  console.log(`     target: ${destPath}`);
}

export async function maxRestart(planName) {
  const result = readTomlFile(planName);
  if (!result) {
    error(`Error: Plan not found: ${planName}`);
    process.exit(1);
  }

  const state = readState(planName);
  if (!state) {
    error(`Error: Plan "${planName}" has not been started (run --max-start first)`);
    process.exit(1);
  }

  if (!state.collected) {
    error(`Error: Plan "${planName}" has not been collected yet (run --max-collect first)`);
    process.exit(1);
  }

  const newState = {
    timestamp: new Date().toISOString(),
    collected: false,
  };
  writeState(planName, newState);

  await new Promise(resolve => setTimeout(resolve, RESTART_DELAY_MS));

  const planDataDir = dataDir(planName);
  if (fs.existsSync(planDataDir)) {
    maxApply([planName]);
  }
  console.log(`max: plan "${planName}" restarted`);
  console.log(`     timestamp: ${newState.timestamp}`);
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

          if (rel.endsWith(".nopatch_latest")) {
            const targetRel = rel.slice(0, -".nopatch_latest".length);
            const targetPath = path.join(cwd, targetRel);
            fs.mkdirSync(path.dirname(targetPath), { recursive: true });
            fs.copyFileSync(full, targetPath);
            const now = new Date();
            fs.utimesSync(targetPath, now, now);
            console.log(`  [ADD] ${targetRel}`);
            applyCount++;
          }
        }
      }
    }

    walk(planDataDir);

    const planResult = readTomlFile(planName);
    if (planResult && planResult.parsed.delete_paths) {
      for (const delPath of planResult.parsed.delete_paths) {
        const targetPath = path.join(cwd, delPath);
        if (fs.existsSync(targetPath)) {
          const stat = fs.statSync(targetPath);
          if (stat.isDirectory()) {
            fs.rmSync(targetPath, { recursive: true, force: true });
          } else {
            fs.rmSync(targetPath);
          }
          console.log(`  [DEL] ${delPath}`);
          deleteCount++;
        } else {
          console.log(`  [SKIP DEL] ${delPath} (not found)`);
        }
      }
    }

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
