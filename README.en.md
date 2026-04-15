# nopatch

[中文文档](README.md)

A lightweight CLI tool for patching and templating npm packages.

---

## Installation

```bash
npm install nopatch --save-dev
```

That's it. The `postinstall` hook is automatically added to your `package.json` on install.

**Requirements**
- Node.js >= 16
- git

---

## Commands

| Command | Description |
|---|---|
| `nopatch <pkg>` | Create patch for a package |
| `nopatch` | Apply all patches + templates (postinstall) |
| `nopatch --patch <pkg>` | Apply patch for specific package |
| `nopatch --tpl <pkg>` | Initialize template dirs for a package |
| `nopatch --debug` | Show detailed debug output |
| `nopatch --help` | Show help |

---

## Patching

### Create a patch

1. Modify files inside `node_modules/<pkg>/` as needed.

2. Run:
   ```bash
   nopatch braces
   nopatch @scope/package
   ```

3. Patch files are saved to:
   ```
   nopatch/nopatch_record/braces+3.0.3/
   nopatch/nopatch_record/@scope/package+1.0.0/
   ```

### Patch file types

| Suffix | Meaning |
|---|---|
| `.patch` | Text diff (git unified diff format) |
| `.nopatch_latest.<ext>` | Binary or large file replacement |
| `.nopatch_delete` | Marks a deleted file (contains timestamp) |

### Ignore config

On first run, an ignore file is auto-created:

```
nopatch/nopatch_ignore/braces+3.0.3.gitignore
nopatch/nopatch_ignore/@scope/package+1.0.0.gitignore
```

Uses `.gitignore` syntax. Default ignored dirs: `node_modules/`, `build/`, `dist/`, `.cache/`, `coverage/`.

---

## Templates

Templates are applied **after** patches on every `npm install`.

### Initialize

```bash
nopatch --tpl braces
nopatch --tpl @scope/package
```

This creates:

```
nopatch/tpl_record/braces+3.0.3/        # place template files here
nopatch/tpl_config/braces+3.0.3/
  data.toml                              # variables + dynamic path config
```

### Template files

- Files with `.mustache` suffix: content is rendered with [Mustache](https://mustache.github.io/), output filename has `.mustache` removed.
- Other files: copied as-is, only output path supports variable substitution.
- Files **not** listed in `[[dyna_file_path]]` are output to the same relative path inside `node_modules/<pkg>/`.

### data.toml

```toml
[vars]
pkgname      = "com.example.myapp"
pkgname_path = "com/example/myapp"

[[dyna_file_path]]
src       = "wxapi/WXEntryActivity.java.mustache"
dest      = "android/app/src/main/java/{{pkgname_path}}/wxapi/WXEntryActivity.java"
overwrite = false   # skip if target already exists (default: true)

[[dyna_file_path]]
src      = "assets/icon.png"
destRoot = "../../android/app/src/main/res/drawable/icon.png"
```

### Path fields

| Field | Base |
|---|---|
| `dest` | `process.cwd()` (project root) |
| `destRoot` | `node_modules/<pkg>/` |
| `destAbs` | OS root (absolute path) |

All path fields support Mustache variable substitution.

### overwrite

| Value | Behavior |
|---|---|
| `true` (default) | Always overwrite target file |
| `false` | Skip if target already exists |

---

## Directory structure

```
nopatch/
  nopatch_record/          # patch files
    braces+3.0.3/
      lib/
        parse.js.patch
        logo.png.nopatch_latest.png
        old.js.nopatch_delete
    @scope/
      pkg+1.0.0/
        index.js.patch

  nopatch_ignore/          # ignore configs
    braces+3.0.3.gitignore
    @scope/
      pkg+1.0.0.gitignore

  tpl_record/              # template source files
    braces+3.0.3/
      wxapi/
        WXEntryActivity.java.mustache

  tpl_config/              # template data
    braces+3.0.3/
      data.toml
```

---

## License

ISC
