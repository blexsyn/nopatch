# nopatch

[中文](README.md)

Lightweight CLI tool for patching and templating npm packages.

---

## Install

```bash
npm install nopatch --save-dev
```

That's it. A `postinstall` hook is automatically injected into your `package.json`.

**Requirements**
- Node.js >= 16
- git

---

## Commands

| Command | Description |
|---|---|
| `nopatch <pkg>` | Create patch for a package |
| `nopatch` | Apply all patches and templates (postinstall) |
| `nopatch --patch <pkg>` | Apply patch for a specific package |
| `nopatch --tpl <pkg>` | Initialize template dirs for a package |
| `nopatch --max-start <plan>` | Start Max mode recording |
| `nopatch --max-collect <plan>` | Collect changes once (re-call after re-enabling in TOML) |
| `nopatch --max-apply` | Apply all Max mode collected data |
| `nopatch --debug` | Show detailed debug output |
| `nopatch --help` | Show help |

---

## Patch

### Create Patch

1. Modify files directly in `node_modules/<pkg>/`.

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

### Patch File Types

| Suffix | Meaning |
|---|---|
| `.patch` | Text diff (git unified diff format) |
| `.nopatch_latest.<ext>` | Binary or large file replacement |
| `.nopatch_delete` | Mark file for deletion (content is timestamp) |

### Ignore Config

Auto-created on first run:

```
nopatch/nopatch_ignore/braces+3.0.3.gitignore
nopatch/nopatch_ignore/@scope/package+1.0.0.gitignore
```

Uses `.gitignore` syntax. Default ignored dirs: `node_modules/`, `build/`, `dist/`, `.cache/`, `coverage/`.

---

## Template

Templates run after patches on every `npm install`.

### Initialize

```bash
nopatch --tpl braces
nopatch --tpl @scope/package
```

This creates:

```
nopatch/tpl_record/braces+3.0.3/        # Place template files here
nopatch/tpl_config/braces+3.0.3/
  data.toml                              # Variables and dynamic paths
```

### Template Files

- `.mustache` suffix: Content rendered with Mustache, output filename drops `.mustache`.
- Other files: Copied as-is, output path supports variable substitution.
- Files not in `[[dyna_file_path]]` default to `node_modules/<pkg>/` relative path.

### data.toml

```toml
[vars]
pkgname      = "com.example.myapp"
pkgname_path = "com/example/myapp"

[[dyna_file_path]]
src       = "wxapi/WXEntryActivity.java.mustache"
dest      = "android/app/src/main/java/{{pkgname_path}}/wxapi/WXEntryActivity.java"
overwrite = false   # Skip if target exists (default: true)

[[dyna_file_path]]
src      = "assets/icon.png"
destRoot = "../../android/app/src/main/res/drawable/icon.png"
```

### Path Fields

| Field | Base |
|---|---|
| `dest` | `process.cwd()` (project root) |
| `destRoot` | `node_modules/<pkg>/` |
| `destAbs` | OS root (absolute path) |

All path fields support Mustache variable substitution.

### overwrite

| Value | Behavior |
|---|---|
| `true` (default) | Always overwrite target |
| `false` | Skip if target already exists |

---

## Max Mode

Timestamp-based file change collection, for scenarios requiring extensive file modifications.

### 1. Create Plan Config Manually

Create `<plan-name>.toml` under `nopatch/max_mode_config/`, see `_example.toml` for reference.

### 2. Start Recording (once only)

```bash
nopatch --max-start <plan-name>
```

Records the current timestamp. Cannot be re-executed.

### 3. Edit Configuration (repeatable)

Edit `watch_dirs` (supports files and directories, nested paths not allowed) and `delete_paths`.

### 4. After Modifying Files, Collect Changes (repeatable)

```bash
nopatch --max-collect <plan-name>
```

Auto-disables after collection. Set `enabled = true` in TOML to collect again. Steps 3-5 can be repeated.

### 5. Apply Data

Manual only (will not auto-apply on `npm install`):

```bash
# Apply all plans
nopatch --max-apply

# Apply specific plans
nopatch --max-apply plan-a plan-b
```

---

## Directory Structure

```
nopatch/
  nopatch_record/          # Patch files
    braces+3.0.3/
      lib/
        parse.js.patch
        logo.png.nopatch_latest.png
        old.js.nopatch_delete
    @scope/
      pkg+1.0.0/
        index.js.patch

  nopatch_ignore/          # Ignore configs
    braces+3.0.3.gitignore
    @scope/
      pkg+1.0.0.gitignore

  tpl_record/              # Template source files
    braces+3.0.3/
      wxapi/
        WXEntryActivity.java.mustache

  tpl_config/              # Template data
    braces+3.0.3/
      data.toml

  max_mode_config/         # Max mode plan configs
    _example.toml
    myplan.toml

  max_mode_data/           # Max mode collected data
    myplan/
      node_modules/
        some-pkg/
          index.js.nopatch_latest
          old.js.nopatch_delete
```

---

## License

ISC
