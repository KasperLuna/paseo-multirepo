import assert from "node:assert/strict";
import test from "node:test";
import {
  buildFileRows,
  buildSplitRows,
  intraLineSpans,
  parseNumstat,
  parsePatch,
  parsePorcelainV2,
} from "../shared/parse.ts";

test("parsePorcelainV2 reads branch, ahead/behind, and change kinds", () => {
  const out =
    "# branch.oid abc\0" +
    "# branch.head main\0" +
    "# branch.ab +2 -1\0" +
    "1 .M N... 100644 100644 100644 aaa bbb src/app.ts\0" +
    "2 R. N... 100644 100644 100644 aaa bbb R100 new.ts\0old.ts\0" +
    "? notes.txt\0";

  const parsed = parsePorcelainV2(out);
  assert.equal(parsed.branch, "main");
  assert.equal(parsed.ahead, 2);
  assert.equal(parsed.behind, 1);
  assert.equal(parsed.files.length, 3);
  assert.equal(parsed.files[0].path, "src/app.ts");
  assert.equal(parsed.files[0].status, "modified");
  assert.equal(parsed.files[0].staged, false);
  assert.equal(parsed.files[1].status, "renamed");
  assert.equal(parsed.files[1].origPath, "old.ts");
  assert.equal(parsed.files[1].path, "new.ts");
  assert.equal(parsed.files[2].status, "untracked");
});

test("parseNumstat reads counts and rename pairs", () => {
  const out = "5\t2\tsrc/app.ts\0" + "0\t0\t\0old.ts\0new.ts\0" + "-\t-\tassets/logo.png\0";
  const map = parseNumstat(out);
  assert.deepEqual(map.get("src/app.ts"), { additions: 5, deletions: 2 });
  assert.deepEqual(map.get("new.ts"), { additions: 0, deletions: 0 });
  assert.deepEqual(map.get("assets/logo.png"), { additions: 0, deletions: 0 });
});

test("parsePatch tracks old/new line numbers across hunks", () => {
  const patch = [
    "diff --git a/src/app.ts b/src/app.ts",
    "index aaa..bbb 100644",
    "--- a/src/app.ts",
    "+++ b/src/app.ts",
    "@@ -1,3 +1,4 @@",
    " const a = 1;",
    "-const b = 2;",
    "+const b = 20;",
    "+const c = 3;",
    " export {};",
    "@@ -10,1 +11,1 @@",
    "-old",
    "+new",
  ].join("\n");

  const files = parsePatch(patch);
  assert.equal(files.length, 1);
  assert.equal(files[0].newPath, "src/app.ts");
  assert.equal(files[0].hunks.length, 2);

  const first = files[0].hunks[0];
  assert.equal(first.oldStart, 1);
  assert.equal(first.newStart, 1);
  assert.deepEqual(
    first.lines.map((line) => `${line.kind}:${line.oldNo}:${line.newNo}`),
    ["ctx:1:1", "del:2:null", "add:null:2", "add:null:3", "ctx:3:4"],
  );

  const second = files[0].hunks[1];
  assert.equal(second.lines[0].oldNo, 10);
  assert.equal(second.lines[1].newNo, 11);
});

test("parsePatch handles multiple files and binary notices", () => {
  const patch = [
    "diff --git a/a.txt b/a.txt",
    "--- a/a.txt",
    "+++ b/a.txt",
    "@@ -1 +1 @@",
    "-x",
    "+y",
    "diff --git a/logo.png b/logo.png",
    "Binary files a/logo.png and b/logo.png differ",
  ].join("\n");

  const files = parsePatch(patch);
  assert.equal(files.length, 2);
  assert.equal(files[0].binary, false);
  assert.equal(files[1].binary, true);
  assert.equal(files[1].hunks.length, 0);
});

test("parsePatch survives truncation mid-hunk", () => {
  const patch = [
    "diff --git a/a.txt b/a.txt",
    "@@ -1,2 +1,2 @@",
    " keep",
    "-gone",
  ].join("\n");
  const files = parsePatch(patch);
  assert.equal(files[0].hunks[0].lines.length, 2);
  assert.equal(files[0].hunks[0].lines[1].kind, "del");
});

test("buildSplitRows pairs deletions with additions and pads short sides", () => {
  const files = parsePatch(
    ["diff --git a/a b/a", "@@ -1,2 +1,3 @@", " keep", "-one", "+first", "+second"].join("\n"),
  );
  const rows = buildSplitRows(files[0].hunks[0], false);
  assert.equal(rows.length, 3);
  assert.equal(rows[0].left?.kind, "ctx");
  assert.equal(rows[0].right?.kind, "ctx");
  assert.equal(rows[1].left?.text, "one");
  assert.equal(rows[1].right?.text, "first");
  assert.equal(rows[2].left, null);
  assert.equal(rows[2].right?.text, "second");
});

test("intraLineSpans marks the changed middle of a paired line", () => {
  const spans = intraLineSpans("const total = price;", "const total = cost;");
  assert.deepEqual(spans.leftSpan, { start: 14, end: 19 });
  assert.deepEqual(spans.rightSpan, { start: 14, end: 18 });
  assert.equal(intraLineSpans("same", "same").leftSpan, null);
  assert.equal(intraLineSpans(null, "added").rightSpan, null);
});

test("buildFileRows nests directories and respects collapse", () => {
  const files = [
    { path: "src/app.ts", status: "modified" as const, additions: 3, deletions: 1, staged: false },
    { path: "src/lib/util.ts", status: "added" as const, additions: 4, deletions: 0, staged: false },
    { path: "README.md", status: "modified" as const, additions: 1, deletions: 1, staged: false },
  ];

  const expanded = buildFileRows(files, new Set(), "/repo");
  assert.deepEqual(
    expanded.map((row) => `${row.kind}:${row.path}:${row.depth}`),
    ["dir:src:0", "dir:src/lib:1", "file:src/lib/util.ts:2", "file:src/app.ts:1", "file:README.md:0"],
  );
  const src = expanded.find((row) => row.path === "src");
  assert.equal(src?.additions, 7);

  const collapsed = buildFileRows(files, new Set(["/repo:src"]), "/repo");
  assert.deepEqual(
    collapsed.map((row) => row.path),
    ["src", "README.md"],
  );
});
