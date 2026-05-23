import fs from "fs";
import path from "path";
import { error } from "./utils.js";

const NOPATCH_DIR = "nopatch";
const MIN_DIR = "min_mode";
const DEL_SUFFIX = ".nopatch_delete";

function minDir() {
  return path.join(process.cwd(), NOPATCH_DIR, MIN_DIR);
}

/**
 * 将指定绝对路径的文件复制到 nopatch/min_mode/<相对路径>（覆盖）
 * Copy the specified absolute path file to nopatch/min_mode/<relative path> (overwrite)
 */
export function minCollect(absFilePath) {
  const absPath = path.resolve(absFilePath);

  if (!fs.existsSync(absPath)) {
    error(`Error: File not found: ${absPath}`);
    process.exit(1);
  }

  const stat = fs.statSync(absPath);
  if (!stat.isFile()) {
    error(`Error: Not a file: ${absPath}`);
    process.exit(1);
  }

  const cwd = process.cwd();
  const relPath = path.relative(cwd, absPath).replace(/\\/g, "/");

  if (relPath.startsWith("..")) {
    error(`Error: File must be inside the project root: ${absPath}`);
    process.exit(1);
  }

  const destPath = path.join(minDir(), relPath);
  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  fs.copyFileSync(absPath, destPath);

  console.log(`min: collected ${relPath}`);
  console.log(`     source: ${absPath}`);
  console.log(`     target: ${destPath}`);
}

/**
 * 标记指定路径（相对或绝对）在 apply 时删除
 * Mark a file/dir for deletion on apply
 */
export function minDel(filePath) {
  const absPath = path.resolve(filePath);
  const cwd = process.cwd();
  const relPath = path.relative(cwd, absPath).replace(/\\/g, "/");

  if (relPath.startsWith("..")) {
    error(`Error: Path must be inside the project root: ${absPath}`);
    process.exit(1);
  }

  const markerPath = path.join(minDir(), relPath + DEL_SUFFIX);
  fs.mkdirSync(path.dirname(markerPath), { recursive: true });
  fs.writeFileSync(markerPath, new Date().toISOString(), "utf8");

  console.log(`min: marked for deletion: ${relPath}`);
  console.log(`     marker: ${markerPath}`);
}

/**
 * 将 nopatch/min_mode 下的所有文件还原到项目对应位置
 * Restore all files from nopatch/min_mode to their original locations
 */
export function minApply() {
  const base = minDir();
  if (!fs.existsSync(base)) return;

  const cwd = process.cwd();
  let addCount = 0;
  let delCount = 0;

  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else {
        const rel = path.relative(base, full).replace(/\\/g, "/");
        if (rel.endsWith(DEL_SUFFIX)) {
          const targetRel = rel.slice(0, -DEL_SUFFIX.length);
          const targetPath = path.join(cwd, targetRel);
          if (fs.existsSync(targetPath)) {
            const stat = fs.statSync(targetPath);
            if (stat.isDirectory()) {
              fs.rmSync(targetPath, { recursive: true, force: true });
            } else {
              fs.rmSync(targetPath);
            }
            console.log(`  [DEL] ${targetRel}`);
          } else {
            console.log(`  [SKIP DEL] ${targetRel} (not found)`);
          }
          delCount++;
        } else {
          const targetPath = path.join(cwd, rel);
          fs.mkdirSync(path.dirname(targetPath), { recursive: true });
          fs.copyFileSync(full, targetPath);
          console.log(`  [ADD] ${rel}`);
          addCount++;
        }
      }
    }
  }

  walk(base);

  if (addCount > 0 || delCount > 0) {
    console.log(`min: ${addCount} file(s) added, ${delCount} deletion(s) applied`);
  }
}
