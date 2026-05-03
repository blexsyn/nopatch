import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { error } from "./utils.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PKG_ROOT = path.resolve(__dirname, "..");

const NOPATCH_DIR = "nopatch";
const TPL_RECORD_DIR = "tpl_record";
const TPL_CONFIG_DIR = "tpl_config";

function readTemplateToml() {
  const srcPath = path.join(PKG_ROOT, "_template.toml");
  if (fs.existsSync(srcPath)) {
    return fs.readFileSync(srcPath, "utf8");
  }
  return "";
}

function copyExampleFiles(dstDir) {
  const exampleDir = path.join(PKG_ROOT, "_tpl_example");
  if (!fs.existsSync(exampleDir)) return;

  for (const entry of fs.readdirSync(exampleDir, { withFileTypes: true })) {
    const srcPath = path.join(exampleDir, entry.name);
    const dstPath = path.join(dstDir, entry.name);
    if (entry.isFile() && !fs.existsSync(dstPath)) {
      fs.copyFileSync(srcPath, dstPath);
      console.log(`  [ADD] ${path.relative(process.cwd(), dstPath)}`);
    } else if (entry.isDirectory()) {
      copyDir(srcPath, dstPath);
    }
  }
}

function copyDir(srcDir, dstDir) {
  fs.mkdirSync(dstDir, { recursive: true });
  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    const srcPath = path.join(srcDir, entry.name);
    const dstPath = path.join(dstDir, entry.name);
    if (entry.isFile() && !fs.existsSync(dstPath)) {
      fs.copyFileSync(srcPath, dstPath);
      console.log(`  [ADD] ${path.relative(process.cwd(), dstPath)}`);
    } else if (entry.isDirectory()) {
      copyDir(srcPath, dstPath);
    }
  }
}

export default async function initTemplate(planName) {
  if (!planName) {
    error("Error: --tpl requires a plan name");
    process.exit(1);
  }

  const nopatchRoot = path.join(process.cwd(), NOPATCH_DIR);

  const tplRecordDir = path.join(nopatchRoot, TPL_RECORD_DIR, planName);
  fs.mkdirSync(tplRecordDir, { recursive: true });

  const tplConfigDir = path.join(nopatchRoot, TPL_CONFIG_DIR);
  fs.mkdirSync(tplConfigDir, { recursive: true });

  const configTomlPath = path.join(tplConfigDir, `${planName}.toml`);
  if (!fs.existsSync(configTomlPath)) {
    fs.writeFileSync(configTomlPath, readTemplateToml());
    console.log(`  [ADD] ${path.relative(process.cwd(), configTomlPath)}`);
  } else {
    console.log(`  [SKIP] ${path.relative(process.cwd(), configTomlPath)} (already exists)`);
  }

  console.log(`  [ADD] ${path.relative(process.cwd(), tplRecordDir)}`);
  copyExampleFiles(tplRecordDir);
  console.log(`tpl: init done, place template files in the above directory`);
}
