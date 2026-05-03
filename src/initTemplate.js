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

function pkgDirName(name, version) {
  if (name.startsWith("@")) {
    const [scope, pkg] = name.split("/");
    return { dirs: [scope, `${pkg}+${version}`] };
  }
  return { dirs: [`${name}+${version}`] };
}

function readTemplateToml() {
  const srcPath = path.join(PKG_ROOT, "_template.toml");
  if (fs.existsSync(srcPath)) {
    return fs.readFileSync(srcPath, "utf8");
  }
  return "";
}

export default async function initTemplate(packageName) {
  const pkgJsonPath = path.join(process.cwd(), "node_modules", packageName, "package.json");
  if (!fs.existsSync(pkgJsonPath)) {
    error(`Error: Package not found: node_modules/${packageName}`);
    process.exit(1);
  }

  const pkgVersion = JSON.parse(fs.readFileSync(pkgJsonPath, "utf8")).version;
  const { dirs } = pkgDirName(packageName, pkgVersion);

  const nopatchRoot = path.join(process.cwd(), NOPATCH_DIR);

  // tpl_record/<pkg+ver>/
  const tplRecordDir = path.join(nopatchRoot, TPL_RECORD_DIR, ...dirs);
  fs.mkdirSync(tplRecordDir, { recursive: true });

  // tpl_config/<pkg+ver>/data.toml
  const tplConfigDir = path.join(nopatchRoot, TPL_CONFIG_DIR, ...dirs);
  fs.mkdirSync(tplConfigDir, { recursive: true });

  const dataTomlPath = path.join(tplConfigDir, "data.toml");
  if (!fs.existsSync(dataTomlPath)) {
    fs.writeFileSync(dataTomlPath, readTemplateToml());
    console.log(`  [ADD] ${path.relative(process.cwd(), dataTomlPath)}`);
  } else {
    console.log(`  [SKIP] ${path.relative(process.cwd(), dataTomlPath)} (already exists)`);
  }

  console.log(`  [ADD] ${path.relative(process.cwd(), tplRecordDir)}`);
  console.log(`tpl: init done, place template files in the above directory`);
}
