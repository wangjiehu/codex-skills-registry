# Security Policy

This project validates and indexes maintainer automation definitions. It does
not execute community-contributed skill scripts.

## Supported versions

Security fixes target the latest released minor version.

| Version | Supported |
| --- | --- |
| Latest npm release | Yes |
| Older releases | No |

## Reporting a vulnerability

Please open a
[private GitHub security advisory](https://github.com/Hephaestus-DevKit/codex-skills-registry/security/advisories/new).
Do not open a public issue for an undisclosed vulnerability.

Include:

- affected version or commit
- steps to reproduce
- impact
- whether the issue requires a malicious skill, MCP config, plugin manifest, or CLI input

## Response targets

- Initial acknowledgement: within 3 business days.
- Initial impact assessment: within 7 business days.
- Status updates: at least weekly while remediation is active.
- Disclosure: coordinated after a fix is available, with credit when requested.

## Security model

Current behavior:

- parse `SKILL.md` frontmatter
- validate MCP server config shape
- inspect GitHub Actions workflow permission and action-reference risk
- audit risky patterns such as shell-based MCP commands, broad tool exposure,
  insecure remote MCP hosts, likely secret literals, and entry points that
  escape a skill directory
- mock-run skills without invoking arbitrary code
- emit review findings through text, JSON, SARIF, and GitHub Actions annotations

Primary threats this project is designed to surface:

- skill entry points that traverse outside the skill directory
- plugin manifests that reference files outside the plugin root
- MCP servers that execute shell wrappers or unpinned packages
- MCP servers that expose broad tool access without an explicit allow or deny list
- remote MCP servers that use insecure transport or unapproved hosts
- secrets embedded directly in MCP environment, HTTP header, or bearer token
  configuration
- secrets embedded in remote MCP URL query strings
- workflows that omit explicit permissions, grant broad write permissions, use
  `pull_request_target`, reference mutable actions, or pipe downloaded scripts
  into a shell

Current controls:

- Skill execution is mocked only; entry point scripts are not invoked.
- Plugin skill and MCP paths are checked against their containing root.
- Project policy can require pinned MCP packages, approved MCP commands,
  pinned workflow actions, approved remote hosts, explicit MCP tool policy, and
  plugin skill paths.
- Project policy can deny specific skills, plugins, MCP servers, commands, and
  remote MCP hosts.
- Baseline files and expiring suppressions support incremental adoption without
  hiding newly introduced findings.
- Findings include source file and best-effort line hints for CI review.
- Examples should use harmless local templates and must not include real
  credentials, tokens, private URLs, or production data.
- PR comment publishing is opt-in and should be run with only
  `pull-requests: write` plus read-only contents permission.
- The release workflow uses npm Trusted Publishing/OIDC and attests the packed
  npm tarball before publishing that same artifact.

Out of scope for the current release:

- executing arbitrary skill scripts
- guaranteeing that a third-party MCP server is safe
- scanning full source code for malicious behavior
- sandboxing tools or network calls

If real execution is added later, it should require explicit opt-in, policy
configuration, and sandboxing.
