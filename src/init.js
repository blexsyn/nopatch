#!/usr/bin/env node
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PKG_ROOT = path.resolve(__dirname, "..");

const NOPATCH_DIR = "nopatch";

const DIRS = [
  "nopatch_record",
  "nopatch_ignore",
  "tpl_record",
  "tpl_config",
  "max_mode_config",
  "max_mode_data",
];

const COPY_FILES = [
  { src: "README.md", dst: "README.md" },
  { src: "README.en.md", dst: "README.en.md" },
  { src: "_example.toml", dst: "max_mode_config/_example.toml" },
  { src: "_example.en.toml", dst: "max_mode_config/_example.en.toml" },
  { src: "_template.toml", dst: "tpl_config/_example.toml" },
  { src: "_template.en.toml", dst: "tpl_config/_example.en.toml" },
];

const COPY_DIRS = [
  { src: "_tpl_example", dst: "tpl_record/_example" },
];

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

  ensureDirs(projectRoot);
  copyAssets(projectRoot);
  ensureGitignore(projectRoot);
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

function ensureDirs(projectRoot) {
  const nopatchRoot = path.join(projectRoot, NOPATCH_DIR);
  fs.mkdirSync(nopatchRoot, { recursive: true });

  for (const dir of DIRS) {
    const full = path.join(nopatchRoot, dir);
    if (!fs.existsSync(full)) {
      fs.mkdirSync(full, { recursive: true });
    }
  }
}

function copyAssets(projectRoot) {
  const nopatchRoot = path.join(projectRoot, NOPATCH_DIR);

  for (const { src, dst } of COPY_FILES) {
    const srcPath = path.join(PKG_ROOT, src);
    const dstPath = path.join(nopatchRoot, dst);
    if (fs.existsSync(srcPath) && !fs.existsSync(dstPath)) {
      fs.mkdirSync(path.dirname(dstPath), { recursive: true });
      fs.copyFileSync(srcPath, dstPath);
    }
  }

  for (const { src, dst } of COPY_DIRS) {
    const srcDir = path.join(PKG_ROOT, src);
    const dstDir = path.join(nopatchRoot, dst);
    if (fs.existsSync(srcDir)) {
      copyDirIfNew(srcDir, dstDir);
    }
  }
}

function copyDirIfNew(srcDir, dstDir) {
  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    const srcPath = path.join(srcDir, entry.name);
    const dstPath = path.join(dstDir, entry.name);
    if (entry.isDirectory()) {
      copyDirIfNew(srcPath, dstPath);
    } else if (!fs.existsSync(dstPath)) {
      fs.mkdirSync(path.dirname(dstPath), { recursive: true });
      fs.copyFileSync(srcPath, dstPath);
    }
  }
}

function ensureGitignore(projectRoot) {
  const gitignorePath = path.join(projectRoot, NOPATCH_DIR, ".gitignore");
  if (fs.existsSync(gitignorePath)) return;

  const content = [
    "# All files in nopatch/ must be tracked by git",
    "# Un-ignore everything regardless of parent .gitignore rules",
    "!*",
    "",
  ].join("\n");

  fs.writeFileSync(gitignorePath, content, "utf8");
}
