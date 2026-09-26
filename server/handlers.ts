import * as path from "node:path";
import { parseNumstat, parsePorcelainV2 } from "../shared/parse";
import type { RepoError, RepoFile, RepoInfo } from "../shared/repos";
import { discoverRepos, loadExplicitConfig } from "./discovery";
import { isGitRepo, runGit } from "./git";

const CACHE_TTL_MS = 1_500;
const MAX_PATCH_BYTES = 2 * 1024 * 1024;

interface SnapshotValue {
  repos: RepoInfo[];
  errors: RepoError[];
  truncated: boolean;
}

const cache = new Map<string, { at: number; value: SnapshotValue }>();

async function buildRepo(root: string): Promise<RepoInfo> {
  const status = await runGit(root, [
    "status",
    "--porcelain=v2",
    "--branch",
    "-z",
    "--untracked-files=all",
  ]);
  if (status.code !== 0) {
    throw new Error(status.stderr.trim() || "git status failed");
  }
  const parsed = parsePorcelainV2(status.stdout);

  const numstat = await runGit(root, ["diff", "--numstat", "-z", "HEAD"]);
  const counts = parseNumstat(numstat.stdout);

  const files: RepoFile[] = parsed.files.map((change) => ({
    path: change.path,
    status: change.status,
    additions: counts.get(change.path)?.additions ?? 0,
    deletions: counts.get(change.path)?.deletions ?? 0,
    staged: change.staged,
  }));

  return {
    root,
    name: path.basename(root),
    branch: parsed.branch,
    ahead: parsed.ahead,
    behind: parsed.behind,
    dirty: files.length > 0,
    files,
  };
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  let index = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (index < items.length) {
      const current = index;
      index += 1;
      results[current] = await fn(items[current]);
    }
  });
  await Promise.all(workers);
  return results;
}

export async function snapshotHandler(input: {
  cwd: string;
  force?: boolean;
}): Promise<SnapshotValue & { generatedAt: string }> {
  const cwd = path.resolve(input.cwd);
  const cached = cache.get(cwd);
  if (!input.force && cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return { ...cached.value, generatedAt: new Date(cached.at).toISOString() };
  }

  const { config, extraRoots, errors: configErrors } = await loadExplicitConfig(cwd);
  const { roots, errors: discoveryErrors, truncated } = await discoverRepos(
    cwd,
    config,
    extraRoots,
  );

  const errors: RepoError[] = [...configErrors, ...discoveryErrors];
  const repos = await mapWithConcurrency(roots, 4, async (root) => {
    try {
      return await buildRepo(root);
    } catch (error) {
      errors.push({ root, message: error instanceof Error ? error.message : String(error) });
      return null;
    }
  });

  const value: SnapshotValue = {
    repos: repos.filter((repo): repo is RepoInfo => repo !== null),
    errors,
    truncated,
  };
  cache.set(cwd, { at: Date.now(), value });
  return { ...value, generatedAt: new Date().toISOString() };
}

/** Reject any path that escapes the repo root. */
function resolveInside(root: string, relative: string): string {
  const resolved = path.resolve(root, relative);
  const prefix = root.endsWith(path.sep) ? root : root + path.sep;
  if (resolved !== root && !resolved.startsWith(prefix)) {
    throw new Error("path escapes repository root");
  }
  return resolved;
}

export async function diffHandler(input: {
  cwd: string;
  root: string;
  path: string;
  mode: "working" | "staged";
}): Promise<{ patch: string; truncated: boolean }> {
  const cwd = path.resolve(input.cwd);
  const root = path.resolve(input.root);

  if (!(await isGitRepo(root))) throw new Error("not a git repository");
  resolveInside(root, input.path);

  const staged = input.mode === "staged";
  const patch =
    !staged && !(await isTracked(root, input.path))
      ? await runGit(root, ["diff", "--no-index", "--", "/dev/null", input.path], {
          maxBuffer: MAX_PATCH_BYTES + 4096,
        })
      : await runGit(
          root,
          [
            "diff",
            "--no-ext-diff",
            "--no-textconv",
            "-U3",
            ...(staged ? ["--cached"] : []),
            "--",
            input.path,
          ],
          { maxBuffer: MAX_PATCH_BYTES + 4096 },
        );

  if (patch.code !== 0 && patch.code !== 1) {
    throw new Error(patch.stderr.trim() || "git diff failed");
  }
  const truncated = Buffer.byteLength(patch.stdout, "utf8") > MAX_PATCH_BYTES;
  return { patch: truncated ? patch.stdout.slice(0, MAX_PATCH_BYTES) : patch.stdout, truncated };
}

async function isTracked(root: string, relative: string): Promise<boolean> {
  const result = await runGit(root, ["ls-files", "--error-unmatch", "--", relative], {
    timeoutMs: 5_000,
  });
  return result.code === 0;
}
