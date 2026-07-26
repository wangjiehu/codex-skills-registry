# Changelog

## Unreleased

- Fix the published CLI entry points being silent no-ops when invoked through
  npm's POSIX bin symlinks (`npx codex-skills`, global installs) by resolving
  `argv[1]` to its real path before the direct-run comparison.
- Keep auditing MCP tool policy, approval modes, and env secrets when a remote
  server URL is invalid instead of returning after the URL error.
- Compare denied remote MCP hosts against the hostname as well as host:port so
  a non-default port cannot bypass the deny list.
- Normalize Windows executable suffixes (`.exe`, `.cmd`, `.bat`) in MCP
  command checks so shell detection and allow/deny lists behave consistently
  across platforms.
- Flag broad per-tool `approval_mode` values in addition to the server-wide
  default approval mode.
- Only update pull request comments authored by the publishing token identity,
  so other users pasting the hidden marker cannot capture the bot comment.
- Escape user-controlled skill and issue text in the Markdown registry report,
  and harden Markdown code spans against embedded backtick runs and newlines.
- Accept semver versions that combine prerelease and build metadata, and wrap
  single-string SKILL.md `triggers` values instead of silently discarding them.
- Treat empty policy files as the default policy, and stop milder presets from
  silently downgrading `failOnWarnings` when combined with stricter presets in
  `extends`.
- Report a `CONFIG_SKILLS_MISSING` diagnostic instead of crashing when a skill
  config file is empty or null.
- Give `SKILL_ENTRY_POINT_MISSING` findings a stable project-relative path so
  baselines generated on one machine match in CI.
- Make `doctor`'s invalid-skill count respect baselines, suppressions, and
  changed-file filters, matching the reported issue lists.
- Reject `--format sarif` up front for `list`, `run`, `export`, `baseline`,
  `schema`, and `init-policy` instead of emitting mislabeled output.
- Decode git C-quoted paths in `--changed-files` lists so findings on files
  with special or non-ASCII characters are not silently dropped.
- Unwrap camelCase `mcpServers` wrapper files referenced by plugin manifests.
- Improve `file:line` hints for JSON MCP configs and workflow YAML by matching
  keys depth-aware and ignoring block-scalar content, and stop labeling
  project skills as examples based on unrelated `examples` path segments.
- Warn with `PLUGIN_MCP_NOT_DISCOVERED` when a plugin's inline MCP servers are
  absent from the project config; the plugin's own entries no longer satisfy
  the check.
- Update SHA-pinned `actions/setup-node` and `github/codeql-action` workflow
  dependencies and in-range npm dependencies.
- Fix stale `@wangjiehu` npm scope references in docs, demo templates, and the
  security policy after the 1.0.6 package rename.
- Pin README and demo Action examples to the v1.0.6 release SHA.

## 1.0.6 - 2026-07-03

- Migrate the npm package name to `@hepheastus-devkit/codex-skills-registry`
  so releases publish under the organization scope.
- Keep npm Trusted Publishing recovery guidance aligned with the
  `Hephaestus-DevKit/codex-skills-registry` repository.
- Make Pages publishing use a generated `gh-pages` branch so documentation
  updates are not blocked by stale GitHub Pages workflow deployment queues.
- Refresh Biome schema metadata for the installed formatter version.

## 1.0.5 - 2026-06-29

- Keep project-scoped input files inside the inspected project after resolving
  symlinks or junctions.
- Add reusable Action smoke coverage for escaped project input paths.
- Refresh repository metadata, badges, and Action examples for the
  `Hephaestus-DevKit/codex-skills-registry` GitHub repository.
- Upgrade low-risk `@biomejs/biome` and `smol-toml` patch/minor dependencies.

## 1.0.4 - 2026-06-20

- Add an Action `output-directory` input so generated artifacts can be kept
  outside untrusted source checkouts.
- Bound PR comment artifact reads and escaped output by UTF-8 byte size to
  prevent memory growth and oversized GitHub comments.
- Upgrade all repository and example workflows to the SHA-pinned
  `actions/checkout` v7.0.0 release.

## 1.0.3 - 2026-06-18

- Replace two CodeQL-flagged identifier regular expressions with linear
  scanners to prevent polynomial-time behavior on untrusted long inputs.
- Split pull request analysis from write-token comment publishing using a
  read-only `pull_request` workflow and a trusted `workflow_run` publisher.
- Sanitize downloaded comment artifacts before publishing and narrow CodeQL
  write permissions to the analysis job.
- Strengthen the security policy with a private advisory link and response
  targets.

## 1.0.2 - 2026-06-17

- Add a `typesVersions` mapping so legacy TypeScript resolution can find the
  `./cli` subpath declarations.
- Document that the SDK is ESM-only and CommonJS consumers should use dynamic
  `import()`.
- Refresh repository maintenance workflows for Node 24-compatible GitHub
  Actions majors.

## 1.0.1 - 2026-06-15

- Fix full-registry validation so `failOnWarnings` is applied consistently.
- Detect GitHub Actions jobs that inherit repository-default token permissions.
- Block Skill and plugin paths that escape trusted roots through symlinks or junctions.
- Merge modern and legacy plugin MCP declarations and report malformed external MCP JSON.
- Quote generated policy YAML string values for reliable round-trip parsing.
- Upgrade `esbuild` to `0.28.1` to address GHSA-gv7w-rqvm-qjhr and
  GHSA-g7r4-m6w7-qqqr.

## 1.0.0 - 2026-06-10

- Redesign README for the first stable public release.
- Stabilize the release-readiness test gate on slower Windows runs.
- Document example governance so core examples stay focused on generic
  open-source maintainer workflows and third-party service examples have a clear
  review boundary.
- Add a public release `market:check` gate and require release tags to match the
  package version before npm publishing.
