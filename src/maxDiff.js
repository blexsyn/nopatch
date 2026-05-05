import fs from "fs";
import path from "path";
import simpleGit from "simple-git";
import { error } from "./utils.js";

const NOPATCH_DIR = "nopatch";
const MAX_DATA_DIR = "max_mode_data";
const MAX_DIFF_DIR = "max_mode_diff";

const MAX_DIFF_SIZE = 500 * 1024;

function dataDir(planName) {
  return path.join(process.cwd(), NOPATCH_DIR, MAX_DATA_DIR, planName);
}

function diffDir(planName) {
  return path.join(process.cwd(), NOPATCH_DIR, MAX_DIFF_DIR, planName);
}

function collectEntries(planDataDir) {
  const results = [];

  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else {
        const rel = path.relative(planDataDir, full).replace(/\\/g, "/");
        results.push({ full, rel });
      }
    }
  }

  walk(planDataDir);
  return results;
}

export async function maxDiff(planName) {
  const cwd = process.cwd();
  const planDataDir = dataDir(planName);

  if (!fs.existsSync(planDataDir)) {
    error(`Error: No collected data for plan "${planName}"`);
    process.exit(1);
  }

  const outDir = diffDir(planName);
  if (fs.existsSync(outDir)) {
    fs.rmSync(outDir, { recursive: true, force: true });
  }
  fs.mkdirSync(outDir, { recursive: true });

  const git = simpleGit();
  const entries = collectEntries(planDataDir);

  let diffCount = 0;
  let deleteCount = 0;

  for (const { full, rel } of entries) {
    if (rel.endsWith(".nopatch_delete")) {
      const targetRel = rel.slice(0, -".nopatch_delete".length);
      const targetPath = path.join(cwd, targetRel);
      const status = fs.existsSync(targetPath) ? "exists (should be deleted)" : "already deleted";
      const delDiffPath = path.join(outDir, `${targetRel}.diff`);
      fs.mkdirSync(path.dirname(delDiffPath), { recursive: true });
      fs.writeFileSync(delDiffPath, `[DELETE] ${targetRel}\nStatus: ${status}\n`);
      console.log(`  [DEL] ${targetRel}`);
      deleteCount++;
    } else if (rel.endsWith(".nopatch_latest")) {
      const targetRel = rel.slice(0, -".nopatch_latest".length);
      const targetPath = path.join(cwd, targetRel);

      const diffPath = path.join(outDir, `${targetRel}.diff`);
      fs.mkdirSync(path.dirname(diffPath), { recursive: true });

      const snapStat = fs.statSync(full);
      if (snapStat.size >= MAX_DIFF_SIZE) {
        fs.copyFileSync(full, diffPath);
        console.log(`  [COPY] ${targetRel} (${(snapStat.size / 1024).toFixed(1)} KB, too large for diff)`);
        diffCount++;
        continue;
      }

      if (!fs.existsSync(targetPath)) {
        const oldContent = fs.readFileSync(full, "utf8");
        const lines = oldContent.split("\n");
        const diffLines = [`--- a/${targetRel}`, `+++ /dev/null`, `@@ -1,${lines.length} +0,0 @@`];
        for (const l of lines) {
          diffLines.push(`-${l}`);
        }
        fs.writeFileSync(diffPath, diffLines.join("\n") + "\n", "utf8");
      } else {
        let diffOutput;
        try {
          diffOutput = await git.diff(["--no-index", "-U999999", "--", targetPath, full]);
        } catch (e) {
          diffOutput = e.message.replace(/\n    at .*/s, "");
        }
        fs.writeFileSync(diffPath, diffOutput, "utf8");
      }

      console.log(`  [DIFF] ${targetRel}`);
      diffCount++;
    }
  }

  console.log(`max-diff: plan "${planName}" done (${diffCount} diffs, ${deleteCount} deletes)`);
  console.log(`          output: ${outDir}`);
}
