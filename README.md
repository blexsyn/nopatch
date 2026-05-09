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
| `nopatch` | 应用所有补丁（postinstall） |
| `nopatch --patch <pkg>` | 应用指定包的补丁 |
| `nopatch --max-start <plan>` | 启动 Max 模式录制（记录时间戳，不可重复） |
| `nopatch --max-collect <plan>` | 采集变更（全量快照，仅一次，restart 后可再次采集） |
| `nopatch --max-collect-force <plan>` | 强制采集（跳过已采集检查，不重置时间戳，不释放补丁，不锁定） |
| `nopatch --max-collect-file <plan> <file>` | 采集单个文件（不检查时间戳，自动提示添加监听目录） |
| `nopatch --max-restart <plan>` | 重启计划（释放数据 + 重置时间戳，准备下一轮采集） |
| `nopatch --max-reset <plan> <file>` | 重置计划（以指定文件的修改时间作为时间戳，不释放数据，未启动则自动 start） |
| `nopatch --max-apply [plan...]` | 应用 Max 采集数据（手动，省略计划名则全部） |
| `nopatch --max-diff <plan>` | 对比采集数据与本地文件差异（仅供查看） |
| `nopatch --tpl-apply [plan...]` | 应用模板（手动，省略计划名则全部） |
| `nopatch --tpl-verify <plan>` | 验证模板计划（检查配置、文件、变量） |
| `nopatch --debug` | 显示详细调试日志 |
| `nopatch --help` | 显示帮助 |

---

## node_modules 补丁

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

模板需要手动执行，不会在 `npm install` 时自动释放。

### 1. 手动创建计划配置

在 `nopatch/tpl_config/` 下创建 `<plan-name>.toml`，参考 `_example.toml`（中文）或 `_example.en.toml`（English）。

### 2. 放置模板文件

在 `nopatch/tpl_record/<plan-name>/` 下放置模板文件，参考 `_example/`。

### 模板文件

- `.mustache` 后缀的文件：内容使用 Mustache 渲染，输出文件名去掉 `.mustache` 后缀。
- 其他文件：原样复制，仅输出路径支持变量替换。
- 未在 `[[dyna_file_path]]` 中配置的文件，默认输出到 `output_base` 的对应相对路径。

### myplan.toml

```toml
[vars]
pkgname      = "com.example.myapp"
pkgname_path = "com/example/myapp"

output_base = "android/app/src/main/java"

[[dyna_file_path]]
src       = "wxapi/WXEntryActivity.java.mustache"
dest      = "{{pkgname_path}}/wxapi/WXEntryActivity.java"
overwrite = false   # 目标存在时跳过（默认：true）

[[dyna_file_path]]
src      = "assets/icon.png"
dest = "../res/drawable/icon.png"
```

### 路径字段

| 字段 | 基准 |
|---|---|
| `dest` | `output_base` |
| `destAbs` | 操作系统根目录（绝对路径） |

所有路径字段均支持 Mustache 变量替换。

### overwrite

| 值 | 行为 |
|---|---|
| `true`（默认） | 始终覆盖目标文件 |
| `false` | 目标文件已存在时跳过 |

### 应用模板

手动执行（不会在 `npm install` 时自动释放）：

```bash
# 释放全部计划
nopatch --tpl-apply

# 释放指定计划
nopatch --tpl-apply myplan
```

---

## Max 模式 补丁

基于时间戳的文件变更采集模式，适用于需要大量修改文件的场景。每次采集为全量快照。

### 1. 手动创建计划配置

在 `nopatch/max_mode_config/` 下创建 `<plan-name>.toml`，参考 `_example.toml`（中文）或 `_example.en.toml`（English）。

### 2. 启动录制（仅一次）

```bash
nopatch --max-start <plan-name>
```

记录当前时间戳。不可重复执行。程序状态写入 TOML 的 `_state` 字段（禁止手动修改）。

### 3. 编辑配置、修改目标文件

编辑 `watch_dirs`（支持文件和目录，不允许嵌套路径）和 `delete_paths`（释放补丁时删除的路径）。

### 4. 修改文件后，采集变更（每次 start 或 restart 后仅一次）

```bash
nopatch --max-collect <plan-name>
```

全量采集 mtime 晚于时间戳的文件。采集后锁定，需 `--max-restart` 才能再次采集。

### 5. 应用数据

手动执行（不会在 `npm install` 时自动释放）：

```bash
# 释放全部计划
nopatch --max-apply

# 释放指定计划
nopatch --max-apply plan-a plan-b
```

### 6. 继续修改（重启计划）

```bash
nopatch --max-restart <plan-name>
```

重置时间戳 → 释放当前数据。

### 7. 手动指定时间戳（重置计划）

```bash
nopatch --max-reset <plan-name> <file-path>
```

以指定文件的修改时间作为新时间戳，**不释放数据**。适用于 `npm install` 后以某个新安装文件的时间为基准。

**注意：** 如果计划未启动，会自动先执行 `--max-start`。

### 8. 手动采集单个文件

```bash
nopatch --max-collect-file <plan-name> <absolute-file-path>
```

手动采集单个文件，**不检查时间戳**。

**特性：**
- 如果文件不在 `watch_dirs` 范围内，会提示是否将文件父目录添加到监听列表
- 确认后会自动修改 TOML 配置文件并添加新的 `watch_dirs` 条目

**示例：**
```bash
nopatch --max-collect-file myplan /path/to/project/node_modules/some-package/src/file.js
```

### 时序

```
start → modify → collect → ... restart → modify → collect → ... → apply
  │        │        │             │         │        │              │
  │        │        │             │         │        │         释放补丁到磁盘
  │        │        │             │         │        │
  │        │        │             │         │      全量补丁快照
  │        │        │             │         │
  │        │        │             │    手动修改目标文件 以及 watch_dirs/delete_paths
  │        │        │       重置时间戳+释放旧数据 
  │        │      全量补丁快照   
  │        │
  │   手动修改目标文件 以及 watch_dirs/delete_paths
  │
记录时间戳
```

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
    _example/
      hello.txt.mustache
    myplan/
      wxapi/
        WXEntryActivity.java.mustache
      assets/
        icon.png

  tpl_config/              # 模板配置
    _example.toml
    _example.en.toml
    myplan.toml

  max_mode_config/         # Max 模式计划配置
    _example.toml
    _example.en.toml
    myplan.toml

  max_mode_data/           # Max 模式采集数据
    myplan/
      node_modules/
        some-pkg/
          index.js.nopatch_latest
          old.js.nopatch_delete
```

---

## 许可

ISC