- Move standalone demo assets into `demo/standalone-project` so the main repository is the only demo maintenance source.
- Remove stale planning docs and add a compact documentation index.
- Add owner-side next steps for external validation, account security, and launch follow-through.
- Keep README Action examples pinned without stale release-version comments.

## 0.6.3

- Pin README Action examples to the published release commit SHA for strict supply-chain adoption.
- Clarify fork PR guidance so comment workflows use trusted code or a full release commit SHA.

## 0.6.2

- Document a fork-safe pull request comment adoption path with a dedicated validation matrix.
- Clarify that public fork PR comments should split required validation from write-token comment publishing.
- Point launch and demo guidance at clean, risky, baseline, and fork-comment workflows.

## 0.6.1

- Add local search, category filtering, result counts, and empty-state feedback to the generated Rules page.
- Add an SDK contract document that separates recommended public exports from compatibility helpers.
- Document the searchable rules catalog and SDK contract in README and launch planning docs.

## 0.6.0

- Make issue baselines stable across finding message rewording while preserving compatibility with existing baseline files.
- Tighten suppression glob behavior so `*` stays within one path segment and `**` is required for cross-directory matches.
- Complete the rule explanation catalog for every emitted issue code and add coverage to keep it in sync.
- Include validation and audit findings in `pr-comment`, add `pr-comment --strict`, and align composite Action issue outputs with the generated PR comment.
- Move composite Action and release helper scripts into typed, tested `dist` entry points.
- Harden PR comment publishing with marker normalization, paginated comment lookup, and Markdown escaping.
- Use trusted base action code for the repository PR-comment workflow while scanning pull request contents separately.
- Add HTML report Next Actions, escape all MCP transport rendering, and improve baseline diagnostic labels.
- Validate suppression expiry dates as real calendar dates and isolate CLI tests from shared fixtures.

## 0.5.1

- Fix composite Action manifest YAML parsing for the `post-comment` input description.

## 0.5.0

- Add GitHub Actions workflow discovery to registry indexes, reports, PR comments, and audit output.
- Add workflow audit rules for explicit permissions, broad token scope, `pull_request_target`, unpinned actions, PR input interpolation, and download-execute shell pipelines.
- Add policy `requirePinnedWorkflowActions` and the `strict-supply-chain` preset.
- Add `site` CLI command, SDK helper, Action command, and GitHub Pages workflow for generated documentation.
- Add opt-in PR comment publishing through `pr-comment --post` and Action `post-comment: "true"`.
- Harden remote MCP auth checks for URL query credentials and invalid bearer/header environment variable names.
- Add OpenSSF Scorecard, Pages, PR comment, and release artifact attestation workflows.
- Pin this repository's GitHub Actions references to full commit SHAs.

## 0.4.0

- Add stable issue codes, fix hints, and SARIF rule IDs for policy/audit findings.
- Add policy allow/deny lists for skills, plugins, MCP servers, MCP commands, and remote MCP hosts.
- Add policy suppressions with reason, owner, and expiry fields.
- Add issue baseline generation and filtering through `baseline`, `--baseline`, and policy `baselineFile`.
- Add pull request comment generation through `pr-comment` and reusable Action `command: pr-comment`.
- Add static HTML registry reports through `report --html`.
- Add `explain` for common issue codes and remediations.
- Add reusable Action outputs for active issue, error, warning, suppression, and baseline counts.
- Harden MCP URL handling and detect likely secret literals in headers and bearer token fields.
- Add Biome lint/format checks and stricter TypeScript compiler options.
- Add fixtures and tests for executor behavior, baselines, suppressions, remote MCP, plugin-only projects, external plugin MCP JSON, and path traversal.
- Allow the reusable Action to use committed `dist` assets with production dependencies.

## 0.3.0

- Add policy presets and an `init-policy` command.
- Add Markdown/JSON registry reports through the `report` command.
- Add PR-focused `--changed-files` filtering for CLI and Action workflows.
- Add clean and risky demo projects for manual QA and product demos.
- Add GitHub Action support for report output and changed-file filtering.
- Add safe local templates for bundled example skill scripts.
- Add a registry artifact workflow that exports index, report, and schema files.

## 0.2.0

- Add JSON Schema catalog and named schema export through the CLI and SDK.
- Add reusable GitHub Action support for `command: schema`.
- Document schema export for editor validation and CI integration.
- Add source file and best-effort line hints to audit, validation, SARIF, and
  GitHub Actions annotation output.
- Normalize SARIF artifact URIs and rule metadata to repository-relative paths
  when a project root is available.
- Export registry indexes with project-relative paths from the CLI.
- Reject mock runs when the requested trigger is not supported by the target
  skill.

## 0.1.1

- Include discovery diagnostics in `validate` and `audit` command failures.
- Report missing explicit policy files instead of silently using defaults.
- Tighten skill entry point and plugin skill path boundary checks.
- Harden the reusable GitHub Action by passing inputs through environment variables.
- Update roadmap status to match implemented v0.1 features.

## 0.1.0

- Add CLI and SDK for discovering Codex Skills, plugin manifests, and MCP server config.
- Add schema validation for `SKILL.md` frontmatter, MCP servers, and plugin manifests.
- Add project policy support through `.codex-skills-registry.yaml`.
- Add safe mock execution for issue, PR, release, security, dependency, and manual workflows.
- Add audit checks for risky MCP and skill patterns.
- Add JSON, SARIF, and GitHub Actions annotation output.
- Add a reusable GitHub Action and example maintainer workflow plugin.
- Add scoped npm package metadata, publish guards, and publish-ready docs.
- Add validation, release, Dependabot, CodeQL, and dependency review workflows for repository maintenance.
- Add project ownership and conduct files for a cleaner open-source contribution surface.
