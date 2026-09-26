import assert from "node:assert/strict";
import test from "node:test";
import { buildFileRows, parseNumstat, parsePorcelainV2 } from "../shared/parse.ts";

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
