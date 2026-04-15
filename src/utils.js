import chalk from "chalk";
import fs from "fs";
import { isBinaryFileSync } from "isbinaryfile";

export function log(...args) {
  if (process.env.DEBUG) {
    console.log(chalk.blueBright(...args));
  }
}

export function error(...args) {
  console.log(chalk.red.bold(...args));
}

// 判断 buffer 是否为二进制（使用 isbinaryfile，业界标准实现）
export function isBinary(buffer) {
  return isBinaryFileSync(buffer, buffer.length);
}

// 超过 512KB 不做 diff
export const MAX_DIFF_SIZE = 512 * 1024;

// 解析 .gitignore 风格的 ignore 文件，返回一个带 ignores(path) 方法的对象
export function loadIgnore(ignoreFile) {
  const lines = fs.existsSync(ignoreFile)
    ? fs.readFileSync(ignoreFile, "utf8").split("\n")
    : [];

  // 解析规则：过滤注释和空行，转为正则
  const rules = lines
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"))
    .map((pattern) => {
      // 目录规则（以 / 结尾）
      const dirOnly = pattern.endsWith("/");
      const p = pattern.replace(/\/$/, "");
      // 转义特殊字符，* 转为 [^/]*，** 转为 .*
      const regexStr = p
        .replace(/[.+^${}()|[\]\\]/g, "\\$&")
        .replace(/\*\*/g, "§§")
        .replace(/\*/g, "[^/]*")
        .replace(/§§/g, ".*");
      return { regex: new RegExp(`(^|/)${regexStr}(/|$)`), dirOnly };
    });

  return {
    ignores(relPath) {
      for (const rule of rules) {
        if (rule.dirOnly && !relPath.endsWith("/")) continue;
        if (rule.regex.test(relPath)) return true;
      }
      return false;
    },
  };
}
