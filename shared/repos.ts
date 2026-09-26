import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

/**
 * Optional `.paseo/multirepo.json` in the workspace directory.
 * When absent, repos are auto-discovered under the workspace directory.
 */
export const repoConfigSchema = z.object({
  /** Explicit repo roots, relative to the workspace directory (or absolute). */
  roots: z.array(z.string().min(1)).optional(),
  /** Directory names to skip during auto-discovery. `*` wildcards allowed. */
  exclude: z.array(z.string().min(1)).optional(),
  /** Max directory depth for auto-discovery. Default 3. */
  maxDepth: z.number().int().min(1).max(8).optional(),
});
export type RepoConfig = z.infer<typeof repoConfigSchema>;

export const fileStatusSchema = z.enum([
  "added",
  "modified",
  "deleted",
  "renamed",
  "untracked",
  "conflicted",
  "typechange",
]);
export type RepoFileStatus = z.infer<typeof fileStatusSchema>;

export const repoFileSchema = z.object({
  path: z.string(),
  status: fileStatusSchema,
  additions: z.number().int().nonnegative(),
  deletions: z.number().int().nonnegative(),
  staged: z.boolean(),
});
export type RepoFile = z.infer<typeof repoFileSchema>;

export const repoInfoSchema = z.object({
  root: z.string(),
  name: z.string(),
  branch: z.string().nullable(),
  ahead: z.number().int().nonnegative(),
  behind: z.number().int().nonnegative(),
  dirty: z.boolean(),
  files: z.array(repoFileSchema),
});
export type RepoInfo = z.infer<typeof repoInfoSchema>;

export const repoErrorSchema = z.object({ root: z.string(), message: z.string() });
export type RepoError = z.infer<typeof repoErrorSchema>;

export const reposSnapshot = defineRpc({
  name: "repos.snapshot",
  input: z.object({ cwd: z.string().min(1), force: z.boolean().optional() }),
  output: z.object({
    repos: z.array(repoInfoSchema),
    errors: z.array(repoErrorSchema),
    truncated: z.boolean(),
    generatedAt: z.string(),
  }),
});

export const reposDiff = defineRpc({
  name: "repos.diff",
  input: z.object({
    cwd: z.string().min(1),
    root: z.string().min(1),
    path: z.string().min(1),
    mode: z.enum(["working", "staged"]),
  }),
  output: z.object({ patch: z.string(), truncated: z.boolean() }),
});
