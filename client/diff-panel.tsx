import type { PluginWorkspacePanelProps } from "@getpaseo/plugin/client";
import { useRpc, useWorkspace } from "@getpaseo/plugin/client";
import { Icon, ScrollView } from "@getpaseo/plugin/client/react-native";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useSyncExternalStore } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import {
  buildSplitRows,
  intraLineSpans,
  parsePatch,
  type DiffFile,
  type DiffHunk,
  type DiffLine,
  type Span,
  type SplitRow,
} from "../shared/parse";
import { reposDiff } from "../shared/repos";
import {
  getPrefs,
  getSelection,
  getTraversal,
  stepDiff,
  subscribeSelection,
  updatePrefs,
  type DiffLayout,
} from "./store";

type Theme = PluginWorkspacePanelProps["theme"];
type Styles = ReturnType<typeof useStyles>;

const MAX_LINES = 8_000;
const GUTTER_WIDTH = 40;

function lineTint(kind: DiffLine["kind"], theme: Theme): string {
  if (kind === "add") return withAlpha(theme.colors.statusSuccess, 0.14);
  if (kind === "del") return withAlpha(theme.colors.statusDanger, 0.14);
  return "transparent";
}

function codeColor(kind: DiffLine["kind"], theme: Theme): string {
  if (kind === "add") return theme.colors.statusSuccess;
  if (kind === "del") return theme.colors.statusDanger;
  return theme.colors.foreground;
}

function withAlpha(color: string, alpha: number): string {
  const hex = /^#([0-9a-f]{6})$/i.exec(color);
  if (hex) {
    const value = parseInt(hex[1], 16);
    const r = (value >> 16) & 255;
    const g = (value >> 8) & 255;
    const b = value & 255;
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }
  const rgb = /^rgba?\(([^)]+)\)$/i.exec(color);
  if (rgb) {
    const [r, g, b] = rgb[1].split(",").map((part) => part.trim());
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }
  return color;
}

function truncateRows(rows: SplitRow[]): { rows: SplitRow[]; truncated: boolean } {
  if (rows.length <= MAX_LINES) return { rows, truncated: false };
  return { rows: rows.slice(0, MAX_LINES), truncated: true };
}

/** Rows for a hunk, optionally filtered down to changes with surrounding context. */
interface DisplayHunk {
  header: string;
  rows: SplitRow[];
  /** Original hunk, kept so "expand context" can re-request with a larger -U. */
  hunk: DiffHunk;
}

function toDisplayHunks(file: DiffFile, wordDiff: boolean): DisplayHunk[] {
  return file.hunks.map((hunk) => ({
    header: hunk.header,
    rows: buildSplitRows(hunk, wordDiff),
    hunk,
  }));
}

