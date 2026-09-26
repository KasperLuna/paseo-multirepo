# Implementation

How `paseo-multirepo` is built, and why. Read [README.md](../README.md) first for install and usage.

## Problem

Paseo binds a workspace's git features to one directory: the workspace `cwd`. Its diff/status code resolves the toplevel of that single path. A workspace pointing at a parent directory that contains N independent repositories has no repository at its root, so the built-in Changes panel stays empty for the nested repos. Paseo also has no multi-root workspace feature (feature request [#1972](https://github.com/getpaseo/paseo/issues/1972) is unimplemented).

The plugin adds a parallel, read-only view. It never modifies Paseo's built-in git behavior. Paseo does not expose an extension point into the native Changes/Diff panel or its tab navigation, so the plugin reproduces the pattern with its own panels: a file list (sidebar) and a diff panel opened as a main workspace tab.

## Plugin runtime split

A Paseo plugin has two optional entry points:

| Entry              | Runtime                  | Capabilities                                              |
| ------------------ | ------------------------ | --------------------------------------------------------- |
| `index.client.tsx` | Paseo app (per client)   | React Native UI, hooks, `useRpc`, workspace/agent context |
| `index.server.ts`  | Daemon subprocess        | Node APIs, shell, filesystem, `server.handle` RPC         |

The client cannot read the filesystem or run git, so all discovery and git work happens on the server. The client sends the workspace directory and receives validated JSON.

```
client/panel.tsx
  useWorkspace(workspaceId) -> cwd
  useRpc(repos.snapshot)({ cwd })      ──►  server/handlers.ts snapshotHandler
  useRpc(repos.diff)({ cwd, root, … }) ──►  server/handlers.ts diffHandler
```

## Files

| Path                   | Runtime | Responsibility                                              |
| ---------------------- | ------- | ----------------------------------------------------------- |
| `shared/repos.ts`      | both    | Zod schemas, `defineRpc` contracts, shared types.           |
| `shared/parse.ts`      | both    | Pure parsers + tree builder (no Node/React imports).        |
| `server/git.ts`        | daemon  | `execFile` git wrapper; argv-only, no shell.                |
| `server/discovery.ts`  | daemon  | Config + `.code-workspace` loading, repo discovery.         |
| `server/handlers.ts`   | daemon  | Snapshot assembly, cache, diff, path validation.            |
| `server/parse.test.ts` | tests   | Node test runner coverage for the pure logic.               |
| `client/panel.tsx`     | app     | `repos` panel: repo/file tree, filter, stats, selection.    |
| `client/diff-panel.tsx`| app     | `repos-diff` panel: main-tab unified-diff renderer.         |
| `client/store.ts`      | app     | Captured client context + per-workspace diff selection.     |
| `index.client.tsx`     | app     | Registers the workspace panel and Command Center item.      |
| `index.server.ts`      | daemon  | Registers the RPC handlers.                                 |

Code lives only in `client/`, `server/`, and `shared/`; the plugin root holds just the entries. Client code imports only React Native + host modules; `shared/parse.ts` imports only `./repos` types so it can run under `node --test` without the plugin runtime.

## RPC contract

Defined once in `shared/repos.ts` with `defineRpc`, validated on both sides.

### `repos.snapshot`

```ts
input:  { cwd: string; force?: boolean }
output: {
  repos: Array<{
    root: string; name: string;
    branch: string | null; ahead: number; behind: number;
    dirty: boolean;
    files: Array<{
      path: string;
      status: "added" | "modified" | "deleted" | "renamed"
            | "untracked" | "conflicted" | "typechange";
      additions: number; deletions: number; staged: boolean;
    }>;
  }>;
  errors: Array<{ root: string; message: string }>;
  truncated: boolean;
  generatedAt: string;
}
```

### `repos.diff`

```ts
input:  {
  cwd: string; root: string; path: string;
  mode: "working" | "staged";
  context?: number;            // lines of context per hunk (default 3, max 200)
  ignoreWhitespace?: boolean;  // git --ignore-all-space
}
output: { patch: string; truncated: boolean }
```

## Server flow

### Discovery

1. `loadExplicitConfig(cwd)` reads `.paseo/multirepo.json` (validated by `repoConfigSchema`) and every `*.code-workspace` file in the directory, collecting `folders[].path` as explicit roots resolved relative to the file.
2. `discoverRepos(cwd, config, extraRoots)`:
   - **Explicit mode** (any config/workspace root): each root must exist and contain `.git`; failures become per-root `errors`, not throws.
   - **Auto mode**: breadth-first scan to `maxDepth` (default 3). A directory containing `.git` is a repo and is not descended into. `SKIP_NAMES` and the `exclude` patterns prune directories. Scanning stops at `MAX_ENTRIES` (50,000) and sets `truncated`.
   - A workspace directory that is itself a repo is returned when no nested repos are found.

### Snapshot

For each discovered root (`mapWithConcurrency` limit 4):

1. `git status --porcelain=v2 --branch -z --untracked-files=all`.
2. `git diff --numstat -z HEAD` for additions/deletions.
3. Merge counts by path and build `RepoInfo`.

The snapshot is cached per `cwd` for 1.5 s (bypassed by `force`). A failure in one repo is recorded in `errors`; other repos still render.

### Parsing

`shared/parse.ts` parses git's machine formats:

