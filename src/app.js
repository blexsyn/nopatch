#!/usr/bin/env node
import createPatch from "./createPatch.js";
import applyPatch from "./applyPatch.js";
import applyTemplate, { tplVerify } from "./applyTemplate.js";
import { checkAndFix } from "./init.js";
import {
  maxStart,
  maxCollect,
  maxCollectForce,
  maxRestart,
  maxReset,
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
  nopatch                       Apply all patches (postinstall)
  nopatch --patch <name>        Apply patch for a specific package only

Max mode:
  nopatch --max-start <plan>      Start a recording session (edit TOML to configure)
  nopatch --max-collect <plan>     Collect changes (once only, restart to collect again)
  nopatch --max-collect-force <plan>  Force collect (skip collected check, no timestamp reset)
  nopatch --max-restart <plan>     Restart plan: release data, reset timestamp for next collect
  nopatch --max-reset <plan> <file>  Reset plan: use file's mtime as timestamp, release data
  nopatch --max-apply [plan...]    Apply collected data (manual only, all plans if omitted)

Template:
  nopatch --tpl-apply [plan...]    Apply templates (manual only, all plans if omitted)
  nopatch --tpl-verify <plan>      Verify template plan (check config, files, variables)

Examples:
  nopatch braces
  nopatch @scope/package
  nopatch --patch braces
  nopatch --max-start myplan
  nopatch --max-collect myplan
  nopatch --max-collect-force myplan
  nopatch --max-restart myplan
  nopatch --max-reset myplan node_modules/debug/package.json
  nopatch --max-apply
  nopatch --tpl-apply
  nopatch --tpl-apply myplan
  nopatch --tpl-verify myplan

Options:
  --patch <name>   Apply patch for specific package only
  --debug          Show detailed debug output
  -h, --help       Show this help message
`);
  process.exit(0);
}

const maxStartIndex = args.findIndex((a) => a === "--max-start");
const maxCollectIndex = args.findIndex((a) => a === "--max-collect");
const maxCollectForceIndex = args.findIndex((a) => a === "--max-collect-force");
const maxRestartIndex = args.findIndex((a) => a === "--max-restart");
const maxResetIndex = args.findIndex((a) => a === "--max-reset");
const maxApplyIndex = args.findIndex((a) => a === "--max-apply");
const tplApplyIndex = args.findIndex((a) => a === "--tpl-apply");
const tplVerifyIndex = args.findIndex((a) => a === "--tpl-verify");

const maxFlagIndices = [
  maxStartIndex, maxCollectIndex, maxCollectForceIndex, maxRestartIndex, maxResetIndex, maxApplyIndex, tplApplyIndex, tplVerifyIndex,
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

  if (maxCollectForceIndex !== -1) {
    const planName = args[maxCollectForceIndex + 1];
    if (!planName) {
      console.error("Error: --max-collect-force requires a plan name");
      process.exit(1);
    }
    maxCollectForce(planName);
    process.exit(0);
  }

  if (maxRestartIndex !== -1) {
    const planName = args[maxRestartIndex + 1];
    if (!planName) {
      console.error("Error: --max-restart requires a plan name");
      process.exit(1);
    }
    await maxRestart(planName);
    process.exit(0);
  }

  if (maxResetIndex !== -1) {
    const planName = args[maxResetIndex + 1];
    const filePath = args[maxResetIndex + 2];
    if (!planName) {
      console.error("Error: --max-reset requires a plan name");
      process.exit(1);
    }
    if (!filePath) {
      console.error("Error: --max-reset requires a file path");
      process.exit(1);
    }
    await maxReset(planName, filePath);
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

  if (tplApplyIndex !== -1) {
    const planNames = [];
    for (let i = tplApplyIndex + 1; i < args.length; i++) {
      if (args[i].startsWith("--")) break;
      planNames.push(args[i]);
    }
    await applyTemplate(planNames.length > 0 ? planNames[0] : undefined);
    process.exit(0);
  }

  if (tplVerifyIndex !== -1) {
    const planName = args[tplVerifyIndex + 1];
    if (!planName) {
      console.error("Error: --tpl-verify requires a plan name");
      process.exit(1);
    }
    tplVerify(planName);
    process.exit(0);
  }
}

const patchFlagIndex = args.findIndex((a) => a === "--patch");
const patchFlag = args.find((a) => a.startsWith("--patch="))?.split("=")[1]
  ?? (patchFlagIndex !== -1 ? args[patchFlagIndex + 1] : null);

const knownFlags = [
  "--patch", "--help", "-h", "--debug",
  "--max-start", "--max-collect", "--max-collect-force", "--max-restart", "--max-reset", "--max-apply",
  "--tpl-apply", "--tpl-verify",
];
const unknownFlags = args.filter(
  (a) =>
    a.startsWith("-") &&
    !knownFlags.includes(a) &&
    !a.startsWith("--patch=")
);
if (unknownFlags.length > 0) {
  console.error(`Error: Unknown option(s): ${unknownFlags.join(", ")}`);
  console.error(`   Run "nopatch --help" for usage.`);
  process.exit(1);
}

const flagValueIndices = new Set();
if (patchFlagIndex !== -1) flagValueIndices.add(patchFlagIndex + 1);

const positional = args.filter((a, i) => !a.startsWith("-") && !flagValueIndices.has(i));

if (positional.length > 0) {
  for (const pkg of positional) {
    createPatch(pkg);
  }
} else {
  checkAndFix(process.cwd());
  await applyPatch(patchFlag ?? undefined);
}
