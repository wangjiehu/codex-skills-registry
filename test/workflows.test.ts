import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { auditGithubWorkflow, discoverGithubWorkflows } from "../src/workflows.js";

describe("GitHub workflow discovery and audit", () => {
  it("discovers workflow jobs and action references", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "codex-workflows-"));

    try {
      await writeWorkflow(
        root,
        "validate.yml",
        `name: validate
on:
  pull_request:
permissions:
  contents: read
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@34e114876b0b11c390a56381ad16ebd13914f8d5
      - run: npm test
`,
      );

      const result = await discoverGithubWorkflows(root);

      expect(result.diagnostics).toHaveLength(0);
      expect(result.workflows[0]?.name).toBe("validate");
      expect(result.workflows[0]?.jobs[0]?.id).toBe("test");
      expect(result.workflows[0]?.uses[0]?.value).toContain("actions/checkout");
      expect(result.workflows[0]?.runs[0]?.value).toBe("npm test");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("audits workflow permissions, pull_request_target, and unpinned actions", () => {
    const issues = auditGithubWorkflow(
      {
        name: "risky",
        sourcePath: ".github/workflows/risky.yml",
        triggers: {
          pull_request_target: {},
        },
        permissions: "write-all",
        jobs: [
          {
            id: "comment",
          },
        ],
        uses: [
          {
            value: "actions/checkout@v4",
            path: "workflows.risky.jobs.comment.steps.0.uses",
            jobId: "comment",
            line: 9,
          },
        ],
        runs: [],
      },
      {
        policy: {
          requirePinnedMcpPackages: false,
          requirePinnedWorkflowActions: true,
          requireExplicitMcpToolPolicy: false,
          requirePluginSkillPaths: false,
          failOnWarnings: false,
          suppressions: [],
        },
      },
    );

    expect(issues.map((issue) => issue.code)).toContain("WORKFLOW_BROAD_PERMISSIONS");
    expect(issues.map((issue) => issue.code)).toContain("WORKFLOW_PULL_REQUEST_TARGET");
    expect(issues.map((issue) => issue.code)).toContain("WORKFLOW_UNPINNED_ACTION");
    expect(issues.find((issue) => issue.code === "WORKFLOW_UNPINNED_ACTION")?.severity).toBe(
      "error",
    );
  });

  it("flags jobs that inherit default permissions when only sibling jobs are scoped", () => {
    const issues = auditGithubWorkflow({
      name: "partially-scoped",
      sourcePath: ".github/workflows/partially-scoped.yml",
      triggers: {
        pull_request: {},
      },
      jobs: [
        {
          id: "scoped",
          permissions: {
            contents: "read",
          },
          line: 7,
        },
        {
          id: "inherited",
          line: 12,
        },
      ],
      uses: [],
      runs: [],
    });

    const permissionIssues = issues.filter(
      (issue) => issue.code === "WORKFLOW_PERMISSIONS_MISSING",
    );

    expect(permissionIssues).toHaveLength(1);
    expect(permissionIssues[0]?.path).toBe("workflows.partially-scoped.jobs.inherited.permissions");
    expect(permissionIssues[0]?.line).toBe(12);
  });

  it("allows job-scoped contents write for push-only publishing workflows", () => {
    const issues = auditGithubWorkflow({
      name: "pages",
      sourcePath: ".github/workflows/pages.yml",
      triggers: {
        push: {
          branches: ["main"],
        },
      },
      permissions: {
        contents: "read",
      },
      jobs: [
        {
          id: "publish",
          permissions: {
            contents: "write",
          },
        },
      ],
      uses: [],
      runs: [],
    });

    expect(issues.filter((issue) => issue.code === "WORKFLOW_BROAD_PERMISSIONS")).toHaveLength(0);
  });

  it("flags job-scoped contents write in pull request workflows", () => {
    const issues = auditGithubWorkflow({
      name: "comment",
      sourcePath: ".github/workflows/comment.yml",
      triggers: {
        pull_request: {},
      },
      permissions: {
        contents: "read",
      },
      jobs: [
        {
          id: "publish",
          permissions: {
            contents: "write",
          },
        },
      ],
      uses: [],
      runs: [],
    });

    expect(issues.map((issue) => issue.code)).toContain("WORKFLOW_BROAD_PERMISSIONS");
  });

  it("keeps the composite action wired to tested helper scripts", async () => {
    const action = await readFile(path.join(process.cwd(), "action.yml"), "utf8");
    const dollar = "$";

    expect(action).toContain("[[ -f dist/cli.js && -f dist/action-summary.js ]]");
    expect(action).toContain(
      `text_args=("${dollar}{base_args[@]}" --format text --github-annotations)`,
    );
    expect(action).toContain('output_path="$REGISTRY_INPUT_OUTPUT_DIRECTORY"');
    expect(action).toContain('summary_file="$output_path/codex-skills-registry-summary.json"');
    expect(action).toContain(`write_issue_outputs pr-comment "${dollar}{strict_args[@]}"`);
    expect(action).toContain('node dist/action-summary.js "$summary_file"');
  });

  it("keeps the reusable action smoke coverage for escaped project inputs", async () => {
    const workflow = await readFile(
      path.join(process.cwd(), ".github", "workflows", "validate.yml"),
      "utf8",
    );

    expect(workflow).toContain("Smoke escaped policy input is rejected");
    expect(workflow).toContain("policy: ../outside-policy.yaml");
    expect(workflow).toContain("steps.escaped-policy.outcome != 'failure'");
  });

  it("separates read-only PR analysis from trusted comment publishing", async () => {
    const analysisWorkflow = await readFile(
      path.join(process.cwd(), ".github", "workflows", "registry-pr-comment.yml"),
      "utf8",
    );
    const publishWorkflow = await readFile(
      path.join(process.cwd(), ".github", "workflows", "registry-pr-comment-publish.yml"),
      "utf8",
    );

    expect(analysisWorkflow).toContain("pull_request:");
    expect(analysisWorkflow).not.toContain("pull_request_target:");
    expect(analysisWorkflow).toContain("path: action");
    expect(analysisWorkflow).toContain("path: target");
    expect(analysisWorkflow).toContain("output-directory: result");
    expect(analysisWorkflow).toContain("persist-credentials: false");
    expect(analysisWorkflow).toContain(
      "actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1",
    );
    expect(analysisWorkflow).toContain("actions/upload-artifact@");
    expect(publishWorkflow).toContain("workflow_run:");
    expect(publishWorkflow).toContain("actions/download-artifact@");
    expect(publishWorkflow).toContain("publish-comment-file.js");
    expect(publishWorkflow).not.toContain("github.event.pull_request.head.sha");
  });

  it("uses the typed npm pack parser in the release workflow", async () => {
    const workflow = await readFile(
      path.join(process.cwd(), ".github", "workflows", "release.yml"),
      "utf8",
    );

    expect(workflow).toContain("node dist/npm-pack-output.js npm-pack.json");
    expect(workflow).not.toContain("node <<'NODE'");
  });

  it("keeps standalone demo workflows pinned to the current v1 release commit", async () => {
    const demoWorkflow = await readFile(
      path.join(
        process.cwd(),
        "demo",
        "standalone-project",
        ".github",
        "workflows",
        "codex-skills.yml",
      ),
      "utf8",
    );
    const currentRelease =
      "Hephaestus-DevKit/codex-skills-registry@a570c065e61ffdb35dab87fd01084015a02a746d # v1.0.6";

    expect(demoWorkflow).toContain(currentRelease);
    expect(demoWorkflow).not.toContain("# v0.6.3");
    expect(demoWorkflow).not.toContain("pull_request_target:");
    expect(demoWorkflow).toContain(
      "actions/checkout@9c091bb21b7c1c1d1991bb908d89e4e9dddfe3e0 # v7.0.0",
    );
    expect(demoWorkflow).toContain(
      "github/codeql-action/upload-sarif@8aad20d150bbac5944a9f9d289da16a4b0d87c1e # v4",
    );
    expect(demoWorkflow).toContain(
      "actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a # v7.0.1",
    );
  });

  it("allows Dependabot to propose GitHub Actions major upgrades", async () => {
    const dependabot = await readFile(
      path.join(process.cwd(), ".github", "dependabot.yml"),
      "utf8",
    );
    const githubActionsConfig = dependabot.split("- package-ecosystem: github-actions")[1] ?? "";

    expect(dependabot).toContain("- package-ecosystem: npm");
    expect(dependabot).toContain("version-update:semver-major");
    expect(githubActionsConfig).not.toContain("version-update:semver-major");
  });
});

async function writeWorkflow(root: string, name: string, content: string): Promise<void> {
  const workflowsDir = path.join(root, ".github", "workflows");
  await mkdir(workflowsDir, { recursive: true });
  await writeFile(path.join(workflowsDir, name), content, "utf8");
}
