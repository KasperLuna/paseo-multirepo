import type { RepoFile, RepoFileStatus } from "./repos";

/**
 * Pure parsers and tree builders. No Node / React imports so they can be
 * unit-tested without the plugin runtime.
 */

export interface RawChange {
  path: string;
  origPath?: string;
  status: RepoFileStatus;
  staged: boolean;
}

export interface ParsedStatus {
  branch: string | null;
  ahead: number;
  behind: number;
  files: RawChange[];
}

function classifyXY(xy: string): RepoFileStatus {
  const x = xy[0] ?? ".";
  const y = xy[1] ?? ".";
  if (x === "D" || y === "D") return "deleted";
  if (x === "A") return "added";
  if (x === "R") return "renamed";
  if (x === "T" || y === "T") return "typechange";
  return "modified";
}

/** Parse `git status --porcelain=v2 --branch -z --untracked-files=all`. */
export function parsePorcelainV2(out: string): ParsedStatus {
  const records = out.split("\0");
  let branch: string | null = null;
  let ahead = 0;
  let behind = 0;
  const files: RawChange[] = [];

  for (let i = 0; i < records.length; i += 1) {
    const record = records[i];
    if (!record) continue;

    if (record.startsWith("# branch.head ")) {
      branch = record.slice("# branch.head ".length).trim();
      continue;
    }
    if (record.startsWith("# branch.ab ")) {
      const match = record.match(/\+(\d+)\s+-(\d+)/);
      if (match) {
        ahead = Number(match[1]);
        behind = Number(match[2]);
      }
      continue;
    }
    if (record.startsWith("#")) continue;

    const kind = record[0];
    if (kind === "?") {
      files.push({ path: record.slice(2), status: "untracked", staged: false });
      continue;
    }
    if (kind === "u") {
      const parts = record.split(" ");
      files.push({
        path: parts.slice(10).join(" "),
        status: "conflicted",
        staged: false,
      });
      continue;
    }
    if (kind === "1" || kind === "2") {
      const parts = record.split(" ");
      const xy = parts[1] ?? "..";
      const entry: RawChange = {
        path: parts.slice(kind === "2" ? 9 : 8).join(" "),
        status: classifyXY(xy),
        staged: xy[0] !== "." && xy[0] !== " " && xy[0] !== "?",
      };
      if (kind === "2") {
        const orig = records[++i];
        if (orig) entry.origPath = orig;
      }
      files.push(entry);
    }
  }
  return { branch, ahead, behind, files };
}

/** Parse `git diff --numstat -z HEAD`. */
export function parseNumstat(out: string): Map<string, { additions: number; deletions: number }> {
  const map = new Map<string, { additions: number; deletions: number }>();
  const records = out.split("\0");
  const num = (value: string) => (value === "-" ? 0 : Number(value) || 0);

  for (let i = 0; i < records.length; i += 1) {
    const record = records[i];
    if (!record) continue;
    const first = record.indexOf("\t");
    const second = record.indexOf("\t", first + 1);
    if (first < 0 || second < 0) continue;
    const additions = record.slice(0, first);
    const deletions = record.slice(first + 1, second);
    const filePath = record.slice(second + 1);
    if (filePath === "") {
      // Rename: empty path, then old path, then new path.
      i += 1;
      const newPath = records[i + 1] ?? "";
      i += 1;
      if (newPath) map.set(newPath, { additions: num(additions), deletions: num(deletions) });
    } else {
      map.set(filePath, { additions: num(additions), deletions: num(deletions) });
    }
  }
  return map;
}

export type DiffLineKind = "add" | "del" | "ctx";

export interface DiffLine {
  kind: DiffLineKind;
  oldNo: number | null;
  newNo: number | null;
  text: string;
}

export interface DiffHunk {
  header: string;
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  lines: DiffLine[];
}

export interface DiffFile {
  header: string[];
  oldPath: string;
  newPath: string;
  binary: boolean;
  hunks: DiffHunk[];
}

export interface SplitRow {
  left: DiffLine | null;
  right: DiffLine | null;
  /** Index of the char run that differs within each side, for intra-line highlight. */
  leftSpan: Span | null;
  rightSpan: Span | null;
}

export interface Span {
  start: number;
  end: number;
}

const HUNK_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

