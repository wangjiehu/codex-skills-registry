import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { executeMockSkill } from "../src/executor.js";
import { SkillsRegistry } from "../src/registry.js";

describe("SkillsRegistry", () => {
  it("loads examples, validates a skill, and mock-runs it", async () => {
    const registry = await SkillsRegistry.load({
      cwd: process.cwd(),
      includeExamples: true,
    });

    expect(registry.listSkills()).toHaveLength(3);

    const validation = await registry.validateSkillByName("issue-triage");
    expect(validation.valid).toBe(true);

    const result = await executeMockSkill(registry, "issue-triage");
    expect(result.success).toBe(true);
    expect(result.logs.join("\n")).toContain("accepted a issue event");
  });

  it("rejects mock runs with unsupported triggers", async () => {
    const registry = await SkillsRegistry.load({
      cwd: process.cwd(),
      includeExamples: true,
    });

    await expect(
      executeMockSkill(registry, "issue-triage", {
        trigger: "release",
      }),
    ).rejects.toThrow("does not accept trigger 'release'");
  });

  it("validates plugin skill paths and names", async () => {
    const registry = await SkillsRegistry.load({
      cwd: "test/fixtures/plugin-project",
      includeExamples: false,
    });

    const diagnostics = registry.listDiagnostics();

    expect(diagnostics.some((issue) => issue.message.includes("but SKILL.md declares"))).toBe(true);
    expect(diagnostics.some((issue) => issue.message.includes("is invalid"))).toBe(true);
    expect(diagnostics.some((issue) => issue.message.includes("must stay inside"))).toBe(true);
  });

  it("rejects entry points that escape a discovered skill directory during validation", async () => {
    const registry = new SkillsRegistry();
    registry.registerSkill({
      name: "escaped-entry",
      description: "A test skill with an entry point that escapes the skill directory.",
      version: "0.1.0",
      triggers: ["manual"],
      entryPoint: "../outside.js",
      rootDir: process.cwd(),
      source: "inline",
      tags: [],
      metadata: {},
    });

    const validation = await registry.validateSkillByName("escaped-entry");

    expect(validation.valid).toBe(false);
    expect(validation.issues.map((issue) => issue.path)).toContain("escaped-entry.entryPoint");
  });

  it("rejects entry points that escape through a directory symlink", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "codex-registry-symlink-"));
    const skillRoot = path.join(root, "skill");
    const outsideScripts = path.join(root, "outside-scripts");

    try {
      await mkdir(skillRoot, { recursive: true });
      await mkdir(outsideScripts, { recursive: true });
      await writeFile(path.join(outsideScripts, "run.js"), "export {};\n", "utf8");
      await symlink(
        outsideScripts,
        path.join(skillRoot, "scripts"),
        process.platform === "win32" ? "junction" : "dir",
      );

      const registry = new SkillsRegistry();
      registry.registerSkill({
        name: "symlink-entry",
        description: "A test skill whose entry point resolves outside through a symlink.",
        version: "0.1.0",
        triggers: ["manual"],
        entryPoint: "scripts/run.js",
        rootDir: skillRoot,
        source: "inline",
        tags: [],
        metadata: {},
      });

      const validation = await registry.validateSkillByName("symlink-entry");

      expect(validation.valid).toBe(false);
      expect(validation.issues.map((issue) => issue.code)).toContain("SKILL_ENTRY_POINT_ESCAPE");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("loads YAML skill config files", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "codex-registry-yaml-"));
    const configPath = path.join(root, "skills.yaml");

    try {
      await writeFile(
        configPath,
        `skills:
  - name: yaml-skill
    description: Load a registry skill from a YAML config file.
    version: 0.1.0
    triggers:
      - manual
`,
        "utf8",
      );

      const registry = await SkillsRegistry.load({
        cwd: root,
        includeExamples: false,
        configFile: "skills.yaml",
      });

      expect(registry.getSkill("yaml-skill")).toBeDefined();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("reports a diagnostic instead of crashing on an empty skill config file", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "codex-registry-empty-config-"));

    try {
      await writeFile(path.join(root, "skills.yaml"), "", "utf8");

      const registry = await SkillsRegistry.load({
        cwd: root,
        includeExamples: false,
        configFile: "skills.yaml",
      });

      expect(
        registry.listDiagnostics().some((issue) => issue.code === "CONFIG_SKILLS_MISSING"),
      ).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects config files that resolve outside the project", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "codex-registry-config-symlink-"));
    const outside = await mkdtemp(path.join(tmpdir(), "codex-registry-config-outside-"));

    try {
      await writeFile(
        path.join(outside, "skills.yaml"),
        `skills:
  - name: escaped-config-skill
    description: This config file resolves outside the inspected project.
    version: 0.1.0
    triggers:
      - manual
`,
        "utf8",
      );
      await symlink(
        outside,
        path.join(root, "linked"),
        process.platform === "win32" ? "junction" : "dir",
      );

      await expect(
        SkillsRegistry.load({
          cwd: root,
          includeExamples: false,
          configFile: "linked/skills.yaml",
        }),
      ).rejects.toThrow("config path must resolve inside");
    } finally {
      await rm(root, { recursive: true, force: true });
      await rm(outside, { recursive: true, force: true });
    }
  });

  it("applies plugin allow and deny policy diagnostics", async () => {
    const registry = await SkillsRegistry.load({
      cwd: "test/fixtures/plugin-external-project",
      includeExamples: false,
      policyFile: "policy.yaml",
    });

    expect(registry.listDiagnostics().some((issue) => issue.code === "PLUGIN_DENIED")).toBe(true);
  });
});
