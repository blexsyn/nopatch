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
| `nopatch` | Apply all patches (postinstall) |
| `nopatch --patch <pkg>` | Apply patch for a specific package |
| `nopatch --max-start <plan>` | Start Max mode recording (records timestamp, once only) |
| `nopatch --max-collect <plan>` | Collect changes (full snapshot, once only, restart to collect again) |
| `nopatch --max-collect-force <plan>` | Force collect (skip collected check, no timestamp reset, no patch release, no lock) |
| `nopatch --max-restart <plan>` | Restart plan (release data + reset timestamp for next collect) |
| `nopatch --max-reset <plan> <file>` | Reset plan (use file's mtime as timestamp, does NOT release data) |
| `nopatch --max-apply [plan...]` | Apply Max collected data (manual, all plans if omitted) |
| `nopatch --max-diff <plan>` | Diff collected data vs local files (view only) |
| `nopatch --tpl-apply [plan...]` | Apply templates (manual, all plans if omitted) |
| `nopatch --tpl-verify <plan>` | Verify template plan (check config, files, variables) |
| `nopatch --debug` | Show detailed debug output |
| `nopatch --help` | Show help |

---

## node_modules Patch

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

Templates must be applied manually. They will not auto-apply on `npm install`.

### 1. Create Plan Config Manually

Create `<plan-name>.toml` under `nopatch/tpl_config/`, see `_example.toml` (Chinese) or `_example.en.toml` (English) for reference.

### 2. Place Template Files

Place template files under `nopatch/tpl_record/<plan-name>/`, see `_example/` for reference.

### Template Files

- `.mustache` suffix: Content rendered with Mustache, output filename drops `.mustache`.
- Other files: Copied as-is, output path supports variable substitution.
- Files not in `[[dyna_file_path]]` default to `output_base` relative path.

### myplan.toml

```toml
[vars]
pkgname      = "com.example.myapp"
pkgname_path = "com/example/myapp"

output_base = "android/app/src/main/java"

[[dyna_file_path]]
src       = "wxapi/WXEntryActivity.java.mustache"
dest      = "{{pkgname_path}}/wxapi/WXEntryActivity.java"
overwrite = false   # Skip if target exists (default: true)

[[dyna_file_path]]
src      = "assets/icon.png"
dest = "../res/drawable/icon.png"
```

### Path Fields

| Field | Base |
|---|---|
| `dest` | `output_base` |
| `destAbs` | OS root (absolute path) |

All path fields support Mustache variable substitution.

### overwrite

| Value | Behavior |
|---|---|
| `true` (default) | Always overwrite target |
| `false` | Skip if target already exists |

### Apply Templates

Manual only (will not auto-apply on `npm install`):

```bash
# Apply all plans
nopatch --tpl-apply

# Apply specific plan
nopatch --tpl-apply myplan
```

---

## Max Mode Patch

Timestamp-based file change collection, for scenarios requiring extensive file modifications. Each collect is a full snapshot.

### 1. Create Plan Config Manually

Create `<plan-name>.toml` under `nopatch/max_mode_config/`, see `_example.toml` (Chinese) or `_example.en.toml` (English) for reference.

### 2. Start Recording (once only)

```bash
nopatch --max-start <plan-name>
```

Records the current timestamp. Cannot be re-executed. Program state is stored in the `_state` field of the TOML (do not modify manually).

### 3. Edit Configuration 、Modify Target Files

Edit `watch_dirs` (supports files and directories, nested paths not allowed) and `delete_paths`.

### 4. After Modifying Files, Collect Changes (once per start or restart)

```bash
nopatch --max-collect <plan-name>
```

Full snapshot of all files with mtime later than the timestamp. Locked after collection, use `--max-restart` to collect again.

### 5. Apply Data

Manual only (will not auto-apply on `npm install`):

```bash
# Apply all plans
nopatch --max-apply

# Apply specific plans
nopatch --max-apply plan-a plan-b
```

### 6. Continue Modifying (Restart Plan)

```bash
nopatch --max-restart <plan-name>
```

Reset timestamp, release current data.

### 7. Manual Timestamp (Reset Plan)

```bash
nopatch --max-reset <plan-name> <file-path>
```

Use the specified file's modification time as the new timestamp, **does NOT release data**. Useful after `npm install` to baseline against a freshly installed file.

### Sequence

```
start → modify → collect → ... restart → modify → collect → ... → apply
  │        │        │             │         │        │              │
  │        │        │             │         │        │        release patch to disk
  │        │        │             │         │        │
  │        │        │             │         │     full patch snapshot
  │        │        │             │         │
  │        │        │             │     modify target files and watch_dirs/delete_paths
  │        │        │    reset timestamp + release old data
  │        │     full patch snapshot 
  │        │
  │    modify target files and watch_dirs/delete_paths
  │
record timestamp
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
    _example/
      hello.txt.mustache
    myplan/
      wxapi/
        WXEntryActivity.java.mustache
      assets/
        icon.png

  tpl_config/              # Template configs
    _example.toml
    _example.en.toml
    myplan.toml

  max_mode_config/         # Max mode plan configs
    _example.toml
    _example.en.toml
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
