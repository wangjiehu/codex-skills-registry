# Release Troubleshooting

## npm Trusted Publishing after repository moves

The npm package is published as `@hepheastus-devkit/codex-skills-registry` from
the `Hephaestus-DevKit/codex-skills-registry` GitHub repository. (Releases up to
1.0.5 used the retired `@wangjiehu/codex-skills-registry` scope; the 1.0.6
release migrated the package to the organization scope.)

If the release workflow passes validation, packs the tarball, attests
provenance, and then fails at `npm publish` with an npm `E404`, `Not Found -
PUT`, or permission-style message, check the npm package's Trusted Publisher
configuration before changing source code.

For this repository, the npm package publisher should be configured with:

- Provider: GitHub Actions
- GitHub organization/user: `Hephaestus-DevKit`
- GitHub repository: `codex-skills-registry`
- Workflow filename: `release.yml`
- Package: `@hepheastus-devkit/codex-skills-registry`

After fixing the npm package settings, rerun only the failed workflow:

```bash
gh run rerun <run-id> --repo Hephaestus-DevKit/codex-skills-registry --failed
```

The `v1.0.5` release attempt hit this failure mode under the old scope; it was
resolved by migrating the package to `@hepheastus-devkit/codex-skills-registry`
in the 1.0.6 release rather than by reconfiguring the retired scope.

