import type { PluginClientContext } from "@getpaseo/plugin/client";

export interface DiffSelection {
  root: string;
  repoName: string;
  path: string;
  mode: "working" | "staged";
}

let clientRef: PluginClientContext | null = null;
let selections = new Map<string, DiffSelection>();
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

export function subscribeSelection(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Select a file and focus the diff panel as a main workspace tab. */
export function openDiffTab(workspaceId: string, selection: DiffSelection): void {
  setSelection(workspaceId, selection);
  clientRef?.openPanel("repos-diff", { workspaceId });
}
