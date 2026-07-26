import { describe, expect, it } from "vitest";
import { auditMcpServer, auditSkill } from "../src/audit.js";
import type { CodexSkill } from "../src/schema.js";

describe("audit", () => {
  it("flags skill entry points that escape the skill directory", () => {
    const skill: CodexSkill = {
      name: "bad-entry",
      description: "A deliberately invalid skill used to test registry safety checks.",
      version: "0.1.0",
      triggers: ["manual"],
      entryPoint: "../outside.js",
      source: "inline",
      tags: [],
      metadata: {},
    };

    const issues = auditSkill(skill);

    expect(issues.some((issue) => issue.severity === "error")).toBe(true);
    expect(issues.map((issue) => issue.path)).toContain("bad-entry.entryPoint");
  });

  it("warns about broad MCP tool exposure and unpinned npx packages", () => {
    const issues = auditMcpServer({
      name: "context7",
      sourcePath: "config.toml",
      config: {
        command: "npx",
        args: ["-y", "@upstash/context7-mcp"],
      },
    });

    expect(issues.map((issue) => issue.path)).toContain("mcp_servers.context7.args");
    expect(issues.find((issue) => issue.path === "mcp_servers.context7.args")?.code).toBe(
      "MCP_UNPINNED_NPX",
    );
    expect(issues.map((issue) => issue.path)).toContain("mcp_servers.context7.enabled_tools");
    expect(issues.every((issue) => issue.file === "config.toml")).toBe(true);
  });

  it("promotes shell command risk to an error in strict mode", () => {
    const issues = auditMcpServer(
      {
        name: "shell",
        sourcePath: "config.toml",
        line: 1,
        fieldLines: {
          command: 2,
        },
        config: {
          command: "bash",
          args: ["-lc", "node server.js"],
        },
      },
      { strict: true },
    );

    const commandIssue = issues.find((issue) => issue.path === "mcp_servers.shell.command");
    expect(commandIssue?.severity).toBe("error");
    expect(commandIssue?.line).toBe(2);
  });

  it("does not throw when a caller bypasses schema validation with an invalid URL", () => {
    const issues = auditMcpServer({
      name: "remote",
      sourcePath: "config.toml",
      config: {
        url: "not a url",
      } as never,
    });

    expect(issues.some((issue) => issue.code === "MCP_INVALID_REMOTE_URL")).toBe(true);
  });

  it("flags secret-like literals in MCP headers and bearer token fields", () => {
    const issues = auditMcpServer({
      name: "remote",
      sourcePath: "config.toml",
      config: {
        url: "https://example.com/mcp",
        enabled_tools: ["search"],
        http_headers: {
          Authorization: "Bearer abc1234567890SECRET",
        },
        bearer_token_env_var: "tok-1234567890abcdef",
      } as never,
    });

    expect(issues.filter((issue) => issue.code === "MCP_SECRET_LITERAL")).toHaveLength(2);
  });

  it("classifies non-portable variable references separately from secret literals", () => {
    const issues = auditMcpServer({
      name: "remote",
      sourcePath: "config.toml",
      config: {
        url: "https://example.com/mcp",
        enabled_tools: ["search"],
        bearer_token_env_var: "mcp_token_v2",
        env_http_headers: {
          Authorization: "mcp_auth_header",
        },
      } as never,
    });

    expect(issues.map((issue) => issue.code)).toContain("MCP_REMOTE_TOKEN_ENV_VAR_INVALID");
    expect(issues.map((issue) => issue.code)).toContain("MCP_HEADER_ENV_VAR_INVALID");
    expect(issues.map((issue) => issue.code)).not.toContain("MCP_SECRET_LITERAL");
  });

  it("flags remote MCP URL query secrets and invalid auth variable names", () => {
    const issues = auditMcpServer({
      name: "remote",
      sourcePath: "config.toml",
      config: {
        url: "https://example.com/mcp?token=abc1234567890SECRET",
        enabled_tools: ["search"],
        bearer_token_env_var: "token-name",
        env_http_headers: {
          Authorization: "bad-name",
        },
      } as never,
    });

    expect(issues.map((issue) => issue.code)).toContain("MCP_REMOTE_URL_SECRET");
    expect(issues.map((issue) => issue.code)).toContain("MCP_REMOTE_TOKEN_ENV_VAR_INVALID");
    expect(issues.map((issue) => issue.code)).toContain("MCP_HEADER_ENV_VAR_INVALID");
  });

  it("still audits tool policy and env secrets when the remote URL is invalid", () => {
    const issues = auditMcpServer({
      name: "remote",
      sourcePath: "config.toml",
      config: {
        url: "not a url",
        default_tools_approval_mode: "never",
        env: {
          API_KEY: "abc1234567890SECRET",
        },
      } as never,
    });

    const codes = issues.map((issue) => issue.code);
    expect(codes).toContain("MCP_INVALID_REMOTE_URL");
    expect(codes).toContain("MCP_TOOL_POLICY_MISSING");
    expect(codes).toContain("MCP_BROAD_APPROVAL_MODE");
    expect(codes).toContain("MCP_SECRET_LITERAL");
  });

  it("denies remote hosts even when the URL adds a non-default port", () => {
    const issues = auditMcpServer(
      {
        name: "remote",
        sourcePath: "config.toml",
        config: {
          url: "https://evil.example.com:8443/mcp",
          enabled_tools: ["search"],
        } as never,
      },
      {
        policy: {
          deniedRemoteMcpHosts: ["evil.example.com"],
          requirePinnedMcpPackages: false,
          requirePinnedWorkflowActions: false,
          requireExplicitMcpToolPolicy: false,
          requirePluginSkillPaths: false,
          failOnWarnings: false,
          suppressions: [],
        },
      },
    );

    expect(issues.map((issue) => issue.code)).toContain("MCP_REMOTE_HOST_DENIED");
  });

  it("normalizes Windows executable suffixes for command policy checks", () => {
    const allowPolicy = {
      allowedMcpCommands: ["node"],
      requirePinnedMcpPackages: false,
      requirePinnedWorkflowActions: false,
      requireExplicitMcpToolPolicy: false,
      requirePluginSkillPaths: false,
      failOnWarnings: false,
      suppressions: [],
    };
    const allowedIssues = auditMcpServer(
      {
        name: "docs",
        sourcePath: "config.toml",
        config: {
          command: "node.exe",
          enabled_tools: ["search"],
        },
      },
      { policy: allowPolicy },
    );
    const shellIssues = auditMcpServer({
      name: "shell",
      sourcePath: "config.toml",
      config: {
        command: "C:\\Program Files\\Git\\bin\\bash.exe",
        enabled_tools: ["run"],
      },
    });

    expect(allowedIssues.map((issue) => issue.code)).not.toContain("MCP_COMMAND_NOT_ALLOWED");
    expect(shellIssues.map((issue) => issue.code)).toContain("MCP_SHELL_COMMAND");
  });

  it("flags broad per-tool approval modes", () => {
    const issues = auditMcpServer({
      name: "docs",
      sourcePath: "config.toml",
      config: {
        command: "node",
        enabled_tools: ["search"],
        tools: {
          run_shell: { approval_mode: "never" },
          search: { approval_mode: "prompt" },
        },
      } as never,
    });

    const broad = issues.filter((issue) => issue.code === "MCP_BROAD_APPROVAL_MODE");
    expect(broad).toHaveLength(1);
    expect(broad[0]?.path).toBe("mcp_servers.docs.tools.run_shell.approval_mode");
  });

  it("applies MCP deny-list policy checks", () => {
    const issues = auditMcpServer(
      {
        name: "blocked",
        sourcePath: "config.toml",
        config: {
          command: "bash",
          enabled_tools: ["run"],
        },
      },
      {
        policy: {
          deniedMcpServers: ["blocked"],
          deniedMcpCommands: ["bash"],
          requirePinnedMcpPackages: false,
          requirePinnedWorkflowActions: false,
          requireExplicitMcpToolPolicy: false,
          requirePluginSkillPaths: false,
          failOnWarnings: false,
          suppressions: [],
        },
      },
    );

    expect(issues.map((issue) => issue.code)).toContain("MCP_SERVER_DENIED");
    expect(issues.map((issue) => issue.code)).toContain("MCP_COMMAND_DENIED");
  });
});
