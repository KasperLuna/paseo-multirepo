# paseo-multirepo

A [Paseo](https://paseo.sh) plugin that adds a multi-repository Git Changes view to workspaces whose directory contains more than one git repository.

Paseo's built-in Changes panel is bound to a single repository (the workspace `cwd`). When a workspace points at a parent folder holding several independent repos, no diffs appear. This plugin scans the workspace directory, discovers every repo, and renders a per-repo file tree with `+/-` stats and per-file unified diffs — as a normal workspace/Explorer panel, alongside the built-in features.

## Features

- Auto-discovers git repos under the workspace directory (depth-limited), or uses an explicit list.
- Per-repo header: branch, ahead/behind, dirty state, aggregate `+/-` stats.
- Collapsible directory tree with aggregate `+/-` per folder, file-type icons, and a file filter.
- Per-file unified diff (working tree and staged), including untracked files.
- Opening a file focuses a **Repo diff** workspace tab in the main tab area, mirroring Paseo's native Changes → Diff tab flow.
- Live refresh while the panel is open; manual Refresh button.
- Works on desktop, web, and mobile; theme-aware; compact layout.
- Read-only: never stages, commits, or mutates repositories.

## Requirements

- Paseo daemon `>= 0.9.0` (matches the plugin manifest).
- A Paseo client (desktop/web/mobile) capable of running Paseo 0.9 plugins.
- Plugins enabled on the daemon (see below).

## Install

Plugins are trusted, unsandboxed code. This plugin runs a daemon-side subprocess that reads your repositories with the `git` CLI. Review the source before installing.

### 1. Enable plugins on the daemon

Plugins are off unless the daemon config enables them. Add `pluginsEnabled` to the root of `~/.paseo/config.json` (or `$PASEO_HOME/config.json`):

```json
{
  "pluginsEnabled": true
}
```

Then reload:

```bash
paseo reload --json
```

In the desktop app this is equivalent to **Settings → Plugins → Enable plugins**.

### 2. Install from a directory

```bash
paseo plugin install /absolute/path/to/paseo-multirepo
```

### 3. Install from Git (once pushed)

```bash
paseo plugin add KasperLuna/paseo-multirepo
# or pin a revision
paseo plugin add KasperLuna/paseo-multirepo --ref main
```

### 4. Verify

```bash
paseo plugin ls
```

The plugin must report `running` with no load error. If it does not:

```bash
paseo plugin logs paseo-multirepo
```

## Usage

1. Open a workspace whose directory contains your repos (for example a folder with `frontend/`, `backend/`, and `infra/`).
2. Open the **Repos** panel:
   - It lives in the right sidebar (Explorer) alongside **Files** and **Changes**, or
   - Command Center (`⌘K` / `Ctrl+K`) → **Open multi-repo changes** opens it in the sidebar.
3. Expand a repo, then a folder, then tap a file. Its diff opens in a **Repo diff** tab in the main tab area (the same panel is reused for the next file, like Paseo's built-in diff tab).
4. Use the filter box to narrow files, and **Refresh** (or the 2.5 s auto-refresh) to re-read state.

The layout mirrors Paseo's native Changes tab: branch + ahead/behind header, aggregate `+add -del` stats, a collapsible folder tree with per-folder stats, file rows with type icons and a right-side open-in-tab action.

## Configuration

### Auto-discovery (default)

With no config, the plugin scans the workspace directory for `.git` markers up to depth 3, skipping common build/dependency directories (`node_modules`, `dist`, `build`, `target`, `.venv`, …).

### Explicit roots: `.paseo/multirepo.json`

Place this file in the workspace directory to control discovery:

```json
{
  "roots": ["frontend", "backend", "../infra"],
  "exclude": ["*.generated", "vendor"],
  "maxDepth": 2
}
```

| Field      | Type       | Meaning                                                                 |
| ---------- | ---------- | ----------------------------------------------------------------------- |
| `roots`    | `string[]` | Repo roots, relative to the workspace directory (absolute allowed).     |
| `exclude`  | `string[]` | Directory names skipped during auto-discovery. `*` wildcards allowed.   |
| `maxDepth` | `number`   | Auto-discovery depth, 1–8. Default 3.                                   |

When `roots` is present, auto-discovery is disabled and only those roots are used (each must be a git repo).

### VS Code workspace files

If the workspace directory contains a `.code-workspace` file, its `folders[].path` entries are added as explicit roots automatically.

## Limitations

- Read-only. Diff viewing only; no stage/commit/discard.
- No Committed/Uncommitted comparison toggle or Commits section; the tree shows the working tree (plus staged, via the diff RPC).
- File icons are [Lucide](https://lucide.dev) names, not the material icon set the native Changes tab uses.
- Diff is unified only; no split view, syntax highlighting, or word-level diff.
- Untracked files show `+0 -0` because additions/deletions come from `git diff` against `HEAD`.
- A rendered diff is truncated at 8,000 lines and 2 MiB per file; the panel reports truncation.
- Repos whose changes exceed the cap, or binary files, render as git reports them (binary notice, no inline hunks).
- Git submodules show pointer changes only.

## Development

```bash
npm install
npm run typecheck   # tsc --noEmit
npm test            # node --test on the pure parsers/tree builder
paseo plugin reload paseo-multirepo
```

See [docs/IMPLEMENTATION.md](docs/IMPLEMENTATION.md) for architecture, the RPC contract, discovery rules, and security notes.

## License

MIT
