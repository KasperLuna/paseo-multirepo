import type { PluginWorkspacePanelProps } from "@getpaseo/plugin/client";
import { useRpc, useWorkspace } from "@getpaseo/plugin/client";
import { Icon, ScrollView, TextInput } from "@getpaseo/plugin/client/react-native";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState, useSyncExternalStore } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { buildFileRows, type FileRow } from "../shared/parse";
import { reposSnapshot, type RepoFile, type RepoInfo } from "../shared/repos";
import { getSelection, openDiffTab, subscribeSelection } from "./store";

const REFRESH_MS = 2_500;

const CODE_EXT = new Set([
  "ts", "tsx", "js", "jsx", "mjs", "cjs", "py", "rb", "go", "rs", "java", "kt",
  "swift", "c", "h", "cpp", "hpp", "cs", "php", "sh", "bash", "zsh", "sql",
  "css", "scss", "html", "vue", "svelte",
]);
const DOC_EXT = new Set(["md", "mdx", "txt", "rst"]);
const DATA_EXT = new Set(["json", "yaml", "yml", "toml", "ini"]);

function fileIcon(name: string): string {
  const lower = name.toLowerCase();
  if (lower.startsWith("dockerfile") || lower === "makefile" || lower === ".gitignore") {
    return "FileCog";
  }
  if (lower.endsWith(".lock")) return "Lock";
  const ext = lower.includes(".") ? (lower.split(".").pop() as string) : "";
  if (DATA_EXT.has(ext)) return "FileJson";
  if (DOC_EXT.has(ext)) return "FileText";
  if (CODE_EXT.has(ext)) return "FileCode";
  return "File";
}

function formatStat(value: number): string {
  return value >= 1_000 ? `${(value / 1_000).toFixed(1)}k` : String(value);
}

function sumStats(files: RepoFile[]): { additions: number; deletions: number } {
  return files.reduce(
    (acc, file) => ({
      additions: acc.additions + file.additions,
      deletions: acc.deletions + file.deletions,
    }),
    { additions: 0, deletions: 0 },
  );
}

type Theme = PluginWorkspacePanelProps["theme"];

function useStyles(theme: Theme, compact: boolean) {
  return useMemo(() => {
    const pad = compact ? 10 : 12;
    return {
      screen: { flex: 1, backgroundColor: theme.colors.surface0 },
      header: { paddingHorizontal: pad, paddingTop: pad, gap: 8, paddingBottom: 6 },
      titleRow: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        justifyContent: "space-between" as const,
      },
      title: { color: theme.colors.foreground, fontSize: 14, fontWeight: "600" as const },
      label: { color: theme.colors.foregroundMuted, fontSize: 12 },
      search: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: 6,
        backgroundColor: theme.colors.surface2,
        borderRadius: 8,
        paddingHorizontal: 8,
        paddingVertical: compact ? 5 : 6,
      },
      searchInput: { flex: 1, color: theme.colors.foreground, fontSize: 13, padding: 0 },
      scroll: { paddingBottom: 32 },
      repoHeader: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: 6,
        paddingHorizontal: pad,
        paddingVertical: compact ? 7 : 9,
        marginTop: 4,
        backgroundColor: theme.colors.surface1,
      },
      repoName: { color: theme.colors.foreground, fontSize: 13, fontWeight: "600" as const },
      branch: { color: theme.colors.foregroundMuted, fontSize: 12, flexShrink: 1 },
      branchWrap: {
        flex: 1,
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: 6,
        overflow: "hidden" as const,
      },
      stats: { flexDirection: "row" as const, alignItems: "center" as const, gap: 6 },
      row: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: 6,
        paddingRight: pad,
        paddingVertical: 4,
      },
      rowMain: { flex: 1, flexDirection: "row" as const, alignItems: "center" as const, gap: 6 },
      name: { color: theme.colors.foreground, fontSize: 13, flexShrink: 1 },
      dirName: { color: theme.colors.foreground, fontSize: 13 },
      add: { color: theme.colors.statusSuccess, fontSize: 12 },
      del: { color: theme.colors.statusDanger, fontSize: 12 },
      muted: { color: theme.colors.foregroundMuted, padding: pad, fontSize: 13 },
      error: {
        color: theme.colors.statusDanger,
        paddingHorizontal: pad,
        paddingVertical: 3,
        fontSize: 12,
      },
    };
  }, [theme, compact]);
}

type Styles = ReturnType<typeof useStyles>;

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
  const [filter, setFilter] = useState("");
  const selection = useSyncExternalStore(subscribeSelection, () => getSelection(workspaceId));
  const styles = useStyles(theme, layout.compact);

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
  const needle = filter.trim().toLowerCase();
  const total = sumStats(repos.flatMap((repo) => repo.files));

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <View style={styles.titleRow}>
          <Text style={styles.title}>
            {repos.length === 1 ? repos[0].name : `${repos.length} repositories`}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Refresh repository changes"
            onPress={() => void query.refetch()}
          >
            <Icon name="RefreshCw" size={15} color={theme.colors.foregroundMuted} />
          </Pressable>
        </View>

        <View style={styles.search}>
          <Icon name="Search" size={14} color={theme.colors.foregroundMuted} />
          <TextInput
            value={filter}
            onChangeText={setFilter}
            placeholder="Filter files"
            placeholderTextColor={theme.colors.foregroundMuted}
            autoCapitalize="none"
            autoCorrect={false}
            style={styles.searchInput}
          />
          {filter.length > 0 ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Clear filter"
              onPress={() => setFilter("")}
            >
              <Icon name="X" size={14} color={theme.colors.foregroundMuted} />
            </Pressable>
          ) : null}
        </View>

        <View style={styles.titleRow}>
          <Text style={styles.label}>Total changes</Text>
          <View style={styles.stats}>
            <Text style={styles.add}>+{formatStat(total.additions)}</Text>
            <Text style={styles.del}>-{formatStat(total.deletions)}</Text>
          </View>
        </View>
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
        {repos.map((repo) => (
          <RepoSection
            key={repo.root}
            repo={repo}
            workspaceId={workspaceId}
            collapsed={collapsed}
            needle={needle}
            selection={selection}
            styles={styles}
            theme={theme}
            onToggle={toggle}
          />
        ))}
      </ScrollView>
    </View>
  );
}

