# Marketplace Evidence

This file records copied release-readiness evidence for the public package and
GitHub Action listing. It is intentionally text-based so maintainers can review
it in Git, without relying on screenshots that go stale quickly.

Refreshed on 2026-07-26 after the 1.0.6 npm package migration to
`@hepheastus-devkit/codex-skills-registry`.

## Local Gates

`npm run market:check`

```text
18 test files passed
114 tests passed
npm pack --dry-run completed
npm audit --audit-level=moderate found 0 vulnerabilities
```

Packed package install smoke:

```text
npm pack --pack-destination <temp>
npm install <packed-tarball> --ignore-scripts
npx codex-skills --version
npx codex-skills --help
```

Result:

```text
1.0.6
Usage: codex-skills [options] [command]

Validate, index, and mock-run Codex Skills, plugins, MCP configs, and workflow
risk.
```

## GitHub Actions Evidence

Latest verified main-branch checks:

| Workflow | Result | Evidence |
| --- | --- | --- |
| validate | success | https://github.com/Hephaestus-DevKit/codex-skills-registry/actions/runs/27837062780 |
| codeql | success | https://github.com/Hephaestus-DevKit/codex-skills-registry/actions/runs/27837062782 |
| pages | success | https://github.com/Hephaestus-DevKit/codex-skills-registry/actions/runs/27837062781 |
| registry-artifacts | success | https://github.com/Hephaestus-DevKit/codex-skills-registry/actions/runs/27837062791 |
| scorecard | success | https://github.com/Hephaestus-DevKit/codex-skills-registry/actions/runs/27759771438 |
| release | success | https://github.com/Hephaestus-DevKit/codex-skills-registry/actions/runs/27837556431 |

The validate workflow covered Node.js 20, 22, and 24 on Ubuntu, Windows, and
macOS, plus reusable Action smoke tests for doctor, schema, report, PR comment,
baseline, and site commands.

## Pull Request Comment Evidence

The split PR analysis and trusted `workflow_run` publisher posted an escaped
no-findings summary on a public pull request:

https://github.com/Hephaestus-DevKit/codex-skills-registry/pull/19#issuecomment-4753240784

Copied summary:

```text
No active findings
Skills: 3
MCP servers: 3
Plugins: 1
Workflows: 9
Errors: 0
Warnings: 0
Suppressed: 0
Baseline: 0
```

## npm Registry Evidence

The package publishes as `@hepheastus-devkit/codex-skills-registry` and the
release workflow publishes through Trusted Publishing/OIDC after verifying that
the release tag matches the package version and attesting the packed tarball.

Copied `npm view @hepheastus-devkit/codex-skills-registry version` and
`npm view @hepheastus-devkit/codex-skills-registry dist --json` fields:

```json
1.0.6
{
  "tarball": "https://registry.npmjs.org/@hepheastus-devkit/codex-skills-registry/-/codex-skills-registry-1.0.6.tgz",
  "fileCount": 116,
  "unpackedSize": 537810
}
```

Earlier releases up to `1.0.4` were published under the retired
`@wangjiehu/codex-skills-registry` scope with the same provenance flow.

## v1.0.5 Release Blocker (resolved)

The `v1.0.5` release run passed validation, packaging, and provenance
attestation, then failed at `npm publish` with an npm not-found or permission
response for the old `@wangjiehu/codex-skills-registry` scope:

https://github.com/Hephaestus-DevKit/codex-skills-registry/actions/runs/28357920802

The blocker was resolved in the `1.0.6` release by migrating the package to the
`@hepheastus-devkit/codex-skills-registry` organization scope, which published
successfully; `1.0.5` remains unpublished on npm by design.