export function RepoDiffPanel({ theme, layout, workspaceId }: PluginWorkspacePanelProps) {
  const workspace = useWorkspace(workspaceId, (snapshot) => ({ cwd: snapshot.directory }));
  const selection = useSyncExternalStore(subscribeSelection, () => getSelection(workspaceId));
  const prefs = useSyncExternalStore(subscribeSelection, () => getPrefs(workspaceId));
  const diffRpc = useRpc(reposDiff);

  const cwd = workspace?.cwd ?? null;
  const query = useQuery({
    queryKey: [
      "multirepo-diff",
      workspaceId,
      selection?.root,
      selection?.path,
      selection?.mode,
      prefs.ignoreWhitespace,
      prefs.context,
    ],
    enabled: Boolean(cwd && selection),
    queryFn: () =>
      diffRpc({
        cwd: cwd as string,
        root: selection?.root as string,
        path: selection?.path as string,
        mode: selection?.mode ?? "working",
        context: prefs.context,
        ignoreWhitespace: prefs.ignoreWhitespace,
      }),
  });

  const styles = useStyles(theme, layout.compact);

  const patch = query.data?.patch ?? "";
  const files = useMemo(() => parsePatch(patch), [patch]);
  const file = files[0] ?? null;
  const hunks = useMemo(() => (file ? toDisplayHunks(file, prefs.wordDiff) : []), [file, prefs.wordDiff]);
  const totalRows = hunks.reduce((sum, hunk) => sum + hunk.rows.length, 0);
  const truncated = query.data?.truncated || totalRows > MAX_LINES;

  const onToggleLayout = () =>
    updatePrefs(workspaceId, { layout: prefs.layout === "split" ? "unified" : "split" });

  if (!selection) {
    return (
      <View style={styles.screen}>
        <Text style={styles.muted}>Select a file in the Repos panel to view its diff.</Text>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <Toolbar
        theme={theme}
        styles={styles}
        compact={layout.compact}
        path={selection.path}
        repoName={selection.repoName}
        mode={selection.mode}
        prefs={prefs}
        canPrev={canStep(workspaceId, -1)}
        canNext={canStep(workspaceId, 1)}
        onToggleLayout={onToggleLayout}
        onPrev={() => stepDiff(workspaceId, -1)}
        onNext={() => stepDiff(workspaceId, 1)}
        onToggleWordDiff={() => updatePrefs(workspaceId, { wordDiff: !prefs.wordDiff })}
        onToggleWhitespace={() =>
          updatePrefs(workspaceId, { ignoreWhitespace: !prefs.ignoreWhitespace })
        }
        onToggleWrap={() => updatePrefs(workspaceId, { wrap: !prefs.wrap })}
        onExpandContext={() =>
          updatePrefs(workspaceId, { context: Math.min(50, prefs.context + 10) })
        }
      />

      {query.isLoading ? (
        <View style={styles.pad}>
          <ActivityIndicator color={theme.colors.accent} />
        </View>
      ) : query.error ? (
        <Text style={styles.error}>
          {query.error instanceof Error ? query.error.message : "Failed to load diff"}
        </Text>
      ) : hunks.length === 0 ? (
        <Text style={styles.muted}>
          {file?.binary ? "Binary file — no textual diff." : "No changes in this file."}
        </Text>
      ) : (
        <ScrollView contentContainerStyle={styles.scrollBody}>
          <View style={styles.grid}>
            {hunks.map((hunk) => (
              <HunkBlock
                key={hunk.header}
                hunk={hunk}
                layout={prefs.layout}
                wrap={prefs.wrap}
                theme={theme}
                styles={styles}
              />
            ))}
          </View>
          {truncated ? (
            <Text style={styles.muted}>Diff truncated at {MAX_LINES} rows.</Text>
          ) : null}
        </ScrollView>
      )}
    </View>
  );
}

function canStep(workspaceId: string, delta: number): boolean {
  const selection = getSelection(workspaceId);
  const files = getTraversal(workspaceId)?.files ?? null;
  if (!selection || !files) return false;
  const index = files.findIndex(
    (file) => file.root === selection.root && file.path === selection.path,
  );
  if (index < 0) return false;
  const next = index + delta;
  return next >= 0 && next < files.length;
}

interface ToolbarProps {
  theme: Theme;
  styles: Styles;
  compact: boolean;
  path: string;
  repoName: string;
  mode: "working" | "staged";
  prefs: ReturnType<typeof getPrefs>;
  canPrev: boolean;
  canNext: boolean;
  onToggleLayout: () => void;
  onPrev: () => void;
  onNext: () => void;
  onToggleWordDiff: () => void;
  onToggleWhitespace: () => void;
  onToggleWrap: () => void;
  onExpandContext: () => void;
}

function Toolbar({
  theme,
  styles,
  compact,
  path,
  repoName,
  mode,
  prefs,
  canPrev,
  canNext,
  onToggleLayout,
  onPrev,
  onNext,
  onToggleWordDiff,
  onToggleWhitespace,
  onToggleWrap,
  onExpandContext,
}: ToolbarProps) {
  return (
    <View style={styles.toolbar}>
      <View style={styles.header}>
        <Text style={styles.path} numberOfLines={1}>
          {path}
        </Text>
        <Text style={styles.repo} numberOfLines={1}>
          {repoName}
          {mode === "staged" ? " · staged" : ""}
        </Text>
      </View>
      <View style={styles.actions}>
        <ToolbarButton
          icon="ChevronLeft"
          label="Previous changed file"
          disabled={!canPrev}
          theme={theme}
          styles={styles}
          onPress={onPrev}
        />
        <ToolbarButton
          icon="ChevronRight"
          label="Next changed file"
          disabled={!canNext}
          theme={theme}
          styles={styles}
          onPress={onNext}
        />
        <ToolbarButton
          icon={prefs.layout === "split" ? "Columns2" : "AlignJustify"}
          label={prefs.layout === "split" ? "Switch to unified view" : "Switch to split view"}
          active
          theme={theme}
          styles={styles}
          onPress={onToggleLayout}
        />
        {!compact ? (
          <>
            <ToolbarButton
              icon="CaseSensitive"
              label="Toggle word-level highlighting"
              active={prefs.wordDiff}
              theme={theme}
              styles={styles}
              onPress={onToggleWordDiff}
            />
            <ToolbarButton
              icon="WrapText"
              label="Toggle line wrapping"
              active={prefs.wrap}
              theme={theme}
              styles={styles}
              onPress={onToggleWrap}
            />
          </>
        ) : null}
        <ToolbarButton
          icon="Pilcrow"
          label="Ignore whitespace-only changes"
          active={prefs.ignoreWhitespace}
          theme={theme}
          styles={styles}
          onPress={onToggleWhitespace}
        />
        <ToolbarButton
          icon="Expand"
          label="Show more context lines"
          theme={theme}
          styles={styles}
          onPress={onExpandContext}
        />
      </View>
    </View>
  );
}

function ToolbarButton({
  icon,
  label,
  active,
  disabled,
  theme,
  styles,
  onPress,
}: {
  icon: string;
  label: string;
  active?: boolean;
  disabled?: boolean;
  theme: Theme;
  styles: Styles;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: Boolean(active), disabled: Boolean(disabled) }}
      disabled={disabled}
      onPress={onPress}
    >
      <View style={[styles.toolbarButton, active ? styles.toolbarButtonActive : null]}>
        <Icon
          name={icon}
          size={15}
          color={disabled ? theme.colors.foregroundMuted : active ? theme.colors.accent : theme.colors.foreground}
        />
      </View>
    </Pressable>
  );
}

