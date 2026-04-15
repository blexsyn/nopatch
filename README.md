# nopatch

[English](README.en.md)

轻量级 npm 包补丁与模板工具。

---

## 安装

```bash
npm install nopatch --save-dev
```

就这些。安装时会自动在你的 `package.json` 中注入 `postinstall` 钩子，无需手动配置。

**依赖要求**
- Node.js >= 16
- git

---

## 命令

| 命令 | 说明 |
|---|---|
| `nopatch <pkg>` | 为包创建补丁 |
| `nopatch` | 应用所有补丁和模板（postinstall） |
| `nopatch --patch <pkg>` | 应用指定包的补丁 |
| `nopatch --tpl <pkg>` | 初始化包的模板目录 |
| `nopatch --debug` | 显示详细调试日志 |
| `nopatch --help` | 显示帮助 |

---

## 补丁

### 创建补丁

1. 直接修改 `node_modules/<pkg>/` 中的文件。

2. 执行：
   ```bash
   nopatch braces
   nopatch @scope/package
   ```

3. 补丁文件保存到：
   ```
   nopatch/nopatch_record/braces+3.0.3/
   nopatch/nopatch_record/@scope/package+1.0.0/
   ```

### 补丁文件类型

| 后缀 | 含义 |
|---|---|
| `.patch` | 文本差异文件（git unified diff 格式） |
| `.nopatch_latest.<ext>` | 二进制或大文件替换 |
| `.nopatch_delete` | 标记删除的文件（内容为时间戳） |

### 忽略配置

首次运行时自动创建忽略配置文件：

```
nopatch/nopatch_ignore/braces+3.0.3.gitignore
nopatch/nopatch_ignore/@scope/package+1.0.0.gitignore
```

使用 `.gitignore` 语法。默认忽略目录：`node_modules/`、`build/`、`dist/`、`.cache/`、`coverage/`。

---

## 模板

模板在每次 `npm install` 时在补丁之后执行。

### 初始化

```bash
nopatch --tpl braces
nopatch --tpl @scope/package
```

这会创建：

```
nopatch/tpl_record/braces+3.0.3/        # 在此放置模板文件
nopatch/tpl_config/braces+3.0.3/
  data.toml                              # 变量和动态路径配置
```

### 模板文件

- `.mustache` 后缀的文件：内容使用 Mustache 渲染，输出文件名去掉 `.mustache` 后缀。
- 其他文件：原样复制，仅输出路径支持变量替换。
- 未在 `[[dyna_file_path]]` 中配置的文件，默认输出到 `node_modules/<pkg>/` 的对应相对路径。

### data.toml

```toml
[vars]
pkgname      = "com.example.myapp"
pkgname_path = "com/example/myapp"

[[dyna_file_path]]
src       = "wxapi/WXEntryActivity.java.mustache"
dest      = "android/app/src/main/java/{{pkgname_path}}/wxapi/WXEntryActivity.java"
overwrite = false   # 目标存在时跳过（默认：true）

[[dyna_file_path]]
src      = "assets/icon.png"
destRoot = "../../android/app/src/main/res/drawable/icon.png"
```

### 路径字段

| 字段 | 基准 |
|---|---|
| `dest` | `process.cwd()`（项目根目录） |
| `destRoot` | `node_modules/<pkg>/` |
| `destAbs` | 操作系统根目录（绝对路径） |

所有路径字段均支持 Mustache 变量替换。

### overwrite

| 值 | 行为 |
|---|---|
| `true`（默认） | 始终覆盖目标文件 |
| `false` | 目标文件已存在时跳过 |

---

## 目录结构

```
nopatch/
  nopatch_record/          # 补丁文件
    braces+3.0.3/
      lib/
        parse.js.patch
        logo.png.nopatch_latest.png
        old.js.nopatch_delete
    @scope/
      pkg+1.0.0/
        index.js.patch

  nopatch_ignore/          # 忽略配置
    braces+3.0.3.gitignore
    @scope/
      pkg+1.0.0.gitignore

  tpl_record/              # 模板源文件
    braces+3.0.3/
      wxapi/
        WXEntryActivity.java.mustache

  tpl_config/              # 模板数据
    braces+3.0.3/
      data.toml
```

---

## 许可

ISC
