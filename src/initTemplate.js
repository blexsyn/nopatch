import fs from "fs";
import path from "path";
import { error } from "./utils.js";

const NOPATCH_DIR = "nopatch";
const TPL_RECORD_DIR = "tpl_record";
const TPL_CONFIG_DIR = "tpl_config";

// 与 createPatch.js 保持一致的目录命名规则
function pkgDirName(name, version) {
  if (name.startsWith("@")) {
    const [scope, pkg] = name.split("/");
    return { dirs: [scope, `${pkg}+${version}`] };
  }
  return { dirs: [`${name}+${version}`] };
}

const DEFAULT_DATA_TOML = `\
# nopatch 模板数据配置 / nopatch template data config
# [vars] 中定义的变量可在模板文件内容和路径字段中使用 {{varName}}
# Variables defined in [vars] can be used in template content and path fields as {{varName}}

[vars]
# 示例 / example:
# pkgname      = "com.example.myapp"
# pkgname_path = "com/example/myapp"   # 用于路径中（. 替换为 /）/ for use in paths (. replaced with /)

# 动态路径配置 / dynamic file path config
# 仅配置需要输出到非默认位置的文件 / only configure files that need non-default output paths
# 未配置的模板文件默认输出到 node_modules/<pkg>/ 对应路径
# unconfigured template files default to node_modules/<pkg>/ at the same relative path
#
# [[dyna_file_path]]
# src      = "path/to/file.mustache"
#            # 相对于 tpl_record/<pkg>/ 的路径 / relative to tpl_record/<pkg>/
#
# dest     = "android/app/src/main/java/{{pkgname_path}}/SomeFile.java"
#            # 相对于命令行当前目录（项目根）/ relative to cwd (project root)
#
# destRoot = "../../android/app/src/main/java/{{pkgname_path}}/SomeFile.java"
#            # 相对于 node_modules/<pkg>/ 目录 / relative to node_modules/<pkg>/
#
# destAbs  = "C:/absolute/path/to/SomeFile.java"
#            # 操作系统绝对路径 / absolute path from OS root
#
# overwrite = true
#            # 默认 true，目标存在时覆盖；false 则目标存在时跳过
#            # default true, overwrite if exists; false to skip if target already exists
`;

export default async function initTemplate(packageName) {
  const pkgJsonPath = path.join(process.cwd(), "node_modules", packageName, "package.json");
  if (!fs.existsSync(pkgJsonPath)) {
    error(`❌ Package not found: node_modules/${packageName}`);
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
    fs.writeFileSync(dataTomlPath, DEFAULT_DATA_TOML);
    console.log(`  [+] ${path.relative(process.cwd(), dataTomlPath)}`);
  } else {
    console.log(`  [=] ${path.relative(process.cwd(), dataTomlPath)} (already exists)`);
  }

  console.log(`  [+] ${path.relative(process.cwd(), tplRecordDir)}`);
  console.log(`tpl: init done, place template files in the above directory`);
}
