import { describe, expect, it } from "vitest";
import { diffFiles, diffStats } from "./files";

const PATCH = `diff --git a/a.txt b/a.txt
index 814f4a4..b2a3b1e 100644
--- a/a.txt
+++ b/a.txt
@@ -1,2 +1,3 @@
 one
-two
+TWO
+three
\\ No newline at end of file
diff --git a/old.txt b/new.txt
similarity index 100%
rename from old.txt
rename to new.txt
diff --git a/img.png b/img.png
new file mode 100644
index 0000000..e69de29
Binary files /dev/null and b/img.png differ
diff --git a/gone.txt b/gone.txt
deleted file mode 100644
index 1..0
--- a/gone.txt
+++ /dev/null
@@ -1 +0,0 @@
-bye
diff --git a/new.txt b/new.txt
new file mode 100644
index 0000000..ce01362
--- /dev/null
+++ b/new.txt
@@ -0,0 +1 @@
+hello
`;

describe("diffFiles", () => {
  const files = diffFiles(PATCH);

  it("reads every file with its status", () => {
    expect(files.map((f) => [f.path, f.status, f.binary])).toEqual([
      ["a.txt", "modified", false],
      ["new.txt", "renamed", false],
      ["img.png", "added", true],
      ["gone.txt", "deleted", false],
      ["new.txt", "added", false],
    ]);
    expect(files[1]!.oldPath).toBe("old.txt");
  });

  it("counts added and removed lines and keeps hunks", () => {
    expect(files[0]).toMatchObject({ additions: 2, deletions: 1 });
    expect(files[0]!.hunks[0]!.header).toBe("@@ -1,2 +1,3 @@");
    expect(files[0]!.hunks[0]!.lines).toEqual([
      { kind: "ctx", text: "one" },
      { kind: "del", text: "two" },
      { kind: "add", text: "TWO" },
      { kind: "add", text: "three" },
      { kind: "meta", text: "\\ No newline at end of file" },
    ]);
    expect(diffStats(files)).toEqual({ files: 5, additions: 3, deletions: 2 });
  });

  it("is empty for an empty patch", () => expect(diffFiles("")).toEqual([]));
});
