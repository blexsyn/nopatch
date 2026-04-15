#!/usr/bin/env node
import createPatch from "./createPatch.js";
import applyPatch from "./applyPatch.js";
import applyTemplate from "./applyTemplate.js";
import initTemplate from "./initTemplate.js";
import { checkAndFix } from "./init.js";

const args = process.argv.slice(2);

// --debug flag 设置环境变量，后续 log() 函数会读取
if (args.includes("--debug")) {
  process.env.DEBUG = "1";
}

// --help
if (args.includes("--help") || args.includes("-h")) {
  console.log(`
Usage:
  nopatch <package-name>        Create patch for a package
  nopatch --tpl <package-name>  Initialize template dirs for a package
  nopatch                       Apply all patches + templates (postinstall)
  nopatch --patch <name>        Apply patch for a specific package only

Examples:
  nopatch braces
  nopatch @scope/package
  nopatch --tpl braces
  nopatch --patch braces

Options:
  --tpl <name>     Initialize template directory and data.toml for a package
  --patch <name>   Apply patch for specific package only
  --debug          Show detailed debug output
  -h, --help       Show this help message
`);
  process.exit(0);
}

// 解析 --tpl flag
const tplFlagIndex = args.findIndex((a) => a === "--tpl");
const tplFlag = args.find((a) => a.startsWith("--tpl="))?.split("=")[1]
  ?? (tplFlagIndex !== -1 ? args[tplFlagIndex + 1] : null);

// 解析 --patch flag
const patchFlagIndex = args.findIndex((a) => a === "--patch");
const patchFlag = args.find((a) => a.startsWith("--patch="))?.split("=")[1]
  ?? (patchFlagIndex !== -1 ? args[patchFlagIndex + 1] : null);

// 未知 flag 检测
const knownFlags = ["--tpl", "--patch", "--help", "-h", "--debug"];
const unknownFlags = args.filter(
  (a) =>
    a.startsWith("-") &&
    !knownFlags.includes(a) &&
    !a.startsWith("--tpl=") &&
    !a.startsWith("--patch=")
);
if (unknownFlags.length > 0) {
  console.error(`❌ Unknown option(s): ${unknownFlags.join(", ")}`);
  console.error(`   Run "nopatch --help" for usage.`);
  process.exit(1);
}

// 位置参数（非 flag，且不是 flag 的值）
const flagValueIndices = new Set();
if (tplFlagIndex !== -1) flagValueIndices.add(tplFlagIndex + 1);
if (patchFlagIndex !== -1) flagValueIndices.add(patchFlagIndex + 1);

const positional = args.filter((a, i) => !a.startsWith("-") && !flagValueIndices.has(i));

if (tplFlag) {
  // 初始化模板目录
  initTemplate(tplFlag);
} else if (positional.length > 0) {
  // 创建补丁
  for (const pkg of positional) {
    createPatch(pkg);
  }
} else {
  // postinstall：每次检查依赖分类，再 apply patch + template
  checkAndFix(process.cwd());
  await applyPatch(patchFlag ?? undefined);
  await applyTemplate(patchFlag ?? undefined);
}