/**
 * Parse a unified patch into files and hunks with old/new line numbers.
 * Handles multiple files in one patch (git emits them for renames), binary
 * notices, and the `\ No newline at end of file` marker.
 */
export function parsePatch(patch: string): DiffFile[] {
  const lines = patch.length > 0 ? patch.split("\n") : [];
  const files: DiffFile[] = [];
  let file: DiffFile | null = null;
  let hunk: DiffHunk | null = null;
  let oldNo = 0;
  let newNo = 0;

  const flushHunk = () => {
    if (file && hunk) file.hunks.push(hunk);
    hunk = null;
  };
  const flushFile = () => {
    flushHunk();
    if (file) files.push(file);
    file = null;
  };

  for (const line of lines) {
    if (line.startsWith("diff --git ")) {
      flushFile();
      const paths = line.slice("diff --git ".length);
      const { oldPath, newPath } = parseGitPaths(paths);
      file = { header: [line], oldPath, newPath, binary: false, hunks: [] };
      continue;
    }
    if (!file) continue;

    if (line.startsWith("@@")) {
      flushHunk();
      const match = HUNK_RE.exec(line);
      const oldStart = match ? Number(match[1]) : 0;
      const oldCount = match?.[2] ? Number(match[2]) : 1;
      const newStart = match ? Number(match[3]) : 0;
      const newCount = match?.[4] ? Number(match[4]) : 1;
      oldNo = oldStart;
      newNo = newStart;
      hunk = { header: line, oldStart, oldCount, newStart, newCount, lines: [] };
      continue;
    }

    if (hunk) {
      const marker = line[0];
      if (marker === "+") {
        hunk.lines.push({ kind: "add", oldNo: null, newNo: newNo++, text: line.slice(1) });
      } else if (marker === "-") {
        hunk.lines.push({ kind: "del", oldNo: oldNo++, newNo: null, text: line.slice(1) });
      } else if (marker === " ") {
        hunk.lines.push({ kind: "ctx", oldNo: oldNo++, newNo: newNo++, text: line.slice(1) });
      } else if (marker === "\\") {
        // No-newline marker applies to the previous line; nothing to add.
      } else if (line === "") {
        // Trailing blank line from the split; ignore.
      }
      continue;
    }

    // Metadata before the first hunk.
    file.header.push(line);
    if (/^(Binary files|GIT binary patch)/.test(line)) file.binary = true;
    if (line.startsWith("--- ")) file.oldPath = stripPathPrefix(line.slice(4));
    if (line.startsWith("+++ ")) file.newPath = stripPathPrefix(line.slice(4));
  }

  flushFile();
  return files;
}

function stripPathPrefix(value: string): string {
  const trimmed = value.trim();
  if (trimmed === "/dev/null") return trimmed;
  const match = /^[ab]\/(.*)$/.exec(trimmed);
  return match ? match[1] : trimmed;
}

/** `a/old\tb/new` (with optional quoting) → old/new paths without the a/ b/ prefixes. */
function parseGitPaths(value: string): { oldPath: string; newPath: string } {
  const parts = value.split("\t");
  const oldRaw = parts[0] ?? "";
  const newRaw = parts[1] ?? parts[0] ?? "";
  return { oldPath: stripPathPrefix(oldRaw), newPath: stripPathPrefix(newRaw) };
}

/**
 * Pair deletions with the additions that follow them into side-by-side rows.
 * Git emits the `-` run immediately before the `+` run inside a hunk, so
 * adjacency pairing is exact for typical hunks and needs no extra data.
 */
export function buildSplitRows(hunk: DiffHunk, wordDiff: boolean): SplitRow[] {
  const rows: SplitRow[] = [];
  let i = 0;
  const lines = hunk.lines;

  while (i < lines.length) {
    const line = lines[i];
    if (line.kind === "ctx") {
      rows.push({ left: line, right: line, leftSpan: null, rightSpan: null });
      i += 1;
      continue;
    }
    const dels: DiffLine[] = [];
    const adds: DiffLine[] = [];
    while (i < lines.length && lines[i].kind === "del") dels.push(lines[i++]);
    while (i < lines.length && lines[i].kind === "add") adds.push(lines[i++]);
    const count = Math.max(dels.length, adds.length);
    const delSpans = wordDiff ? wordDiffSpans(dels.map((d) => d.text)) : null;
    const addSpans = wordDiff ? wordDiffSpans(adds.map((a) => a.text)) : null;
    for (let row = 0; row < count; row += 1) {
      rows.push({
        left: dels[row] ?? null,
        right: adds[row] ?? null,
        leftSpan: delSpans?.[row] ?? null,
        rightSpan: addSpans?.[row] ?? null,
      });
    }
  }
  return rows;
}

