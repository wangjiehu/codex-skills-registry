import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  discoverPluginMcpServers,
  discoverProject,
  findSkillRoots,
  parseSkillMarkdown,
} from "../src/discovery.js";
import { SkillsRegistry } from "../src/registry.js";

describe("discovery", () => {
  it("parses SKILL.md frontmatter", () => {
    const parsed = parseSkillMarkdown(`---
name: issue-triage
description: Triage GitHub issues for maintainers and identify next actions.
---

# Body
`);

    expect(parsed.frontmatter.name).toBe("issue-triage");
    expect(parsed.body).toContain("# Body");
  });

  it("parses SKILL.md frontmatter with a UTF-8 BOM", () => {
    const parsed = parseSkillMarkdown(`\uFEFF---
name: bom-skill
description: Validate a skill file that was saved with a byte order mark.
---

# Body
`);

    expect(parsed.frontmatter.name).toBe("bom-skill");
  });

  it("discovers bundled examples", async () => {
    const result = await discoverProject({ cwd: process.cwd(), includeExamples: true });

    expect(result.skills.map((skill) => skill.name).sort()).toEqual([
      "issue-triage",
      "pr-review",
      "release-notes",
    ]);
    expect(result.mcpServers.map((server) => server.name).sort()).toEqual([
      "context7",
      "docs_search",
      "maintainer_docs",
    ]);
    expect(result.plugins.map((plugin) => plugin.manifest.name)).toEqual(["maintainer-kit"]);
  });

  it("surfaces diagnostics for invalid skill fixtures", async () => {
    const result = await discoverProject({
      cwd: "test/fixtures/invalid-project",
      includeExamples: false,
    });

    expect(result.skills).toHaveLength(0);
    expect(result.diagnostics.some((issue) => issue.severity === "error")).toBe(true);
    expect(result.diagnostics.find((issue) => issue.path.endsWith(".name"))?.line).toBe(2);
    expect(result.diagnostics.find((issue) => issue.path.endsWith(".description"))?.line).toBe(3);
  });

  it("records source line hints for discovered MCP server configs", async () => {
    const result = await discoverProject({
      cwd: "test/fixtures/invalid-project",
      includeExamples: false,
    });

    const server = result.mcpServers.find((candidate) => candidate.name === "shell");

    expect(server?.line).toBe(1);
    expect(server?.fieldLines?.command).toBe(2);
    expect(server?.fieldLines?.default_tools_approval_mode).toBe(4);
  });

  it("records source line hints for inline plugin MCP servers", async () => {
    const manifestContent = `{
  "name": "inline-plugin",
  "version": "0.1.0",
  "mcpServers": {
    "inline_docs": {
      "command": "node",
      "enabled_tools": ["search"]
    }
  }
}`;
    const result = await discoverPluginMcpServers(
      process.cwd(),
      {
        name: "inline-plugin",
        version: "0.1.0",
        mcpServers: {
          inline_docs: {
            command: "node",
            enabled_tools: ["search"],
          },
        },
        mcp_servers: {},
      },
      "plugin.json",
      manifestContent,
    );

    expect(result.mcpServers[0]?.line).toBe(5);
    expect(result.mcpServers[0]?.fieldLines?.command).toBe(6);
  });

  it("discovers both modern and legacy inline plugin MCP server fields", async () => {
    const result = await discoverPluginMcpServers(
      process.cwd(),
      {
        name: "mixed-plugin",
        version: "0.1.0",
        mcpServers: {
          modern_docs: {
            command: "node",
          },
        },
        mcp_servers: {
          legacy_docs: {
            command: "node",
          },
        },
      },
      "plugin.json",
    );

    expect(result.mcpServers.map((server) => server.name).sort()).toEqual([
      "legacy_docs",
      "modern_docs",
    ]);
  });

  it("unwraps camelCase mcpServers wrapper files referenced by plugins", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "codex-plugin-mcp-camel-"));
    const mcpPath = path.join(root, "mcp.json");

    try {
      await writeFile(
        mcpPath,
        JSON.stringify(
          {
            mcpServers: {
              docs: {
                command: "node",
              },
            },
          },
          null,
          2,
        ),
        "utf8",
      );

      const result = await discoverPluginMcpServers(
        root,
        {
          name: "camel-mcp-plugin",
          version: "0.1.0",
          mcpServers: "./mcp.json",
          mcp_servers: {},
        },
        "plugin.json",
      );

      expect(result.diagnostics).toHaveLength(0);
      expect(result.mcpServers.map((server) => server.name)).toEqual(["docs"]);
      expect(result.mcpServers[0]?.fieldLines?.command).toBe(4);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("reports malformed wrapped plugin MCP config files", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "codex-plugin-mcp-invalid-"));
    const mcpPath = path.join(root, "mcp.json");

    try {
      await writeFile(
        mcpPath,
        JSON.stringify({
          mcp_servers: {
            invalid: {
              url: "not a url",
            },
          },
        }),
        "utf8",
      );

      const result = await discoverPluginMcpServers(
        root,
        {
          name: "invalid-mcp-plugin",
          version: "0.1.0",
          mcpServers: "./mcp.json",
          mcp_servers: {},
        },
        "plugin.json",
      );

      expect(result.mcpServers).toHaveLength(0);
      expect(result.diagnostics[0]?.path).toContain("mcp_servers.invalid.url");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects plugin MCP paths that escape through a directory symlink", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "codex-plugin-mcp-symlink-"));
    const pluginRoot = path.join(root, "plugin");
    const outside = path.join(root, "outside");

    try {
      await mkdir(pluginRoot, { recursive: true });
      await mkdir(outside, { recursive: true });
      await writeFile(
        path.join(outside, "mcp.json"),
        JSON.stringify({
          docs: {
            command: "node",
          },
        }),
        "utf8",
      );
      await symlink(
        outside,
        path.join(pluginRoot, "linked"),
        process.platform === "win32" ? "junction" : "dir",
      );

      const result = await discoverPluginMcpServers(
        pluginRoot,
        {
          name: "symlink-mcp-plugin",
          version: "0.1.0",
          mcpServers: "./linked/mcp.json",
          mcp_servers: {},
        },
        "plugin.json",
      );

      expect(result.mcpServers).toHaveLength(0);
      expect(result.diagnostics.map((issue) => issue.code)).toContain("PLUGIN_MCP_PATH_ESCAPE");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("skips skills disabled by Codex skills.config", async () => {
    const result = await discoverProject({
      cwd: "test/fixtures/disabled-skill-project",
      includeExamples: false,
    });

    expect(result.skills).toHaveLength(0);
    expect(result.diagnostics.some((issue) => issue.message.includes("disabled"))).toBe(true);
  });

  it("discovers plugin-only projects with external MCP JSON files", async () => {
    const result = await discoverProject({
      cwd: "test/fixtures/plugin-external-project",
      includeExamples: false,
    });

    expect(result.plugins.map((plugin) => plugin.manifest.name)).toEqual(["external-plugin"]);
    expect(result.mcpServers.map((server) => server.name)).toEqual(["external_docs"]);
    expect(result.mcpServers[0]?.sourcePath.replace(/\\/g, "/")).toContain("mcp-servers.json");
    expect(result.mcpServers[0]?.fieldLines?.command).toBe(3);
  });

  it("discovers remote MCP servers", async () => {
    const result = await discoverProject({
      cwd: "test/fixtures/remote-project",
      includeExamples: false,
    });

    expect(result.mcpServers[0]?.name).toBe("remote_docs");
    expect(result.mcpServers[0]?.config).toMatchObject({ url: "http://example.com/mcp" });
  });

  it("reports plugin path traversal diagnostics", async () => {
    const registry = await SkillsRegistry.load({
      cwd: "test/fixtures/path-traversal-project",
      includeExamples: false,
    });

    expect(registry.listPlugins()).toHaveLength(1);
    expect(
      registry.listDiagnostics().some((issue) => issue.code === "PLUGIN_SKILL_PATH_ESCAPE"),
    ).toBe(true);
  });

  it("finds skill roots while walking up to a .git boundary", async () => {
    const root = path.join(tmpdir(), `codex-skill-roots-${Date.now()}`);
    const nested = path.join(root, "packages", "app", "src");

    try {
      await mkdir(path.join(root, ".git"), { recursive: true });
      await mkdir(path.join(root, ".agents", "skills"), { recursive: true });
      await mkdir(nested, { recursive: true });
      await writeFile(path.join(root, ".git", "HEAD"), "ref: refs/heads/main\n", "utf8");

      const roots = await findSkillRoots(nested);

      expect(roots.map((value) => value.replace(/\\/g, "/"))).toContain(
        path.join(root, ".agents", "skills").replace(/\\/g, "/"),
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
