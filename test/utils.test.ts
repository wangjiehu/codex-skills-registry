import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { escapeMarkdownText, isMainModule, markdownCodeSpan } from "../src/utils.js";

describe("utils", () => {
  it("treats the process entry script as the main module", () => {
    const entry = realpathSync(fileURLToPath(import.meta.url));

    expect(isMainModule(import.meta.url, entry)).toBe(true);
    expect(isMainModule(import.meta.url, undefined)).toBe(false);
    expect(isMainModule(import.meta.url, "does-not-exist.js")).toBe(false);
  });

  it("escapes markdown control characters, mentions, and newlines", () => {
    expect(escapeMarkdownText("a*b_c@d")).toBe("a\\*b\\_c&#64;d");
    expect(escapeMarkdownText("line1\nline2")).toBe("line1 line2");
  });

  it("sizes code span delimiters past the longest backtick run", () => {
    expect(markdownCodeSpan("plain")).toBe("`plain`");
    expect(markdownCodeSpan("with`tick")).toBe("`` with`tick ``");
    expect(markdownCodeSpan("with``double")).toBe("``` with``double ```");
    expect(markdownCodeSpan("multi\nline")).toBe("`multi line`");
  });
});
