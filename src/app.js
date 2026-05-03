#!/usr/bin/env node
import createPatch from "./createPatch.js";
import applyPatch from "./applyPatch.js";
import applyTemplate from "./applyTemplate.js";
import initTemplate from "./initTemplate.js";
import { checkAndFix } from "./init.js";
import {
  maxStart,
  maxCollect,
  maxApply,
} from "./maxMode.js";

const args = process.argv.slice(2);

if (args.includes("--debug")) {
  process.env.DEBUG = "1";
}

if (args.includes("--help") || args.includes("-h")) {
  console.log(`
Usage:
  nopatch <package-name>        Create patch for a package
  nopatch --tpl <package-name>  Initialize template dirs for a package
  nopatch                       Apply all patches + templates (postinstall)
  nopatch --patch <name>        Apply patch for a specific package only

Max mode:
  nopatch --max-start <plan>     Start a recording session (edit TOML to configure)
  nopatch --max-collect <plan>    Collect changes once (re-enable in TOML to collect again)
  nopatch --max-apply [plan...]     Apply collected data (manual only, all plans if omitted)

Examples:
  nopatch braces
  nopatch @scope/package
  nopatch --tpl braces
  nopatch --patch braces
  nopatch --max-start myplan
  nopatch --max-collect myplan
  nopatch --max-apply

Options:
  --tpl <name>     Initialize template directory and data.toml for a package
  --patch <name>   Apply patch for specific package only
  --debug          Show detailed debug output
  -h, --help       Show this help message
`);
  process.exit(0);
}

const maxStartIndex = args.findIndex((a) => a === "--max-start");
const maxCollectIndex = args.findIndex((a) => a === "--max-collect");
const maxApplyIndex = args.findIndex((a) => a === "--max-apply");

const maxFlagIndices = [
  maxStartIndex, maxCollectIndex, maxApplyIndex,
].filter((i) => i !== -1);

if (maxFlagIndices.length > 0) {
  const maxFlagValueIndices = new Set();
  for (const i of maxFlagIndices) {
    maxFlagValueIndices.add(i + 1);
  }

  if (maxStartIndex !== -1) {
    const planName = args[maxStartIndex + 1];
    if (!planName) {
      console.error("Error: --max-start requires a plan name");
      process.exit(1);
    }
    maxStart(planName);
    process.exit(0);
  }

  if (maxCollectIndex !== -1) {
    const planName = args[maxCollectIndex + 1];
    if (!planName) {
      console.error("Error: --max-collect requires a plan name");
      process.exit(1);
    }
    maxCollect(planName);
    process.exit(0);
  }

  if (maxApplyIndex !== -1) {
    const planNames = [];
    for (let i = maxApplyIndex + 1; i < args.length; i++) {
      if (args[i].startsWith("--")) break;
      planNames.push(args[i]);
    }
    maxApply(planNames.length > 0 ? planNames : undefined);
    process.exit(0);
  }
}

const tplFlagIndex = args.findIndex((a) => a === "--tpl");
const tplFlag = args.find((a) => a.startsWith("--tpl="))?.split("=")[1]
  ?? (tplFlagIndex !== -1 ? args[tplFlagIndex + 1] : null);

const patchFlagIndex = args.findIndex((a) => a === "--patch");
const patchFlag = args.find((a) => a.startsWith("--patch="))?.split("=")[1]
  ?? (patchFlagIndex !== -1 ? args[patchFlagIndex + 1] : null);

const knownFlags = [
  "--tpl", "--patch", "--help", "-h", "--debug",
  "--max-start", "--max-collect", "--max-apply",
];
const unknownFlags = args.filter(
  (a) =>
    a.startsWith("-") &&
    !knownFlags.includes(a) &&
    !a.startsWith("--tpl=") &&
    !a.startsWith("--patch=")
);
if (unknownFlags.length > 0) {
  console.error(`Error: Unknown option(s): ${unknownFlags.join(", ")}`);
  console.error(`   Run "nopatch --help" for usage.`);
  process.exit(1);
}

const flagValueIndices = new Set();
if (tplFlagIndex !== -1) flagValueIndices.add(tplFlagIndex + 1);
if (patchFlagIndex !== -1) flagValueIndices.add(patchFlagIndex + 1);

const positional = args.filter((a, i) => !a.startsWith("-") && !flagValueIndices.has(i));

if (tplFlag) {
  initTemplate(tplFlag);
} else if (positional.length > 0) {
  for (const pkg of positional) {
    createPatch(pkg);
  }
} else {
  checkAndFix(process.cwd());
  await applyPatch(patchFlag ?? undefined);
  await applyTemplate(patchFlag ?? undefined);
}
