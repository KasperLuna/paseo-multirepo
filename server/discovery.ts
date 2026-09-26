import * as fs from "node:fs/promises";
import * as path from "node:path";
import { repoConfigSchema, type RepoConfig } from "../shared/repos";

/** Names never descended into during auto-discovery. */
const SKIP_NAMES = new Set([
  "node_modules",
  ".git",
  ".hg",
  ".svn",
  ".cache",
  ".next",
  ".nuxt",
  ".venv",
  "venv",
  "dist",
  "build",
  "target",
  "vendor",
]);

const MAX_ENTRIES = 50_000;

function wildcardToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`);
}

async function pathExists(candidate: string): Promise<boolean> {
  try {
    await fs.stat(candidate);
    return true;
  } catch {
    return false;
  }
}

async function isRepoRoot(dir: string): Promise<boolean> {
  return pathExists(path.join(dir, ".git"));
}

/** Read `.paseo/multirepo.json` and any `.code-workspace` folder entries. */
export async function loadExplicitConfig(cwd: string): Promise<{
  config: RepoConfig;
  extraRoots: string[];
  errors: { root: string; message: string }[];
}> {
  const errors: { root: string; message: string }[] = [];
  let config: RepoConfig = {};

  const configPath = path.join(cwd, ".paseo", "multirepo.json");
  try {
    const raw = await fs.readFile(configPath, "utf8");
    const parsed = repoConfigSchema.safeParse(JSON.parse(raw));
    if (parsed.success) config = parsed.data;
    else errors.push({ root: configPath, message: "invalid .paseo/multirepo.json" });
  } catch {
    // No config file, or unreadable JSON: fall back to auto-discovery.
  }

  const extraRoots: string[] = [];
  try {
    const entries = await fs.readdir(cwd, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".code-workspace")) continue;
      const file = path.join(cwd, entry.name);
      try {
        const parsed = JSON.parse(await fs.readFile(file, "utf8")) as {
          folders?: { path?: string }[];
        };
        for (const folder of parsed.folders ?? []) {
          if (folder.path) extraRoots.push(path.resolve(path.dirname(file), folder.path));
        }
      } catch {
        errors.push({ root: file, message: "unreadable .code-workspace file" });
      }
    }
  } catch {
    // Directory unreadable: ignore.
  }

  return { config, extraRoots, errors };
}

/**
 * Discover repo roots for a workspace directory.
 * Explicit roots (config + .code-workspace) win; otherwise a depth-limited scan.
 */
export async function discoverRepos(
  cwd: string,
  config: RepoConfig,
  extraRoots: string[] = [],
): Promise<{ roots: string[]; errors: { root: string; message: string }[]; truncated: boolean }> {
  const errors: { root: string; message: string }[] = [];
  const explicit = [
    ...(config.roots ?? []).map((root) => path.resolve(cwd, root)),
    ...extraRoots,
  ];

  if (explicit.length > 0) {
    const roots: string[] = [];
    for (const root of explicit) {
      if (!(await pathExists(root))) {
        errors.push({ root, message: "path not found" });
        continue;
      }
      if (!(await isRepoRoot(root))) {
        errors.push({ root, message: "not a git repository" });
        continue;
      }
      roots.push(root);
    }
    return { roots: [...new Set(roots)], errors, truncated: false };
  }

  const maxDepth = config.maxDepth ?? 3;
  const excludes = (config.exclude ?? []).map(wildcardToRegExp);
  const roots: string[] = [];
  const queue: { dir: string; depth: number }[] = [{ dir: cwd, depth: 0 }];
  let scanned = 0;
  let truncated = false;

  while (queue.length > 0) {
    const { dir, depth } = queue.shift() as { dir: string; depth: number };
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      scanned += 1;
      if (scanned > MAX_ENTRIES) {
        truncated = true;
        break;
      }
      if (!entry.isDirectory()) continue;
      if (SKIP_NAMES.has(entry.name) || excludes.some((rule) => rule.test(entry.name))) continue;

      const child = path.join(dir, entry.name);
      if (await isRepoRoot(child)) {
        roots.push(child);
        continue;
      }
      if (depth + 1 < maxDepth) queue.push({ dir: child, depth: depth + 1 });
    }
    if (truncated) break;
  }

  // A workspace directory that is itself a repo should still show.
  if (roots.length === 0 && (await isRepoRoot(cwd))) roots.push(cwd);

  return { roots: [...new Set(roots)].sort(), errors, truncated };
}