function HunkBlock({
  hunk,
  layout,
  wrap,
  theme,
  styles,
}: {
  hunk: DisplayHunk;
  layout: DiffLayout;
  wrap: boolean;
  theme: Theme;
  styles: Styles;
}) {
  const { rows, truncated } = truncateRows(hunk.rows);
  return (
    <View>
      <Text style={styles.hunkHeader} selectable>
        {hunk.header}
      </Text>
      {truncated ? (
        <Text style={styles.muted}>Hunk truncated at {MAX_LINES} rows.</Text>
      ) : null}
      {rows.map((row, index) =>
        layout === "split" ? (
          <SplitRowView
            key={index}
            row={row}
            theme={theme}
            styles={styles}
            wrap={wrap}
          />
        ) : (
          <UnifiedRows
            key={index}
            row={row}
            theme={theme}
            styles={styles}
            wrap={wrap}
          />
        ),
      )}
    </View>
  );
}

function SplitRowView({
  row,
  theme,
  styles,
  wrap,
}: {
  row: SplitRow;
  theme: Theme;
  styles: Styles;
  wrap: boolean;
}) {
  const spans =
    row.left && row.right
      ? row.leftSpan || row.rightSpan
        ? { leftSpan: row.leftSpan, rightSpan: row.rightSpan }
        : intraLineSpans(row.left.text, row.right.text)
      : { leftSpan: null, rightSpan: null };

  return (
    <View style={styles.splitRow}>
      <Side
        line={row.left}
        side="left"
        span={spans.leftSpan}
        theme={theme}
        styles={styles}
        wrap={wrap}
      />
      <View style={styles.divider} />
      <Side
        line={row.right}
        side="right"
        span={spans.rightSpan}
        theme={theme}
        styles={styles}
        wrap={wrap}
      />
    </View>
  );
}

function Side({
  line,
  side,
  span,
  theme,
  styles,
  wrap,
}: {
  line: DiffLine | null;
  side: "left" | "right";
  span: Span | null;
  theme: Theme;
  styles: Styles;
  wrap: boolean;
}) {
  const kind = line?.kind ?? "ctx";
  const number = line ? (side === "left" ? line.oldNo : line.newNo) : null;
  const marker = line ? (kind === "add" ? "+" : kind === "del" ? "-" : " ") : " ";
  const tint = line ? lineTint(kind, theme) : "transparent";

  return (
    <View style={[styles.side, { backgroundColor: tint }]}>
      <Text style={styles.gutter} selectable={false}>
        {number === null ? "" : String(number)}
      </Text>
      <Text style={[styles.marker, { color: codeColor(kind, theme) }]} selectable={false}>
        {marker}
      </Text>
      {line === null ? (
        <View style={styles.codeEmpty} />
      ) : (
        <Text
          selectable
          numberOfLines={wrap ? undefined : 1}
          style={[styles.code, { color: theme.colors.foreground }]}
        >
          {span && span.end > span.start ? (
            <>
              <Text>{line.text.slice(0, span.start)}</Text>
              <Text style={[styles.highlight, { color: codeColor(kind, theme) }]}>
                {line.text.slice(span.start, span.end)}
              </Text>
              <Text>{line.text.slice(span.end)}</Text>
            </>
          ) : (
            line.text
          )}
        </Text>
      )}
    </View>
  );
}

