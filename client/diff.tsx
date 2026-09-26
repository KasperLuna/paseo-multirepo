import type { PluginWorkspacePanelProps } from "@getpaseo/plugin/client";
import { useRpc } from "@getpaseo/plugin/client";
import { Modal, ScrollView } from "@getpaseo/plugin/client/react-native";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import { reposDiff } from "../shared/repos";

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

export interface DiffModalProps {
  cwd: string;
  root: string;
  path: string;
  mode: "working" | "staged";
  theme: Theme;
  onClose: () => void;
}

export function DiffModal({ cwd, root, path, mode, theme, onClose }: DiffModalProps) {
  const diff = useRpc(reposDiff);
  const query = useQuery({
    queryKey: ["multirepo-diff", cwd, root, path, mode],
    queryFn: () => diff({ cwd, root, path, mode }),
  });

  const styles = useMemo(
    () => ({
      body: { backgroundColor: theme.colors.surface1 },
      pad: { padding: 12 },
      diff: { fontSize: 12, lineHeight: 18 },
      muted: { color: theme.colors.foregroundMuted, padding: 16 },
      error: { color: theme.colors.statusDanger, padding: 16 },
    }),
    [theme],
  );

  const patch = query.data?.patch ?? "";
  const allLines = patch.length > 0 ? patch.split("\n") : [];
  const truncated = allLines.length > MAX_LINES;
  const lines = truncated ? allLines.slice(0, MAX_LINES) : allLines;

  return (
    <Modal title={path} open onOpenChange={(open) => (open ? undefined : onClose())}>
      <Modal.Content
        scrollable={false}
        style={styles.body}
        contentContainerStyle={{ padding: 0, gap: 0 }}
      >
        {query.isLoading ? (
          <View style={styles.pad}>
            <ActivityIndicator color={theme.colors.accent} />
          </View>
        ) : query.error ? (
          <Text style={styles.error}>
            {query.error instanceof Error ? query.error.message : "Failed to load diff"}
          </Text>
        ) : allLines.length === 0 ? (
          <Text style={styles.muted}>No changes.</Text>
        ) : (
          <ScrollView horizontal>
            <ScrollView contentContainerStyle={styles.pad}>
              <Text selectable style={styles.diff}>
                {lines.map((line, index) => (
                  <Text key={index} style={{ color: lineColor(line, theme) }}>
                    {line}
                    {index < lines.length - 1 ? "\n" : ""}
                  </Text>
                ))}
              </Text>
              {truncated ? (
                <Text style={styles.muted}>Diff truncated at {MAX_LINES} lines.</Text>
              ) : null}
            </ScrollView>
          </ScrollView>
        )}
      </Modal.Content>
    </Modal>
  );
}
