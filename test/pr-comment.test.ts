import { describe, expect, it } from "vitest";
import { formatPullRequestComment } from "../src/pr-comment.js";
import type { RegistryReport } from "../src/report.js";

function reportWithIssues(issues: RegistryReport["issues"]): RegistryReport {
  return {
    summary: {
      skills: 0,
      mcpServers: 0,
      plugins: 0,
      workflows: 0,
      errors: issues.filter((issue) => issue.severity === "error").length,
      warnings: issues.filter((issue) => issue.severity === "warning").length,
    },
    skills: [],
    mcpServers: [],
    plugins: [],
    workflows: [],
    issues,
    nextActions: [],
  };
}

describe("pull request comment formatting", () => {
  it("escapes markdown and mentions in finding rows", () => {
    const comment = formatPullRequestComment(
      reportWithIssues([
        {
          severity: "error",
          code: "SCHEMA_VALIDATION_FAILED",
          path: "skills.bad",
          message: "cc @maintainer [docs](https://evil.example)",
        },
      ]),
    );

    expect(comment).not.toContain("@maintainer");
    expect(comment).toContain("&#64;maintainer");
    expect(comment).not.toContain("[docs](https://evil.example)");
  });

  it("keeps values with backtick runs inside code spans", () => {
    const comment = formatPullRequestComment(
      reportWithIssues([
        {
          severity: "warning",
          code: "SKILL_DUPLICATE",
          path: "a``@user``b",
          message: "duplicate entry",
        },
      ]),
    );

    // The delimiter must be longer than the longest backtick run in the value,
    // otherwise the middle of the path leaks out of the code span.
    expect(comment).toContain("``` a``@user``b ```");
  });
});
