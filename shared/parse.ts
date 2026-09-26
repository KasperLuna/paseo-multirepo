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
