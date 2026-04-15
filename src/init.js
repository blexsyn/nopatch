#!/usr/bin/env node
import fs from "fs";
import path from "path";

// 检查并修正 nopatch 的依赖分类，注入 postinstall
// Check and fix nopatch dependency classification, inject postinstall hook
export function checkAndFix(projectRoot) {
  const pkgPath = path.join(projectRoot, "package.json");
  if (!fs.existsSync(pkgPath)) return;

  let pkg;
  try {
    pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
  } catch {
    return;
  }

  let changed = false;

  // 如果装在 dependencies 而非 devDependencies，自动移过去
  // Auto-move nopatch from dependencies to devDependencies
  if (pkg.dependencies?.nopatch && !pkg.devDependencies?.nopatch) {
    pkg.devDependencies = pkg.devDependencies || {};
    pkg.devDependencies.nopatch = pkg.dependencies.nopatch;
    delete pkg.dependencies.nopatch;
    if (Object.keys(pkg.dependencies).length === 0) delete pkg.dependencies;
    console.log("[nopatch] moved nopatch to devDependencies");
    changed = true;
  }

  // 注入 postinstall / inject postinstall hook
  if (pkg.scripts?.postinstall) {
    if (!pkg.scripts.postinstall.includes("nopatch")) {
      pkg.scripts.postinstall = `${pkg.scripts.postinstall} && nopatch`;
      changed = true;
    }
  } else {
    pkg.scripts = pkg.scripts || {};
    pkg.scripts.postinstall = "nopatch";
    changed = true;
  }

  if (changed) {
    fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n", "utf8");
    console.log("[nopatch] package.json updated");
  }
}

// 作为独立脚本执行时（nopatch 自身的 postinstall）
// When executed as standalone script (nopatch's own postinstall)
if (process.argv[1].endsWith("init.js")) {
  let dir = path.dirname(process.cwd());
  while (dir.includes("node_modules")) {
    dir = path.dirname(dir);
  }
  checkAndFix(dir);
}
