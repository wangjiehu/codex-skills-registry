import { issueCode } from "./issues.js";
import type { RegistryReport } from "./report.js";
import type { ValidationIssue } from "./schema.js";
import { escapeMarkdownText, markdownCodeSpan as codeSpan } from "./utils.js";

export interface PullRequestCommentOptions {
  maxFindings?: number;
  suppressedCount?: number;
  baselineCount?: number;
  reportPath?: string;
  sarifPath?: string;
}

export function formatPullRequestComment(
  report: RegistryReport,
  options: PullRequestCommentOptions = {},
): string {
  const maxFindings = options.maxFindings ?? 10;
  const status =
    report.summary.errors > 0
      ? "Action required"
      : report.summary.warnings > 0
        ? "Review recommended"
        : "No active findings";
  const lines = [
    "## Codex Skills Registry",
    "",
    `**${status}**`,
    "",
    "| Metric | Count |",
    "| --- | ---: |",
    `| Skills | ${report.summary.skills} |`,
    `| MCP servers | ${report.summary.mcpServers} |`,
    `| Plugins | ${report.summary.plugins} |`,
    `| Workflows | ${report.summary.workflows} |`,
    `| Errors | ${report.summary.errors} |`,
    `| Warnings | ${report.summary.warnings} |`,
    `| Suppressed | ${options.suppressedCount ?? 0} |`,
    `| Baseline | ${options.baselineCount ?? 0} |`,
    "",
    "### Findings",
    "",
    ...formatFindingRows(report.issues, maxFindings),
    "",
    "### Next Actions",
    "",
    ...formatNextActions(report.nextActions),
    "",
    "### Artifacts",
    "",
    ...formatArtifacts(options),
  ];

  return `${lines.join("\n")}\n`;
}

function formatFindingRows(issues: ValidationIssue[], maxFindings: number): string[] {
  if (issues.length === 0) {
    return ["No active findings."];
  }

  const rows = issues.slice(0, maxFindings).map((issue) => {
    const location = issue.file
      ? ` (${codeSpan(`${issue.file}${issue.line ? `:${issue.line}` : ""}`)})`
      : "";
    const help = issue.help ? ` ${escapeMarkdownText(issue.help)}` : "";
    return `- [${issue.severity.toUpperCase()}] ${codeSpan(issueCode(issue))} ${codeSpan(issue.path)}${location}: ${escapeMarkdownText(issue.message)}${help}`;
  });

  if (issues.length > maxFindings) {
    rows.push(`- ${issues.length - maxFindings} additional finding(s) omitted from this comment.`);
  }

  return rows;
}

function formatNextActions(nextActions: string[]): string[] {
  if (nextActions.length === 0) {
    return ["No immediate action required."];
  }

  return nextActions.map((action) => `- ${escapeMarkdownText(action)}`);
}

function formatArtifacts(options: PullRequestCommentOptions): string[] {
  const rows: string[] = [];
  if (options.reportPath) {
    rows.push(`- Report: ${escapeMarkdownText(options.reportPath)}`);
  }
  if (options.sarifPath) {
    rows.push(`- SARIF: ${escapeMarkdownText(options.sarifPath)}`);
  }

  return rows.length > 0 ? rows : ["No artifact paths were provided."];
}