/** Unified mode renders one row per diff line, in git order, with both numbers. */
function UnifiedRows({
  row,
  theme,
  styles,
  wrap,
}: {
  row: SplitRow;
  theme: Theme;
  styles: Styles;
  wrap: boolean;
}) {
  const entries: DiffLine[] = [];
  if (row.left && row.left.kind === "ctx") entries.push(row.left);
  else {
    if (row.left) entries.push(row.left);
    if (row.right) entries.push(row.right);
  }
  return (
    <>
      {entries.map((line, index) => {
        const span = index === 0 && row.left ? row.leftSpan : index === 1 ? row.rightSpan : null;
        return (
          <UnifiedLine
            key={index}
            line={line}
            span={span}
            theme={theme}
            styles={styles}
            wrap={wrap}
          />
        );
      })}
    </>
  );
}

function UnifiedLine({
  line,
  span,
  theme,
  styles,
  wrap,
}: {
  line: DiffLine;
  span: Span | null;
  theme: Theme;
  styles: Styles;
  wrap: boolean;
}) {
  const marker = line.kind === "add" ? "+" : line.kind === "del" ? "-" : " ";
  return (
    <View style={[styles.unifiedRow, { backgroundColor: lineTint(line.kind, theme) }]}>
      <Text style={styles.gutter} selectable={false}>
        {line.oldNo ?? ""}
      </Text>
      <Text style={styles.gutter} selectable={false}>
        {line.newNo ?? ""}
      </Text>
      <Text style={[styles.marker, { color: codeColor(line.kind, theme) }]} selectable={false}>
        {marker}
      </Text>
      <Text
        selectable
        numberOfLines={wrap ? undefined : 1}
        style={[styles.code, { color: theme.colors.foreground }]}
      >
        {span && span.end > span.start ? (
          <>
            <Text>{line.text.slice(0, span.start)}</Text>
            <Text style={[styles.highlight, { color: codeColor(line.kind, theme) }]}>
              {line.text.slice(span.start, span.end)}
            </Text>
            <Text>{line.text.slice(span.end)}</Text>
          </>
        ) : (
          line.text
        )}
      </Text>
    </View>
  );
}

function useStyles(theme: Theme, compact: boolean) {
  return useMemo(() => {
    const pad = compact ? 10 : 14;
    const mono = {
      fontFamily: "monospace" as const,
      fontSize: 12,
      lineHeight: 18,
    };
    return {
      screen: { flex: 1, backgroundColor: theme.colors.surface0 },
      toolbar: {
        borderBottomWidth: 1,
        borderBottomColor: theme.colors.border,
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: 8,
        paddingHorizontal: pad,
        paddingVertical: 8,
      },
      header: { flex: 1, gap: 2, overflow: "hidden" as const },
      path: { color: theme.colors.foreground, fontSize: 13, fontWeight: "600" as const },
      repo: { color: theme.colors.foregroundMuted, fontSize: 12 },
      actions: { flexDirection: "row" as const, alignItems: "center" as const, gap: 2 },
      toolbarButton: {
        paddingHorizontal: 6,
        paddingVertical: 4,
        borderRadius: 6,
      },
      toolbarButtonActive: { backgroundColor: theme.colors.surface2 },
      scrollBody: { paddingBottom: 32 },
      grid: { minWidth: "100%" as const },
      hunkHeader: {
        ...mono,
        color: theme.colors.accent,
        backgroundColor: theme.colors.surface1,
        paddingHorizontal: pad,
        paddingVertical: 3,
      },
      splitRow: { flexDirection: "row" as const, alignItems: "stretch" as const },
      divider: { width: 1, backgroundColor: theme.colors.border },
      side: {
        flex: 1,
        flexDirection: "row" as const,
        alignItems: "flex-start" as const,
      },
      unifiedRow: {
        flexDirection: "row" as const,
        alignItems: "flex-start" as const,
      },
      gutter: {
        ...mono,
        width: GUTTER_WIDTH,
        textAlign: "right" as const,
        paddingRight: 6,
        color: theme.colors.foregroundMuted,
      },
      marker: { ...mono, width: 14, textAlign: "center" as const },
      code: { ...mono, flex: 1, color: theme.colors.foreground, paddingRight: 8 },
      codeEmpty: { flex: 1 },
      highlight: { fontWeight: "700" as const },
      pad: { padding: 16 },
      muted: { color: theme.colors.foregroundMuted, padding: 16, fontSize: 13 },
      error: { color: theme.colors.statusDanger, padding: 16, fontSize: 13 },
    };
  }, [theme, compact]);
}