- **porcelain v2**: header records (`# branch.head`, `# branch.ab`) plus `?` untracked, `u` unmerged, `1` ordinary, and `2` renamed records. `XY` maps to a `RepoFileStatus`; `X !== "."` marks staged.
- **numstat `-z`**: `add\tdel\tpath` records; renames arrive as an empty path followed by old and new paths.
- **patch** (`parsePatch`): splits a unified patch into files and hunks, tracking old/new line numbers per line and tolerating multi-file patches, binary notices, `\ No newline` markers, and truncation mid-hunk.
- **split rows** (`buildSplitRows`): pairs each run of `-` lines with the `+` run that follows it (git's own ordering), padding the shorter side with `null`. This is the old/new position alignment for the side-by-side view. `intraLineSpans` trims common prefix/suffix from a paired line to highlight the changed span.
- **tree**: files are inserted into a trie; `buildFileRows` flattens it for a given `collapsed` set, aggregating `+/-` for directory rows. Row keys are namespaced by repo root (`${repoRoot}:${path}`).

### Diff

`diffHandler`:

1. Confirms `root` is a git repo.
2. `resolveInside(root, path)` rejects absolute paths and `..` traversal.
3. Untracked + `working` → `git diff --no-index -- /dev/null <path>` (exit code 1 is expected).
4. Otherwise → `git diff --no-ext-diff --no-textconv -U<context> [--ignore-all-space] [--cached] -- <path>`.
5. Caps output at 2 MiB and flags `truncated`.

`context` (expanded by the toolbar's Expand button) and `ignoreWhitespace` are the only
client-controlled git flags; both are bounded/validated by the RPC schema.

## Security

Plugins are trusted and unsandboxed, so the daemon side is written defensively:

- Git is invoked with `execFile` and an argv array — never a shell. Paths are passed as separate arguments.
- `GIT_OPTIONAL_LOCKS=0`, `GIT_PAGER=cat`, `GIT_TERMINAL_PROMPT=0`, `LC_ALL=C`, and `--no-optional-locks` keep git non-interactive and avoid lock contention.
- `--no-ext-diff` and `--no-textconv` prevent a repository's own config from running external diff drivers or text conversion.
- Every client-supplied path is validated to stay inside the resolved repo root; the repo root is re-verified as a git repo.
- Per-repo errors are contained; one bad repository cannot fail the whole snapshot.
- Output buffers and timeouts are bounded (`maxBuffer`, 20 s per git call).

The client display is read-only: no stage, commit, discard, or branch operations.

## Client

Two workspace panels plus a tiny client-side store:

- **`client/panel.tsx` (`repos`)** — the file list. Registered for `locations: ["workspace", "explorer"]`, so it appears in the right sidebar beside Files/Changes and as a workspace tab. Reads `directory` from `useWorkspace`, then a TanStack Query keyed `["multirepo", workspaceId, cwd]` with `refetchInterval: 2500` (active only while mounted). Renders a native-Changes-style layout: branch/ahead/behind header with aggregate stats, a file filter (`TextInput`), a collapsible folder tree with per-folder stats, file-type icons, and a right-side open action.
- **`client/diff-panel.tsx` (`repos-diff`)** — the diff, registered `locations: ["workspace"]` so it opens as a main tab. It reads the current selection and per-workspace preferences from the store, fetches `repos.diff`, parses the patch with `parsePatch`/`buildSplitRows`, and renders either **split** (two aligned columns with old/new gutters, per-side line numbers, word-level highlight) or **unified** (both gutters, git order) from the same parsed rows. The toolbar toggles layout, word highlight, wrap, ignore-whitespace, context expansion, and prev/next file.
- **`client/store.ts`** — module state: the captured `PluginClientContext`, the per-workspace file selection, the **traversal list** (sibling files for prev/next navigation), and **per-workspace diff preferences** (layout, word diff, whitespace, wrap, context). Panel props do not include `openPanel`, so the client entry captures the context at contribute time; selecting a file stores the selection + traversal and calls `client.openPanel("repos-diff", { workspaceId })`. `useSyncExternalStore` subscribes the panels to the store.

UI rules honored: React Native primitives only, colors from `theme.colors` (including `statusSuccess`/`statusDanger` for diff and stats), `layout.compact` padding, accessible roles/labels on every `Pressable`, and `ScrollView`/`TextInput`/`Icon` from the host modules so gestures and theming integrate with Paseo.

## Testing

```bash
npm test          # pure parsers and tree builder
npm run typecheck # full type check for client + server + shared
```

`server/parse.test.ts` runs with Node's built-in test runner and `--experimental-strip-types`, so it needs no extra tooling. Add cases there for any change to `shared/parse.ts`.

## Extension points

The contract is deliberately small. Natural next steps, each additive:

- **Stage/unstage/discard**: add RPC handlers mirroring `checkout.file.*`, gate behind a capability, add row actions.
- **Inline review to agent**: reuse the workspace attachment mechanism via a plugin panel action.
- **Watching instead of polling**: replace the client interval with `server.on`/`fs.watch` and push updates over an RPC subscription.
- **Syntax highlighting**: a tokenizer over `parsePatch`'s `DiffLine.text`, keyed by file extension.

## Known ceilings

- Untracked additions/deletions are `0` (no `HEAD` diff). Counting would need per-file `--no-index` runs.
- Auto-discovery is a bounded BFS, not a full filesystem walk; very deep layouts need explicit `roots`.
- Split rows use git's deletion-then-addition ordering, not a full LCS alignment; heavily interleaved edits pair less precisely.
- Word-level highlight is common-prefix/suffix trimming, not a per-character diff.
- No syntax highlighting.
