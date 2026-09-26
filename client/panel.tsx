import type { PluginWorkspacePanelProps } from "@getpaseo/plugin/client";
import { useRpc, useWorkspace } from "@getpaseo/plugin/client";
import { ScrollView } from "@getpaseo/plugin/client/react-native";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { buildFileRows } from "../shared/parse";
import { reposSnapshot, type RepoInfo } from "../shared/repos";
import { DiffModal } from "./diff";

const REFRESH_MS = 2_500;

interface Selection {
  root: string;
  path: string;
  mode: "working" | "staged";
}

export function ReposPanel({ theme, layout, workspaceId }: PluginWorkspacePanelProps) {
  const workspace = useWorkspace(workspaceId, (snapshot) => ({
    cwd: snapshot.directory,
    name: snapshot.name,
  }));
  const snapshotRpc = useRpc(reposSnapshot);
  const cwd = workspace?.cwd ?? null;

  const query = useQuery({
    queryKey: ["multirepo", workspaceId, cwd],
    enabled: Boolean(cwd),
    refetchInterval: REFRESH_MS,
    queryFn: () => snapshotRpc({ cwd: cwd as string }),
  });

  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [selected, setSelected] = useState<Selection | null>(null);

  const styles = useMemo(() => {
    const pad = layout.compact ? 12 : 16;
    return {
      screen: { flex: 1, backgroundColor: theme.colors.surface0 },
      header: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        justifyContent: "space-between" as const,
        paddingHorizontal: pad,
        paddingVertical: layout.compact ? 10 : 12,
        borderBottomWidth: 1,
        borderBottomColor: theme.colors.border,
      },
      title: { color: theme.colors.foreground, fontSize: layout.compact ? 15 : 16, fontWeight: "600" as const },
      action: { color: theme.colors.accent, fontSize: 13, paddingVertical: 4, paddingHorizontal: 6 },
      scroll: { paddingBottom: 24 },
      repoHeader: {
        paddingHorizontal: pad,
        paddingVertical: layout.compact ? 8 : 10,
        backgroundColor: theme.colors.surface1,
      },
      repoName: { color: theme.colors.foreground, fontSize: 14, fontWeight: "600" as const },
      meta: { color: theme.colors.foregroundMuted, fontSize: 12, marginTop: 2 },
      row: { paddingVertical: 5 },
      dir: { color: theme.colors.foregroundMuted, fontSize: 13 },
      file: { color: theme.colors.foreground, fontSize: 13 },
      add: { color: theme.colors.statusSuccess, fontSize: 12 },
      del: { color: theme.colors.statusDanger, fontSize: 12 },
      muted: { color: theme.colors.foregroundMuted, padding: pad, fontSize: 13 },
      error: { color: theme.colors.statusDanger, paddingHorizontal: pad, paddingVertical: 4, fontSize: 12 },
    };
  }, [theme, layout.compact]);

  function toggle(key: string) {
    setCollapsed((previous) => {
      const next = new Set(previous);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  if (!cwd) {
    return (
      <View style={styles.screen}>
        <Text style={styles.muted}>Workspace directory unavailable.</Text>
      </View>
    );
  }

  const repos: RepoInfo[] = query.data?.repos ?? [];
  const errors = query.data?.errors ?? [];

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <Text style={styles.title}>
          {repos.length === 1 ? repos[0].name : `${repos.length} repositories`}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Refresh repository changes"
          onPress={() => void query.refetch()}
        >
          <Text style={styles.action}>Refresh</Text>
        </Pressable>
      </View>

      {query.isLoading ? (
        <View style={styles.muted}>
          <ActivityIndicator color={theme.colors.accent} />
        </View>
      ) : null}
      {!query.isLoading && query.error ? (
        <Text style={styles.error}>
          {query.error instanceof Error ? query.error.message : "Failed to load repositories"}
        </Text>
      ) : null}
      {!query.isLoading && repos.length === 0 ? (
        <Text style={styles.muted}>No git repositories found under this workspace.</Text>
      ) : null}
      {errors.map((error) => (
        <Text key={error.root} style={styles.error}>
          {error.root}: {error.message}
        </Text>
      ))}

      <ScrollView contentContainerStyle={styles.scroll}>
        {repos.map((repo) => {
          const repoKey = `repo:${repo.root}`;
          const isCollapsed = collapsed.has(repoKey);
          const rows = isCollapsed ? [] : buildFileRows(repo.files, collapsed, repo.root);
          return (
            <View key={repo.root}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${repo.name}, branch ${repo.branch ?? "detached"}, ${
                  repo.files.length
                } changed files`}
                onPress={() => toggle(repoKey)}
                style={styles.repoHeader}
              >
                <Text style={styles.repoName}>
                  {isCollapsed ? "▸" : "▾"} {repo.name}
                </Text>
                <Text style={styles.meta}>
                  {repo.branch ?? "detached"}
                  {repo.ahead > 0 ? ` ↑${repo.ahead}` : ""}
                  {repo.behind > 0 ? ` ↓${repo.behind}` : ""}
                  {repo.dirty ? ` · ${repo.files.length} changed` : " · clean"}
                </Text>
              </Pressable>

              {rows.map((row) => {
                const indent = 12 + row.depth * 14;
                if (row.kind === "dir") {
                  return (
                    <Pressable
                      key={row.key}
                      accessibilityRole="button"
                      accessibilityLabel={`Toggle folder ${row.path}`}
                      onPress={() => toggle(row.key)}
                      style={[styles.row, { paddingLeft: indent, paddingRight: 16 }]}
                    >
                      <Text style={styles.dir}>
                        {collapsed.has(row.key) ? "▸" : "▾"} {row.name}
                        {row.additions > 0 ? ` +${row.additions}` : ""}
                        {row.deletions > 0 ? ` -${row.deletions}` : ""}
                      </Text>
                    </Pressable>
                  );
                }
                return (
                  <Pressable
                    key={row.key}
                    accessibilityRole="button"
                    accessibilityLabel={`View diff for ${row.path}`}
                    onPress={() => setSelected({ root: repo.root, path: row.path, mode: "working" })}
                    style={[styles.row, { paddingLeft: indent, paddingRight: 16 }]}
                  >
                    <Text style={styles.file} numberOfLines={1}>
                      {row.name}{" "}
                      <Text style={styles.meta}>{row.status ?? ""}</Text>{" "}
                      <Text style={styles.add}>+{row.additions}</Text>{" "}
                      <Text style={styles.del}>-{row.deletions}</Text>
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          );
        })}
      </ScrollView>

      {selected ? (
        <DiffModal
          cwd={cwd}
          root={selected.root}
          path={selected.path}
          mode={selected.mode}
          theme={theme}
          onClose={() => setSelected(null)}
        />
      ) : null}
    </View>
  );
}
