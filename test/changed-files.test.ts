import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadChangedFiles } from "../src/changed-files.js";

describe("changed files", () => {
  it("decodes git C-quoted paths and skips comments and blank lines", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "codex-changed-files-"));

    try {
      await writeFile(
        path.join(root, "changed.txt"),
        [
          "# comment line",
          "",
          "src/plain.ts",
          '"docs/\\303\\244.md"',
          '"docs/with \\"quotes\\".md"',
          "./relative/skill.md",
        ].join("\n"),
        "utf8",
      );

      const changed = await loadChangedFiles({
        cwd: root,
        changedFilesFile: "changed.txt",
      });

      expect(changed).toEqual(
        new Set(["src/plain.ts", "docs/ä.md", 'docs/with "quotes".md', "relative/skill.md"]),
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
