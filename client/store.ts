import type { PluginClientContext } from "@getpaseo/plugin/client";

export type DiffMode = "working" | "staged";
export type DiffLayout = "split" | "unified";

export interface DiffSelection {
  root: string;
  repoName: string;
  path: string;
  mode: DiffMode;
}

export interface DiffPrefs {
  layout: DiffLayout;
  wordDiff: boolean;
  ignoreWhitespace: boolean;
  wrap: boolean;
  context: number;
}

/** Sibling files of the open diff, so the panel can offer prev/next navigation. */
export interface DiffTraversal {
  files: DiffSelection[];
}

export const DEFAULT_PREFS: DiffPrefs = {
  layout: "split",
  wordDiff: true,
  ignoreWhitespace: false,
  wrap: false,
  context: 3,
};

const MAX_CONTEXT = 200;

let clientRef: PluginClientContext | null = null;
let selections = new Map<string, DiffSelection>();
let traversals = new Map<string, DiffTraversal>();
let preferences = new Map<string, DiffPrefs>();
const listeners = new Set<() => void>();

/** Captured from the client entry so panels can open sibling panels. */
export function setClient(client: PluginClientContext): void {
  clientRef = client;
}

function emit(): void {
  for (const listener of listeners) listener();
}

export function setSelection(workspaceId: string, selection: DiffSelection): void {
  selections = new Map(selections).set(workspaceId, selection);
  emit();
}

export function getSelection(workspaceId: string): DiffSelection | null {
  return selections.get(workspaceId) ?? null;
}

export function getPrefs(workspaceId: string): DiffPrefs {
  return preferences.get(workspaceId) ?? DEFAULT_PREFS;
}

export function updatePrefs(workspaceId: string, patch: Partial<DiffPrefs>): void {
  const next = { ...getPrefs(workspaceId), ...patch };
  if (patch.context !== undefined) {
    next.context = Math.max(0, Math.min(MAX_CONTEXT, Math.round(patch.context)));
  }
  preferences = new Map(preferences).set(workspaceId, next);
  emit();
}

export function subscribeSelection(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Select a file and focus the diff panel as a main workspace tab. */
export function openDiffTab(
  workspaceId: string,
  selection: DiffSelection,
  traversal?: DiffTraversal,
): void {
  setSelection(workspaceId, selection);
  if (traversal) traversals = new Map(traversals).set(workspaceId, traversal);
  clientRef?.openPanel("repos-diff", { workspaceId });
}

/** Move to the neighboring file in the traversal list. Returns true when moved. */
export function stepDiff(workspaceId: string, delta: number): boolean {
  const traversal = traversals.get(workspaceId);
  const current = selections.get(workspaceId);
  if (!traversal || !current) return false;

  const index = traversal.files.findIndex(
    (file) => file.root === current.root && file.path === current.path,
  );
  if (index < 0) return false;

  const next = index + delta;
  if (next < 0 || next >= traversal.files.length) return false;

  setSelection(workspaceId, traversal.files[next]);
  return true;
}

export function getTraversal(workspaceId: string): DiffTraversal | null {
  return traversals.get(workspaceId) ?? null;
}
