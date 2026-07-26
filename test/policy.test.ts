import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import { afterEach, describe, expect, it } from "vitest";
import {
  formatRegistryPolicyYaml,
  loadRegistryPolicy,
  resolveRegistryPolicy,
} from "../src/policy.js";
import { SkillsRegistry } from "../src/registry.js";

const fixtureRoot = path.join(process.cwd(), "test", "fixtures", "policy-project");

describe("policy", () => {
  afterEach(() => {
    process.exitCode = undefined;
  });

  it("loads project policy files", async () => {
    const loaded = await loadRegistryPolicy(fixtureRoot);

    expect(loaded.policy.requirePinnedMcpPackages).toBe(true);
    expect(loaded.policy.allowedMcpCommands).toEqual(["node", "npx"]);
    expect(loaded.diagnostics).toHaveLength(0);
  });

  it("reports an error when an explicit policy file is missing", async () => {
    const loaded = await loadRegistryPolicy(fixtureRoot, "missing-policy.yaml");

    expect(loaded.diagnostics).toHaveLength(1);
    expect(loaded.diagnostics[0]?.severity).toBe("error");
    expect(loaded.diagnostics[0]?.message).toContain("does not exist");
  });

  it("reports an error when an explicit policy path escapes the project", async () => {
    const loaded = await loadRegistryPolicy(fixtureRoot, "../outside-policy.yaml");

    expect(loaded.diagnostics).toHaveLength(1);
    expect(loaded.diagnostics[0]?.severity).toBe("error");
    expect(loaded.diagnostics[0]?.message).toContain("policy path must stay inside");
  });

  it("reports an error when an explicit policy path resolves outside the project", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "codex-policy-symlink-"));
    const outside = await mkdtemp(path.join(tmpdir(), "codex-policy-outside-"));

    try {
      await mkdir(root, { recursive: true });
      await writeFile(path.join(outside, "policy.yaml"), "failOnWarnings: true\n", "utf8");
      await symlink(
        outside,
        path.join(root, "linked"),
        process.platform === "win32" ? "junction" : "dir",
      );

      const loaded = await loadRegistryPolicy(root, "linked/policy.yaml");

      expect(loaded.diagnostics).toHaveLength(1);
      expect(loaded.diagnostics[0]?.severity).toBe("error");
      expect(loaded.diagnostics[0]?.message).toContain("policy path must resolve inside");
    } finally {
      await rm(root, { recursive: true, force: true });
      await rm(outside, { recursive: true, force: true });
    }
  });

  it("applies policy to MCP audit rules", async () => {
    const registry = await SkillsRegistry.load({
      cwd: fixtureRoot,
      includeExamples: false,
    });

    expect(registry.audit().some((issue) => issue.severity === "error")).toBe(true);
  });

  it("resolves named policy presets with local overrides", () => {
    const policy = resolveRegistryPolicy({
      extends: ["recommended"],
      failOnWarnings: true,
    });

    expect(policy.requirePinnedMcpPackages).toBe(true);
    expect(policy.requireExplicitMcpToolPolicy).toBe(true);
    expect(policy.requirePluginSkillPaths).toBe(true);
    expect(policy.failOnWarnings).toBe(true);
  });

  it("keeps stricter preset settings when combining presets", () => {
    const policy = resolveRegistryPolicy({
      extends: ["strict-mcp", "recommended"],
    });

    expect(policy.failOnWarnings).toBe(true);
    expect(policy.requirePluginSkillPaths).toBe(true);
    expect(policy.allowedMcpCommands).toEqual(["node", "python", "uvx"]);
  });

  it("treats an empty policy file as the default policy", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "codex-policy-empty-"));

    try {
      await writeFile(path.join(root, ".codex-skills-registry.yaml"), "# comments only\n", "utf8");

      const loaded = await loadRegistryPolicy(root);

      expect(loaded.diagnostics).toHaveLength(0);
      expect(loaded.policy.failOnWarnings).toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("resolves supply-chain strict preset", () => {
    const policy = resolveRegistryPolicy({
      extends: ["strict-supply-chain"],
    });

    expect(policy.requirePinnedMcpPackages).toBe(true);
    expect(policy.requirePinnedWorkflowActions).toBe(true);
    expect(policy.failOnWarnings).toBe(true);
  });

  it("rejects suppression expiration dates that are not real calendar dates", () => {
    expect(() =>
      resolveRegistryPolicy({
        suppressions: [
          {
            code: "MCP_SHELL_COMMAND",
            reason: "Temporary reviewed exception",
            expiresOn: "2026-02-31",
          },
        ],
      }),
    ).toThrow("real calendar date");
  });

  it("formats starter policy YAML", () => {
    const yaml = formatRegistryPolicyYaml({
      extends: ["recommended"],
      requirePinnedWorkflowActions: true,
      deniedMcpCommands: ["bash"],
      baselineFile: "codex-skills-baseline.json",
      failOnWarnings: false,
      suppressions: [
        {
          code: "MCP_SHELL_COMMAND",
          reason: "Local fixture reviewed by maintainers",
          expiresOn: "2099-01-01",
        },
      ],
    });

    expect(yaml).toContain("extends:");
    expect(yaml).toContain("  - recommended");
    expect(yaml).toContain("requirePinnedWorkflowActions: true");
    expect(yaml).toContain("deniedMcpCommands:");
    expect(yaml).toContain('baselineFile: "codex-skills-baseline.json"');
    expect(yaml).toContain("suppressions:");
    expect(yaml).toContain('  - code: "MCP_SHELL_COMMAND"');
    expect(yaml).toContain("failOnWarnings: false");
  });

  it("quotes string values so generated policies round-trip safely", () => {
    const yaml = formatRegistryPolicyYaml({
      allowedMcpCommands: ["node", "value # with comment"],
      baselineFile: "reports:baseline.json",
    });
    const parsed = parseYaml(yaml) as {
      allowedMcpCommands: string[];
      baselineFile: string;
    };

    expect(parsed.allowedMcpCommands).toEqual(["node", "value # with comment"]);
    expect(parsed.baselineFile).toBe("reports:baseline.json");
  });
});
