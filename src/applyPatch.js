import fs from "fs";
import path from "path";
import simpleGit from "simple-git";
import { error, log } from "./utils.js";

const NOPATCH_DIR = "nopatch";
const RECORD_DIR = "nopatch_record";

// 递归收集补丁文件
function collectPatches(recordRoot) {
  const results = [];

  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else {
        const name = entry.name;
        let type = null;
        if (name.endsWith(".patch")) type = "patch";
        else if (name.includes(".nopatch_latest")) type = "latest";
        else if (name.endsWith(".nopatch_delete")) type = "delete";
        if (type) {
          results.push({
            full,
            type,
            relFile: path.relative(recordRoot, full).replace(/\\/g, "/"),
          });
        }
      }
    }
  }

  walk(recordRoot);
  return results;
}

// 从 modify_record 下的目录结构还原包名和版本
// modify_record/braces+3.0.3/          → { pkgName: "braces", version: "3.0.3" }
// modify_record/@yarnpkg/lockfile+1.1.0/ → { pkgName: "@yarnpkg/lockfile", version: "1.1.0" }
function parsePkgDir(modifyRoot, entry) {
  if (entry.name.startsWith("@")) {
    // scoped：还需要读一层子目录
    const scopeDir = path.join(modifyRoot, entry.name);
    return fs.readdirSync(scopeDir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((sub) => {
        const lastPlus = sub.name.lastIndexOf("+");
        const pkg = sub.name.slice(0, lastPlus);
        const version = sub.name.slice(lastPlus + 1);
        return {
          pkgName: `${entry.name}/${pkg}`,
          version,
          recordRoot: path.join(scopeDir, sub.name),
        };
      });
  }
  const lastPlus = entry.name.lastIndexOf("+");
  const pkg = entry.name.slice(0, lastPlus);
  const version = entry.name.slice(lastPlus + 1);
  return [{ pkgName: pkg, version, recordRoot: path.join(modifyRoot, entry.name) }];
}

export default async function applyPatch(targetPkg) {
  const modifyRoot = path.join(process.cwd(), NOPATCH_DIR, RECORD_DIR);

  if (!fs.existsSync(modifyRoot)) {
    log("No modify_record directory found, skipping");
    return;
  }

  const topEntries = fs.readdirSync(modifyRoot, { withFileTypes: true })
    .filter((e) => e.isDirectory());

  if (topEntries.length === 0) {
    log("No patches found, skipping");
    return;
  }

  // 展开所有包信息
  let pkgList = topEntries.flatMap((e) => parsePkgDir(modifyRoot, e));

  if (targetPkg) {
    pkgList = pkgList.filter((p) => p.pkgName === targetPkg);
    if (pkgList.length === 0) {
      error(`❌ No patches found for: ${targetPkg}`);
      process.exit(1);
    }
  }

  let applyCount = 0;

  for (const { pkgName, version, recordRoot } of pkgList) {
    const pkgDir = path.join(process.cwd(), "node_modules", pkgName);

    if (!fs.existsSync(pkgDir)) {
      console.log(`  [skip] ${pkgName}@${version} not installed`);
      continue;
    }

    const patches = collectPatches(recordRoot);

    for (const patch of patches) {
      // 还原目标文件路径：去掉 nopatch 后缀
      const relTarget = patch.relFile
        .replace(/\.patch$/, "")
        .replace(/\.nopatch_delete$/, "")
        .replace(/\.nopatch_latest(\.[^.]+)?$/, "");

      const targetFile = path.join(pkgDir, relTarget);

      if (patch.type === "delete") {
        if (fs.existsSync(targetFile)) {
          fs.rmSync(targetFile);
          console.log(`  [-] ${pkgName}/${relTarget}`);
        }
        applyCount++;
        continue;
      }

      if (patch.type === "latest") {
        fs.mkdirSync(path.dirname(targetFile), { recursive: true });
        fs.copyFileSync(patch.full, targetFile);
        console.log(`  [>] ${pkgName}/${relTarget}`);
        applyCount++;
        continue;
      }

      // .patch — git apply
      const git = simpleGit().cwd({ path: process.cwd(), root: true });
      const isRepo = await git.checkIsRepo();
      if (!isRepo) await git.init();

      const gitRoot = await git.revparse(["--show-toplevel"]);
      const directory = path
        .normalize(path.relative(gitRoot, pkgDir))
        .replace(/\\/g, "/");

      const alreadyApplied = await git
        .applyPatch(patch.full, { "--check": null, "--directory": directory })
        .then(() => false)
        .catch(() => true);

      if (alreadyApplied) {
        console.log(`  [=] ${pkgName}/${relTarget} (already applied)`);
        continue;
      }

      await git
        .applyPatch(patch.full, {
          "--no-index": null,
          "--allow-empty": null,
          "--directory": directory,
        })
        .catch((e) => {
          error(`  [!] Failed to apply patch: ${pkgName}/${relTarget}`);
          error(e.message);
        });

      console.log(`  [+] ${pkgName}/${relTarget}`);
      applyCount++;
    }
  }

  console.log(`patch: ${applyCount} applied`);
}
