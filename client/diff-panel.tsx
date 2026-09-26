import type { PluginWorkspacePanelProps } from "@getpaseo/plugin/client";
import { useRpc, useWorkspace } from "@getpaseo/plugin/client";
import { ScrollView } from "@getpaseo/plugin/client/react-native";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useSyncExternalStore } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import { reposDiff } from "../shared/repos";
import { getSelection, subscribeSelection } from "./store";

type Theme = PluginWorkspacePanelProps["theme"];

const MAX_LINES = 8_000;

function lineColor(line: string, theme: Theme): string {
  if (line.startsWith("+++") || line.startsWith("---")) return theme.colors.foregroundMuted;
  if (line.startsWith("+")) return theme.colors.statusSuccess;
  if (line.startsWith("-")) return theme.colors.statusDanger;
  if (line.startsWith("@@")) return theme.colors.accent;
  if (/^(diff |index |new file|deleted file|similarity|rename |Binary )/.test(line)) {
    return theme.colors.foregroundMuted;
  }
  return theme.colors.foreground;
}

export function RepoDiffPanel({ theme, layout, workspaceId }: PluginWorkspacePanelProps) {
  const workspace = useWorkspace(workspaceId, (snapshot) => ({ cwd: snapshot.directory }));
  const selection = useSyncExternalStore(subscribeSelection, () => getSelection(workspaceId));
  const diffRpc = useRpc(reposDiff);

  const cwd = workspace?.cwd ?? null;
  const query = useQuery({
    queryKey: [
      "multirepo-diff",
      workspaceId,
      selection?.root,
      selection?.path,
      selection?.mode,
    ],
    enabled: Boolean(cwd && selection),
    queryFn: () =>
      diffRpc({
        cwd: cwd as string,
        root: selection?.root as string,
        path: selection?.path as string,
        mode: selection?.mode ?? "working",
      }),
  });

  const styles = useMemo(
    () => ({
      screen: { flex: 1, backgroundColor: theme.colors.surface0 },
      header: {
        paddingHorizontal: layout.compact ? 12 : 16,
        paddingVertical: 10,
        borderBottomWidth: 1,
        borderBottomColor: theme.colors.border,
        gap: 2,
      },
      path: { color: theme.colors.foreground, fontSize: 13, fontWeight: "600" as const },
      repo: { color: theme.colors.foregroundMuted, fontSize: 12 },
      pad: { padding: 16 },
      diff: { fontSize: 12, lineHeight: 18 },
      muted: { color: theme.colors.foregroundMuted, padding: 16, fontSize: 13 },
      error: { color: theme.colors.statusDanger, padding: 16, fontSize: 13 },
    }),
    [theme, layout.compact],
  );

  if (!selection) {
    return (
      <View style={styles.screen}>
        <Text style={styles.muted}>Select a file in the Repos panel to view its diff.</Text>
      </View>
    );
  }

  const patch = query.data?.patch ?? "";
  const allLines = patch.length > 0 ? patch.split("\n") : [];
  const truncated = allLines.length > MAX_LINES;
  const lines = truncated ? allLines.slice(0, MAX_LINES) : allLines;

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <Text style={styles.path} numberOfLines={1}>
          {selection.path}
        </Text>
        <Text style={styles.repo} numberOfLines={1}>
          {selection.repoName}
          {selection.mode === "staged" ? " · staged" : ""}
        </Text>
      </View>

      {query.isLoading ? (
        <View style={styles.pad}>
          <ActivityIndicator color={theme.colors.accent} />
        </View>
      ) : query.error ? (
        <Text style={styles.error}>
          {query.error instanceof Error ? query.error.message : "Failed to load diff"}
        </Text>
      ) : allLines.length === 0 ? (
        <Text style={styles.muted}>No changes in this file.</Text>
      ) : (
        <ScrollView contentContainerStyle={styles.pad}>
          <ScrollView horizontal>
            <Text selectable style={styles.diff}>
              {lines.map((line, index) => (
                <Text key={index} style={{ color: lineColor(line, theme) }}>
                  {line}
                  {index < lines.length - 1 ? "\n" : ""}
                </Text>
              ))}
            </Text>
          </ScrollView>
          {truncated ? (
            <Text style={styles.muted}>Diff truncated at {MAX_LINES} lines.</Text>
          ) : null}
        </ScrollView>
      )}
    </View>
  );
}
