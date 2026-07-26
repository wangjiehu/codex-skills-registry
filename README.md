# codex-skills-registry

[![Validate](https://github.com/Hephaestus-DevKit/codex-skills-registry/actions/workflows/validate.yml/badge.svg)](https://github.com/Hephaestus-DevKit/codex-skills-registry/actions/workflows/validate.yml)
[![CodeQL](https://github.com/Hephaestus-DevKit/codex-skills-registry/actions/workflows/codeql.yml/badge.svg)](https://github.com/Hephaestus-DevKit/codex-skills-registry/actions/workflows/codeql.yml)
[![OpenSSF Scorecard](https://github.com/Hephaestus-DevKit/codex-skills-registry/actions/workflows/scorecard.yml/badge.svg)](https://github.com/Hephaestus-DevKit/codex-skills-registry/actions/workflows/scorecard.yml)
[![npm](https://img.shields.io/npm/v/%40hepheastus-devkit%2Fcodex-skills-registry.svg)](https://www.npmjs.com/package/@hepheastus-devkit/codex-skills-registry)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

**Live registry site:** [hephaestus-devkit.github.io/codex-skills-registry](https://hephaestus-devkit.github.io/codex-skills-registry/)

Validate, index, audit, and safely test Codex Skills, plugin manifests, MCP
server configuration, and GitHub Actions workflows before they become trusted
repository automation.

`codex-skills-registry` is built for open-source maintainers who need a small,
CI-friendly review gate for community-contributed automation. It is an
unofficial community project and is not affiliated with or endorsed by OpenAI.

## What It Does

| Need | What this project provides |
| --- | --- |
| Review Skills before trusting them | `SKILL.md` discovery, frontmatter validation, path checks, and safe mock execution |
| Audit MCP and plugin config | MCP command, host, transport, tool-policy, auth, and plugin path diagnostics |
| Harden GitHub automation | workflow permission checks, pinned-action checks, PR-safety findings, SARIF, and annotations |
| Ship usable evidence | JSON indexes, Markdown/HTML reports, Code Scanning SARIF, PR comments, and static docs sites |
| Adopt gradually | policy presets, allow/deny lists, expiring suppressions, baselines, and changed-file filtering |

The project focuses on generic maintainer workflows: issue triage, pull request
review, release notes, dependency review, security intake, and repository policy
checks. Third-party service or platform-specific examples should live in their
own repositories unless this project adds a dedicated community examples area.
See [docs/examples-governance.md](docs/examples-governance.md).

## Install

Requires Node.js 20 or newer.

Run without installing:

```bash
npx @hepheastus-devkit/codex-skills-registry@latest doctor
npx @hepheastus-devkit/codex-skills-registry@latest audit --strict
npx @hepheastus-devkit/codex-skills-registry@latest report --out codex-skills-report.md
```

Or install the CLI:

```bash
npm install -g @hepheastus-devkit/codex-skills-registry
codex-skills doctor
```

## GitHub Action

Use the bundled composite Action in CI:

```yaml
name: codex-skills

on:
  pull_request:

permissions:
  contents: read

jobs:
  validate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@9c091bb21b7c1c1d1991bb908d89e4e9dddfe3e0 # v7.0.0
      - uses: Hephaestus-DevKit/codex-skills-registry@a570c065e61ffdb35dab87fd01084015a02a746d # v1.0.6
        with:
          path: .
          command: doctor
          policy: .codex-skills-registry.yaml
          format: text
```

The example uses the verified v1.0.6 release commit. Review and update pinned
SHAs intentionally when adopting a newer release.

Set `output-directory` when `path` points at an untrusted checkout so generated
SARIF, reports, summaries, and sites are written outside that source tree.

## Quick Start

Create a policy file:

```bash
npx @hepheastus-devkit/codex-skills-registry@latest init-policy --preset recommended --out .codex-skills-registry.yaml
```

Run the local review:

```bash
npx @hepheastus-devkit/codex-skills-registry@latest doctor --policy .codex-skills-registry.yaml
```

Generate a report:

```bash
npx @hepheastus-devkit/codex-skills-registry@latest report --out codex-skills-report.md
```

Export SARIF for Code Scanning:

```bash
npx @hepheastus-devkit/codex-skills-registry@latest doctor --format sarif > codex-skills-registry.sarif
```

## CLI Commands

```bash
codex-skills list
codex-skills validate [name]
codex-skills run <name> --trigger issue
codex-skills doctor
codex-skills audit
codex-skills export --out registry-index.json
codex-skills report --out codex-skills-report.md
codex-skills report --html --out codex-skills-report.html
codex-skills pr-comment --out codex-skills-pr-comment.md
codex-skills site --out site
codex-skills baseline --out codex-skills-baseline.json
codex-skills explain MCP_UNPINNED_NPX
codex-skills schema --out codex-skills-registry.schema.json
codex-skills schema policy --out codex-skills-policy.schema.json
codex-skills init-policy --preset recommended
```

Common CI-focused options:

```bash
codex-skills doctor --format json
codex-skills audit --strict --github-annotations
codex-skills doctor --changed-files changed-files.txt
codex-skills doctor --baseline codex-skills-baseline.json
```

Project input files such as `--config`, `--policy`, `--changed-files`, and
`--baseline` must resolve inside `--cwd` (or the Action `path`). Generated
outputs can still be written to a separate trusted `output-directory` in the
GitHub Action.

## What Gets Checked

Skill and plugin checks:

- required `SKILL.md` fields and optional registry metadata;
- skill entry points that escape their skill directory;
- disabled Skills from Codex config;
- plugin manifests, bundled skill paths, and MCP JSON references;
- mock routing for issue, pull request, release, dependency, security, and
  manual maintainer workflows.

MCP checks:

- shell-based server commands;
- unpinned `npx` packages;
- insecure remote transports and unapproved remote hosts;
- broad tool exposure without explicit allow or deny policy;
- likely secret literals in environment values, HTTP headers, bearer-token
  fields, and URL query strings.

GitHub Actions checks:

- missing or broad workflow permissions;
- risky `pull_request_target` usage;
- mutable action references;
- unsafe PR interpolation;
- downloaded-script execution patterns.

## Policy

Policy files let maintainers decide how strict the registry should be:

```yaml
requirePinnedMcpPackages: true
requirePinnedWorkflowActions: true
allowedMcpCommands:
  - node
  - python
  - uvx
allowedRemoteMcpHosts:
  - example.com
requireExplicitMcpToolPolicy: true
requirePluginSkillPaths: true
failOnWarnings: false
```

Policy also supports deny lists, allow lists, baselines, suppressions with
expiry dates, and stricter presets. Export the schema for editor support:

```bash
codex-skills schema policy --out codex-skills-policy.schema.json
```

## Reports And Integrations

The registry can emit:

- text diagnostics for local review;
- JSON summaries for automation;
- GitHub Actions annotations;
- SARIF for GitHub Code Scanning;
- Markdown and HTML reports;
- static documentation sites;
- PR comment bodies or opt-in PR comment publishing.

SARIF upload pattern:

```yaml
- id: codex-skills
  uses: Hephaestus-DevKit/codex-skills-registry@a570c065e61ffdb35dab87fd01084015a02a746d # v1.0.6
  continue-on-error: true
  with:
    path: .
    command: doctor
    format: sarif

- uses: github/codeql-action/upload-sarif@8aad20d150bbac5944a9f9d289da16a4b0d87c1e # v4
  if: always() && steps.codex-skills.outputs.sarif-path != ''
  with:
    sarif_file: ${{ steps.codex-skills.outputs.sarif-path }}

- if: steps.codex-skills.outcome == 'failure'
  run: exit 1
```

PR comment publishing should use narrow permissions:

```yaml
permissions:
  contents: read
  pull-requests: write

steps:
  - uses: actions/checkout@9c091bb21b7c1c1d1991bb908d89e4e9dddfe3e0 # v7.0.0
  - uses: Hephaestus-DevKit/codex-skills-registry@a570c065e61ffdb35dab87fd01084015a02a746d # v1.0.6
    with:
      path: .
      command: pr-comment
      post-comment: "true"
```

For public fork PRs, keep analysis read-only on `pull_request`. If comments are
required, publish only escaped analysis artifacts from a trusted `workflow_run`
workflow; never execute or source the downloaded artifact. See
[docs/fork-pr-validation.md](docs/fork-pr-validation.md).

## SDK

The SDK is ESM-only. CommonJS consumers should load it with dynamic `import()`.

```ts
import { SkillsRegistry, executeMockSkill } from "@hepheastus-devkit/codex-skills-registry";

const registry = await SkillsRegistry.load({ cwd: process.cwd() });
console.log(registry.formatSkillsTable());

const validation = await registry.validateSkillByName("issue-triage");
const result = await executeMockSkill(registry, "issue-triage", {
  trigger: "issue"
});
```

The recommended public SDK surface and compatibility policy are documented in
[docs/sdk-contract.md](docs/sdk-contract.md).

## Safety Model

Current behavior is intentionally review-first:

- Skill scripts are not executed by the mock runner.
- The registry parses and validates automation definitions.
- Findings include source files and best-effort line hints.
- Real execution, sandboxing, network calls, and tool invocation are out of
  scope for the current v1 release.

This project does not prove that a third-party MCP server or service is safe.
It highlights review-worthy risk before maintainers decide what to trust.

## Demos

The `demo/` directory contains:

- `clean-project`: a passing project for local and CI smoke tests;
- `risky-project`: intentionally unsafe fixtures for audit review;
- `standalone-project`: a copy-ready template with pinned Action workflows,
  SARIF upload, PR comments, a Pages artifact workflow, and fork-safe comment
  guidance.

Run local demos:

```bash
node dist/cli.js --cwd demo/clean-project --no-examples doctor
node dist/cli.js --cwd demo/risky-project --no-examples doctor --strict
```

## Development

```bash
npm install
npm run validate
npm run release:check
npm run market:check
```

`validate` runs lint, format checks, TypeScript build, and tests.
`release:check` adds dry-run packaging. `market:check` adds npm security audit
for public release readiness.

## Release

The package is published as `@hepheastus-devkit/codex-skills-registry`.

Automated release flow:

1. Update `package.json` and `CHANGELOG.md`.
2. Run `npm run market:check`.
3. Commit the release.
4. Create a semver tag that exactly matches `package.json`, such as `v1.0.0`.
5. Push the tag.

The release workflow verifies the tag/version match, packs the npm tarball,
attests the same tarball, and publishes through npm Trusted Publishing/OIDC.
Current npm releases include provenance attestation.

Manual publish remains available for emergencies:

```bash
npm login
npm publish --access public
```

`prepublishOnly` runs `npm run release:check`, so manual publishing cannot skip
build, tests, and dry-run packaging by accident.

## Documentation

- [docs/README.md](docs/README.md): documentation index.
- [docs/examples-governance.md](docs/examples-governance.md): accepted scope for
  core examples and third-party service contributions.
- [docs/fork-pr-validation.md](docs/fork-pr-validation.md): fork PR validation
  and comment-publishing model.
- [docs/marketplace-evidence.md](docs/marketplace-evidence.md): copied CI,
  package, provenance, and PR comment evidence for public release review.
- [docs/sdk-contract.md](docs/sdk-contract.md): SDK compatibility policy.
- [docs/v1-readiness-checklist.md](docs/v1-readiness-checklist.md): v1 evidence
  checklist.

## License

MIT. See [LICENSE](LICENSE).
