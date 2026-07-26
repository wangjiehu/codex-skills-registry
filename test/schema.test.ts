import { describe, expect, it } from "vitest";
import { CodexSkillSchema, McpServerConfigSchema, normalizeSkillInput } from "../src/schema.js";

describe("schema", () => {
  it("normalizes legacy skillName and triggerType fields", () => {
    const skill = normalizeSkillInput({
      skillName: "issue-triage",
      version: "0.1.0",
      author: "test",
      description: "Triage GitHub issues for maintainers and prepare next actions.",
      triggerType: "issue",
      entry_point: "scripts/run.ts",
    });

    expect(skill.name).toBe("issue-triage");
    expect(skill.triggers).toEqual(["issue"]);
    expect(CodexSkillSchema.safeParse(skill).success).toBe(true);
  });

  it("wraps a single-string triggers value instead of silently dropping it", () => {
    const skill = normalizeSkillInput({
      name: "security-scan",
      description: "Run repository security scans and summarize the findings.",
      triggers: "security",
    });

    expect(skill.triggers).toEqual(["security"]);
  });

  it("rejects triggers values that are neither arrays nor strings", () => {
    expect(() =>
      normalizeSkillInput({
        name: "security-scan",
        description: "Run repository security scans and summarize the findings.",
        triggers: 5,
      }),
    ).toThrow();
  });

  it("accepts semver versions combining prerelease and build metadata", () => {
    const skill = normalizeSkillInput({
      name: "release-notes",
      description: "Draft release notes from merged pull requests for maintainers.",
      version: "1.2.3-rc.1+build.5",
    });

    expect(skill.version).toBe("1.2.3-rc.1+build.5");
  });

  it("accepts stdio and HTTP MCP server configs", () => {
    expect(
      McpServerConfigSchema.safeParse({
        command: "npx",
        args: ["-y", "@upstash/context7-mcp"],
      }).success,
    ).toBe(true);

    expect(
      McpServerConfigSchema.safeParse({
        url: "https://example.com/mcp",
        bearer_token_env_var: "TOKEN",
      }).success,
    ).toBe(true);
  });
});
