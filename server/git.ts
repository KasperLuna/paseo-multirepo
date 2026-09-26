import { execFile } from "node:child_process";

export interface GitResult {
  stdout: string;
  stderr: string;
  code: number;
}

const GIT_ENV: NodeJS.ProcessEnv = {
  ...process.env,
  GIT_OPTIONAL_LOCKS: "0",
  GIT_PAGER: "cat",
  GIT_TERMINAL_PROMPT: "0",
  LC_ALL: "C",
};

/**
 * Run git with an argv array (never a shell) from the given repo root.
 * Non-zero exits are returned, not thrown, so callers can read stdout/stderr.
 */
export function runGit(
  root: string,
  args: string[],
  options?: { maxBuffer?: number; timeoutMs?: number },
): Promise<GitResult> {
  return new Promise((resolve) => {
    execFile(
      "git",
      ["-C", root, "--no-optional-locks", ...args],
      {
        env: GIT_ENV,
        maxBuffer: options?.maxBuffer ?? 8 * 1024 * 1024,
        timeout: options?.timeoutMs ?? 20_000,
        windowsHide: true,
      },
      (error, stdout, stderr) => {
        const code =
          error && typeof (error as { code?: unknown }).code === "number"
            ? (error as { code: number }).code
            : error
              ? 1
              : 0;
        resolve({ stdout: String(stdout ?? ""), stderr: String(stderr ?? ""), code });
      },
    );
  });
}

/** True when `root` is (or is inside) a git work tree. */
export async function isGitRepo(root: string): Promise<boolean> {
  const result = await runGit(root, ["rev-parse", "--is-inside-work-tree"], { timeoutMs: 5_000 });
  return result.code === 0 && result.stdout.trim() === "true";
}