/** Common-prefix/suffix trim, then mark the remaining middle as the changed span. */
function diffSpan(a: string, b: string): Span | null {
  if (a === b) return null;
  let start = 0;
  const max = Math.min(a.length, b.length);
  while (start < max && a[start] === b[start]) start += 1;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA -= 1;
    endB -= 1;
  }
  return { start, end: endA };
}

function wordDiffSpans(side: string[]): (Span | null)[] {
  return side.map((text, index) => {
    const other = side[index];
    return other === undefined ? null : diffSpan(text, other);
  });
}

/**
 * Best-effort intra-line spans for paired split rows. Recomputed per row from
 * the paired line so no cross-row state is needed.
 */
export function intraLineSpans(left: string | null, right: string | null): {
  leftSpan: Span | null;
  rightSpan: Span | null;
} {
  if (left === null || right === null) return { leftSpan: null, rightSpan: null };
  const leftSpan = diffSpan(left, right);
  if (leftSpan === null) return { leftSpan: null, rightSpan: null };
  const rightSpan = diffSpan(right, left);
  return { leftSpan, rightSpan };
}

export interface FileRow {
  kind: "dir" | "file";
  key: string;
  name: string;
  path: string;
  depth: number;
  additions: number;
  deletions: number;
  status: RepoFileStatus | null;
}

interface TreeNode {
  name: string;
  path: string;
  dir: boolean;
  children: Map<string, TreeNode>;
  file?: RepoFile;
}

function buildTree(files: RepoFile[]): TreeNode {
  const root: TreeNode = { name: "", path: "", dir: true, children: new Map() };
  for (const file of files) {
    const segments = file.path.split("/").filter(Boolean);
    let node = root;
    let current = "";
    for (let i = 0; i < segments.length; i += 1) {
      const segment = segments[i];
      current = current ? `${current}/${segment}` : segment;
      const isFile = i === segments.length - 1;
      let child = node.children.get(segment);
      if (!child) {
        child = { name: segment, path: current, dir: !isFile, children: new Map() };
        node.children.set(segment, child);
      }
      if (isFile) child.file = file;
      else node = child;
    }
  }
  return root;
}

function aggregate(node: TreeNode): { additions: number; deletions: number } {
  if (!node.dir) {
    return { additions: node.file?.additions ?? 0, deletions: node.file?.deletions ?? 0 };
  }
  let additions = 0;
  let deletions = 0;
  for (const child of node.children.values()) {
    const sum = aggregate(child);
    additions += sum.additions;
    deletions += sum.deletions;
  }
  return { additions, deletions };
}

/**
 * Flatten files into ordered tree rows. `collapsed` holds `${repoKey}:${dirPath}`
 * keys for collapsed directories; `repoKey` namespaces rows across repos.
 */
export function buildFileRows(files: RepoFile[], collapsed: Set<string>, repoKey: string): FileRow[] {
  const rows: FileRow[] = [];
  const root = buildTree(files);

  const walk = (node: TreeNode, depth: number) => {
    const entries = [...node.children.values()].sort((a, b) =>
      a.dir === b.dir ? a.name.localeCompare(b.name) : a.dir ? -1 : 1,
    );
    for (const entry of entries) {
      if (entry.dir) {
        const sum = aggregate(entry);
        rows.push({
          kind: "dir",
          key: `${repoKey}:${entry.path}`,
          name: entry.name,
          path: entry.path,
          depth,
          additions: sum.additions,
          deletions: sum.deletions,
          status: null,
        });
        if (!collapsed.has(`${repoKey}:${entry.path}`)) walk(entry, depth + 1);
      } else if (entry.file) {
        rows.push({
          kind: "file",
          key: `${repoKey}:${entry.path}`,
          name: entry.name,
          path: entry.path,
          depth,
          additions: entry.file.additions,
          deletions: entry.file.deletions,
          status: entry.file.status,
        });
      }
    }
  };

  walk(root, 0);
  return rows;
}