interface RepoSectionProps {
  repo: RepoInfo;
  workspaceId: string;
  collapsed: Set<string>;
  needle: string;
  selection: { root: string; path: string } | null;
  styles: Styles;
  theme: Theme;
  onToggle: (key: string) => void;
}

function RepoSection({
  repo,
  workspaceId,
  collapsed,
  needle,
  selection,
  styles,
  theme,
  onToggle,
}: RepoSectionProps) {
  const repoKey = `repo:${repo.root}`;
  const isCollapsed = collapsed.has(repoKey);

  const files = useMemo(
    () =>
      needle.length === 0
        ? repo.files
        : repo.files.filter((file) => file.path.toLowerCase().includes(needle)),
    [repo.files, needle],
  );
  const rows = useMemo(
    () => (isCollapsed ? [] : buildFileRows(files, collapsed, repo.root)),
    [isCollapsed, files, collapsed, repo.root],
  );
  const stats = sumStats(files);

  return (
    <View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${repo.name}, branch ${repo.branch ?? "detached"}, ${
          repo.files.length
        } changed files`}
        onPress={() => onToggle(repoKey)}
      >
        <View style={styles.repoHeader}>
          <Icon
            name={isCollapsed ? "ChevronRight" : "ChevronDown"}
            size={14}
            color={theme.colors.foregroundMuted}
          />
          <View style={styles.branchWrap}>
            <Text style={styles.repoName} numberOfLines={1}>
              {repo.name}
            </Text>
            <Icon name="GitBranch" size={12} color={theme.colors.foregroundMuted} />
            <Text style={styles.branch} numberOfLines={1}>
              {repo.branch ?? "detached"}
            </Text>
            {repo.ahead > 0 ? <Text style={styles.branch}>↑{repo.ahead}</Text> : null}
            {repo.behind > 0 ? <Text style={styles.branch}>↓{repo.behind}</Text> : null}
          </View>
          <View style={styles.stats}>
            <Text style={styles.add}>+{formatStat(stats.additions)}</Text>
            <Text style={styles.del}>-{formatStat(stats.deletions)}</Text>
          </View>
        </View>
      </Pressable>

      {rows.map((row) => (
        <Row
          key={row.key}
          row={row}
          repoRoot={repo.root}
          repoName={repo.name}
          workspaceId={workspaceId}
          collapsed={collapsed.has(row.key)}
          active={selection?.root === repo.root && selection?.path === row.path}
          styles={styles}
          theme={theme}
          onToggle={onToggle}
        />
      ))}

      {!isCollapsed && needle.length > 0 && files.length === 0 ? (
        <Text style={styles.muted}>No files match "{needle}".</Text>
      ) : null}
    </View>
  );
}

interface RowProps {
  row: FileRow;
  repoRoot: string;
  repoName: string;
  workspaceId: string;
  collapsed: boolean;
  active: boolean;
  styles: Styles;
  theme: Theme;
  onToggle: (key: string) => void;
}

function Row({
  row,
  repoRoot,
  repoName,
  workspaceId,
  collapsed,
  active,
  styles,
  theme,
  onToggle,
}: RowProps) {
  const indent = 10 + row.depth * 14;
  const stats = (
    <View style={styles.stats}>
      <Text style={styles.add}>+{formatStat(row.additions)}</Text>
      <Text style={styles.del}>-{formatStat(row.deletions)}</Text>
    </View>
  );

  if (row.kind === "dir") {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Toggle folder ${row.path}`}
        onPress={() => onToggle(row.key)}
      >
        <View style={[styles.row, { paddingLeft: indent }]}>
          <View style={styles.rowMain}>
            <Icon
              name={collapsed ? "ChevronRight" : "ChevronDown"}
              size={14}
              color={theme.colors.foregroundMuted}
            />
            <Icon
              name={collapsed ? "Folder" : "FolderOpen"}
              size={14}
              color={theme.colors.foregroundMuted}
            />
            <Text style={styles.dirName} numberOfLines={1}>
              {row.name}
            </Text>
          </View>
          {stats}
        </View>
      </Pressable>
    );
  }

  const open = () =>
    openDiffTab(workspaceId, { root: repoRoot, repoName, path: row.path, mode: "working" });

  return (
    <View
      style={[
        styles.row,
        {
          paddingLeft: indent,
          backgroundColor: active ? theme.colors.surface1 : "transparent",
        },
      ]}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Open diff for ${row.path}`}
        onPress={open}
      >
        <View style={styles.rowMain}>
          <Icon name={fileIcon(row.name)} size={14} color={theme.colors.foregroundMuted} />
          <Text style={styles.name} numberOfLines={1}>
            {row.name}
          </Text>
        </View>
      </Pressable>
      {stats}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Open ${row.path} diff in a main tab`}
        onPress={open}
      >
        <Icon name="SquareArrowOutUpRight" size={13} color={theme.colors.foregroundMuted} />
      </Pressable>
    </View>
  );
}
