#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { access, writeFile } from "node:fs/promises";
import path from "node:path";
import { Command, Option } from "commander";
import { loadIssueBaselineFile } from "./baseline.js";
import { filterIssuesByChangedFiles, loadChangedFiles } from "./changed-files.js";
import { emitGithubAnnotations } from "./cli-output.js";
import { executeMockSkill } from "./executor.js";
import { publishPullRequestComment } from "./github-comment.js";
import {
  applyIssuePolicyFilters,
  createIssueBaseline,
  displayIssueFile,
  type IssueBaseline,
  type IssueFilterResult,
} from "./issues.js";
import {
  createRegistryJsonSchema,
  createRegistryJsonSchemaCatalog,
  isRegistryJsonSchemaName,
  listRegistryJsonSchemaNames,
} from "./json-schema.js";
import {
  formatRegistryPolicyYaml,
  RegistryPolicyPresetSchema,
  type RegistryPolicy,
  type RegistryPolicyPreset,
} from "./policy.js";
import { formatPullRequestComment } from "./pr-comment.js";
import {
  createRegistryReport,
  formatRegistryReportHtml,
  formatRegistryReportMarkdown,
} from "./report.js";
import { SkillsRegistry, formatValidationIssues, type RegistryLoadOptions } from "./registry.js";
import { explainRegistryRule, listRegistryRules } from "./rules.js";
import { createSarifLog } from "./sarif.js";
import {
  TriggerTypeSchema,
  type TriggerType,
  type ValidationIssue,
  type ValidationResult,
} from "./schema.js";
import { writeRegistrySite } from "./site.js";
import { isMainModule } from "./utils.js";

const { version: VERSION } = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
) as { version: string };

interface CliLoadOptions extends RegistryLoadOptions {
  examples?: boolean;
  changedFilesFile?: string;
  baselineFile?: string;
}

type OutputFormat = "text" | "json" | "sarif";

interface CliOutputOptions {
  format: OutputFormat;
  githubAnnotations: boolean;
}

const DEFAULT_OUTPUT_OPTIONS: CliOutputOptions = {
  format: "text",
  githubAnnotations: false,
};

interface CliIssueFilterContext {
  changedFiles?: Set<string>;
  baseline?: IssueBaseline;
  baselineDiagnostics: ValidationIssue[];
}

/**
 * Runs the codex-skills CLI.
 *
 * @param argv - Process argv vector.
 */
export async function runCli(argv = process.argv): Promise<void> {
  const program = new Command();

  program
    .name("codex-skills")
    .description(
      "Validate, index, and mock-run Codex Skills, plugins, MCP configs, and workflow risk.",
    )
    .version(VERSION)
    .option("-C, --cwd <dir>", "project directory to inspect", process.cwd())
    .option("--config <file>", "project-scoped JSON/YAML file containing additional skill records")
    .option("--policy <file>", "project-scoped YAML/JSON registry policy file")
    .option(
      "--changed-files <file>",
      "project-scoped newline-delimited changed file list for PR-focused output",
    )
    .option(
      "--baseline <file>",
      "project-scoped issue baseline JSON file; defaults to policy baselineFile",
    )
    .option("--no-examples", "exclude the examples/ skill roots under the project directory")
    .option("--format <format>", "output format: text, json, or sarif", "text")
    .option("--github-annotations", "emit GitHub Actions annotations for diagnostics")
    .addOption(new Option("--list", "legacy flag: list registered skills").hideHelp())
    .addOption(new Option("--validate", "legacy flag: validate a skill named by --name").hideHelp())
    .addOption(new Option("--name <skillName>", "skill name for --validate").hideHelp())
    .addOption(new Option("--run <skillName>", "legacy flag: mock-run a skill").hideHelp())
    .action(async (options: Record<string, unknown>) => {
      const loadOptions = toLoadOptions(options);
      const outputOptions = toOutputOptions(options);

      if (options.list) {
        await handleList(loadOptions, outputOptions);
        return;
      }

      if (options.validate) {
        await handleValidate(String(options.name ?? ""), loadOptions, outputOptions);
        return;
      }

      if (typeof options.run === "string") {
        await handleRun(options.run, loadOptions, {}, outputOptions);
        return;
      }

      program.outputHelp();
    });

  program
    .command("list")
    .description("list registered skills")
    .action(async () => {
      const parentOptions = program.opts();
      await handleList(toLoadOptions(parentOptions), toOutputOptions(parentOptions));
    });

  program
    .command("validate")
    .description("validate one skill or every registered skill")
    .argument("[name]", "skill name")
    .option("--name <skillName>", "skill name")
    .action(async (name: string | undefined, options: { name?: string }, command: Command) => {
      const parentOptions = command.parent?.opts() ?? {};
      await handleValidate(
        name ?? options.name ?? "",
        toLoadOptions(parentOptions),
        toOutputOptions(parentOptions),
      );
    });

  program
    .command("run")
    .description("mock-run a registered skill")
    .argument("<name>", "skill name")
    .option("--trigger <type>", "mock trigger type")
    .option("--repo <owner/name>", "mock repository", "example/repository")
    .action(async (name: string, options: { trigger?: string; repo: string }, command: Command) => {
      const parentOptions = command.parent?.opts() ?? {};
      const trigger = parseOptionalTrigger(options.trigger);
      await handleRun(
        name,
        toLoadOptions(parentOptions),
        {
          trigger,
          repository: options.repo,
        },
        toOutputOptions(parentOptions),
      );
    });

  program
    .command("doctor")
    .description("validate registry contents and summarize MCP/plugin discovery")
    .option("--strict", "treat selected audit warnings as errors")
    .action(async (options: { strict?: boolean }, command: Command) => {
      const parentOptions = command.parent?.opts() ?? {};
      await handleDoctor(toLoadOptions(parentOptions), options, toOutputOptions(parentOptions));
    });

  program
    .command("audit")
    .description("run safety checks for registered skills and MCP servers")
    .option("--strict", "treat selected audit warnings as errors")
    .action(async (options: { strict?: boolean }, command: Command) => {
      const parentOptions = command.parent?.opts() ?? {};
      await handleAudit(toLoadOptions(parentOptions), options, toOutputOptions(parentOptions));
    });

  program
    .command("export")
    .description("export registry index as JSON")
    .option("-o, --out <file>", "output file; prints to stdout when omitted")
    .action(async (options: { out?: string }, command: Command) => {
      const parentOptions = command.parent?.opts() ?? {};
      await handleExport(toLoadOptions(parentOptions), options.out, toOutputOptions(parentOptions));
    });

  program
    .command("report")
    .description("generate a maintainer-facing registry report")
    .option("-o, --out <file>", "output file; prints to stdout when omitted")
    .option("--html", "write an HTML report instead of Markdown")
    .action(async (options: { out?: string; html?: boolean }, command: Command) => {
      await handleReport(
        toLoadOptions(command.parent?.opts() ?? {}),
        options,
        toOutputOptions(command.parent?.opts() ?? {}),
      );
    });

  program
    .command("pr-comment")
    .description("generate a pull-request comment summarizing active findings")
    .option("-o, --out <file>", "output file; prints to stdout when omitted")
    .option("--max-findings <count>", "maximum findings to include in the comment", "10")
    .option("--report-path <path>", "report artifact path to include in the comment")
    .option("--sarif-path <path>", "SARIF artifact path to include in the comment")
    .option("--strict", "treat selected audit warnings as errors")
    .option("--post", "create or update the GitHub pull request comment")
    .option("--comment-marker <marker>", "hidden marker used to update an existing PR comment")
    .action(
      async (
        options: {
          out?: string;
          maxFindings: string;
          reportPath?: string;
          sarifPath?: string;
          strict?: boolean;
          post?: boolean;
          commentMarker?: string;
        },
        command: Command,
      ) => {
        await handlePrComment(
          toLoadOptions(command.parent?.opts() ?? {}),
          options,
          toOutputOptions(command.parent?.opts() ?? {}),
        );
      },
    );

  program
    .command("site")
    .description("generate a static GitHub Pages-ready documentation site")
    .option("-o, --out <dir>", "output directory", "site")
    .action(async (options: { out: string }, command: Command) => {
      await handleSite(
        toLoadOptions(command.parent?.opts() ?? {}),
        options,
        toOutputOptions(command.parent?.opts() ?? {}),
      );
    });

  program
    .command("baseline")
    .description("write a baseline file for the current active findings")
    .option("-o, --out <file>", "output file", "codex-skills-baseline.json")
    .option("--strict", "include strict audit findings in the baseline")
    .action(async (options: { out: string; strict?: boolean }, command: Command) => {
      const parentOptions = command.parent?.opts() ?? {};
      await handleBaseline(toLoadOptions(parentOptions), options, toOutputOptions(parentOptions));
    });

  program
    .command("explain")
    .description("explain a registry issue code")
    .argument("[code]", "issue code such as MCP_UNPINNED_NPX")
    .action((code: string | undefined) => {
      handleExplain(code, toOutputOptions(program.opts()));
    });

  program
    .command("schema")
    .description("export JSON Schema for supported registry files")
    .argument("[schema]", `single schema to export: ${listRegistryJsonSchemaNames().join(", ")}`)
    .option("-o, --out <file>", "output file; prints to stdout when omitted")
    .option(
      "--schema <schema>",
      `single schema to export: ${listRegistryJsonSchemaNames().join(", ")}`,
    )
    .action(
      async (
        schema: string | undefined,
        options: { out?: string; schema?: string },
        command: Command,
      ) => {
        if (schema && options.schema && schema !== options.schema) {
          throw new Error(
            "Use either the schema argument or --schema; both values must not differ.",
          );
        }

        const parentOptions = command.parent?.opts() ?? {};
        await handleSchema(
          toLoadOptions(parentOptions),
          {
            out: options.out,
            schema: schema ?? options.schema,
          },
          toOutputOptions(parentOptions),
        );
      },
    );

  program
    .command("init-policy")
    .description("write a starter .codex-skills-registry.yaml policy file")
    .option(
      "--preset <preset>",
      "policy preset: recommended, strict-mcp, plugin-review, or strict-supply-chain",
      "recommended",
    )
    .option("-o, --out <file>", "output file; prints to stdout when omitted")
    .option("--force", "overwrite an existing output file")
    .action(
      async (options: { preset: string; out?: string; force?: boolean }, command: Command) => {
        const parentOptions = command.parent?.opts() ?? {};
        await handleInitPolicy(
          toLoadOptions(parentOptions),
          options,
          toOutputOptions(parentOptions),
        );
      },
    );

  await program.parseAsync(argv);
}

async function handleList(
  options: CliLoadOptions,
  outputOptions: CliOutputOptions = DEFAULT_OUTPUT_OPTIONS,
): Promise<void> {
  rejectSarifFor("list", outputOptions);
  const registry = await SkillsRegistry.load(options);
  const filterContext = await createCliIssueFilterContext(options, registry);
  const diagnostics = filterCliIssues(registry.listDiagnostics(), options, registry, filterContext);
  if (outputOptions.format === "json") {
    writeJson({
      skills: registry.listSkills(),
      diagnostics: issuesForJson(diagnostics.activeIssues, options),
      suppressedIssues: issuesForJson(diagnostics.suppressedIssues, options),
      baselineIssues: issuesForJson(diagnostics.baselineIssues, options),
    });
    return;
  }

  console.log(registry.formatSkillsTable());
}

async function handleValidate(
  name: string,
  options: CliLoadOptions,
  outputOptions: CliOutputOptions = DEFAULT_OUTPUT_OPTIONS,
): Promise<void> {
  const registry = await SkillsRegistry.load(options);
  const filterContext = await createCliIssueFilterContext(options, registry);

  if (!name) {
    const results = await registry.validateAllSkills();
    const resultList = [...results.entries()].map(([skillName, result]) => ({
      name: skillName,
      ...result,
    }));
    const diagnostics = filterCliIssues(
      registry.listDiagnostics(),
      options,
      registry,
      filterContext,
    );
    // Filters are per-issue, so filtering once per result and concatenating is
    // equivalent to filtering the flattened union.
    const filteredResults = resultList.map((result) => ({
      result,
      filter: filterCliIssues(result.issues, options, registry, filterContext),
    }));
    const validationFilter: IssueFilterResult = {
      activeIssues: filteredResults.flatMap((entry) => entry.filter.activeIssues),
      suppressedIssues: filteredResults.flatMap((entry) => entry.filter.suppressedIssues),
      baselineIssues: filteredResults.flatMap((entry) => entry.filter.baselineIssues),
    };
    const issues = validationFilter.activeIssues;
    const filteredResultList = filteredResults.map(({ result, filter }) => ({
      ...result,
      valid: filter.activeIssues.every((issue) => issue.severity !== "error"),
      issues: filter.activeIssues,
    }));
    const allIssues = [
      ...filterContext.baselineDiagnostics,
      ...diagnostics.activeIssues,
      ...issues,
    ];

    if (outputOptions.githubAnnotations) {
      emitGithubAnnotations(allIssues, options.cwd);
    }

    if (outputOptions.format === "sarif") {
      writeJson(createSarifLog(allIssues, { cwd: options.cwd }));
    } else if (outputOptions.format === "json") {
      writeJson({
        diagnostics: issuesForJson(
          [...filterContext.baselineDiagnostics, ...diagnostics.activeIssues],
          options,
        ),
        results: filteredResultList.map((result) => ({
          ...result,
          issues: issuesForJson(result.issues, options),
        })),
        suppressedIssues: issuesForJson(
          [...diagnostics.suppressedIssues, ...validationFilter.suppressedIssues],
          options,
        ),
        baselineIssues: issuesForJson(
          [...diagnostics.baselineIssues, ...validationFilter.baselineIssues],
          options,
        ),
      });
    } else {
      if (filterContext.baselineDiagnostics.length > 0) {
        console.log("Baseline diagnostics:");
        console.log(
          formatValidationIssues(filterContext.baselineDiagnostics, { cwd: options.cwd }),
        );
      }

      if (diagnostics.activeIssues.length > 0) {
        if (filterContext.baselineDiagnostics.length > 0) {
          console.log("");
        }
        console.log("Diagnostics:");
        console.log(formatValidationIssues(diagnostics.activeIssues, { cwd: options.cwd }));
      }

      if (resultList.length === 0 && diagnostics.activeIssues.length === 0) {
        console.log("No registered skills to validate.");
      }

      for (const result of filteredResultList) {
        console.log(`${result.name}: ${result.valid ? "valid" : "invalid"}`);
        if (result.issues.length > 0) {
          console.log(formatValidationIssues(result.issues, { cwd: options.cwd }));
        }
      }
    }

    if (shouldFail(allIssues, registry.getPolicy())) {
      process.exitCode = 1;
    }
    return;
  }

  const result = await registry.validateSkillByName(name);
  const diagnostics = filterCliIssues(registry.listDiagnostics(), options, registry, filterContext);
  const resultFilter = filterCliIssues(result.issues, options, registry, filterContext);
  const resultIssues = resultFilter.activeIssues;
  const allIssues = [
    ...filterContext.baselineDiagnostics,
    ...diagnostics.activeIssues,
    ...resultIssues,
  ];

  if (outputOptions.githubAnnotations) {
    emitGithubAnnotations(allIssues, options.cwd);
  }

  if (outputOptions.format === "sarif") {
    writeJson(createSarifLog(allIssues, { cwd: options.cwd }));
  } else if (outputOptions.format === "json") {
    writeJson({
      name,
      ...result,
      valid: resultIssues.every((issue) => issue.severity !== "error"),
      issues: issuesForJson(resultIssues, options),
      diagnostics: issuesForJson(
        [...filterContext.baselineDiagnostics, ...diagnostics.activeIssues],
        options,
      ),
      suppressedIssues: issuesForJson(
        [...diagnostics.suppressedIssues, ...resultFilter.suppressedIssues],
        options,
      ),
      baselineIssues: issuesForJson(
        [...diagnostics.baselineIssues, ...resultFilter.baselineIssues],
        options,
      ),
    });
  } else {
    if (filterContext.baselineDiagnostics.length > 0) {
      console.log("Baseline diagnostics:");
      console.log(formatValidationIssues(filterContext.baselineDiagnostics, { cwd: options.cwd }));
    }

    if (diagnostics.activeIssues.length > 0) {
      if (filterContext.baselineDiagnostics.length > 0) {
        console.log("");
      }
      console.log("Diagnostics:");
      console.log(formatValidationIssues(diagnostics.activeIssues, { cwd: options.cwd }));
    }

    console.log(
      `${name}: ${resultIssues.every((issue) => issue.severity !== "error") ? "valid" : "invalid"}`,
    );
    console.log(formatValidationIssues(resultIssues, { cwd: options.cwd }));
  }

  if (shouldFail(allIssues, registry.getPolicy())) {
    process.exitCode = 1;
  }
}

async function handleRun(
  name: string,
  options: CliLoadOptions,
  executionOptions: { trigger?: TriggerType; repository?: string } = {},
  outputOptions: CliOutputOptions = DEFAULT_OUTPUT_OPTIONS,
): Promise<void> {
  rejectSarifFor("run", outputOptions);
  const registry = await SkillsRegistry.load(options);
  const result = await executeMockSkill(registry, name, executionOptions);

  if (outputOptions.format === "json") {
    writeJson(result);
    return;
  }

  console.log(result.logs.join("\n"));
}

async function handleDoctor(
  options: CliLoadOptions,
  doctorOptions: { strict?: boolean } = {},
  outputOptions: CliOutputOptions = DEFAULT_OUTPUT_OPTIONS,
): Promise<void> {
  const registry = await SkillsRegistry.load(options);
  const filterContext = await createCliIssueFilterContext(options, registry);
  const validationResults = await registry.validateAllSkills();
  const diagnostics = filterCliIssues(registry.listDiagnostics(), options, registry, filterContext);
  const auditFilter = filterCliIssues(
    registry.audit({ strict: doctorOptions.strict }),
    options,
    registry,
    filterContext,
  );
  // Filter per skill so the invalid count agrees with the reported issues even
  // when a baseline or suppression covers a skill's only errors.
  const skillFilters = [...validationResults.entries()].map(([skillName, result]) => ({
    skillName,
    filter: filterCliIssues(
      prefixSkillIssuePaths(skillName, result),
      options,
      registry,
      filterContext,
    ),
  }));
  const validationFilter: IssueFilterResult = {
    activeIssues: skillFilters.flatMap((entry) => entry.filter.activeIssues),
    suppressedIssues: skillFilters.flatMap((entry) => entry.filter.suppressedIssues),
    baselineIssues: skillFilters.flatMap((entry) => entry.filter.baselineIssues),
  };
  const invalidSkillCount = skillFilters.filter((entry) =>
    entry.filter.activeIssues.some((issue) => issue.severity === "error"),
  ).length;
  const auditIssues = auditFilter.activeIssues;
  const validationIssues = validationFilter.activeIssues;
  const allIssues = [
    ...filterContext.baselineDiagnostics,
    ...diagnostics.activeIssues,
    ...validationIssues,
    ...auditIssues,
  ];
  const report = {
    summary: {
      skills: registry.listSkills().length,
      invalidSkills: invalidSkillCount,
      mcpServers: registry.listMcpServers().length,
      plugins: registry.listPlugins().length,
      workflows: registry.listWorkflows().length,
      auditIssues: auditIssues.length,
      suppressedIssues:
        diagnostics.suppressedIssues.length +
        validationFilter.suppressedIssues.length +
        auditFilter.suppressedIssues.length,
      baselineIssues:
        diagnostics.baselineIssues.length +
        validationFilter.baselineIssues.length +
        auditFilter.baselineIssues.length,
    },
    policy: registry.getPolicy(),
    policyPath: registry.getPolicyPath(),
    diagnostics: [...filterContext.baselineDiagnostics, ...diagnostics.activeIssues],
    validationIssues,
    auditIssues,
    suppressedIssues: [
      ...diagnostics.suppressedIssues,
      ...validationFilter.suppressedIssues,
      ...auditFilter.suppressedIssues,
    ],
    baselineIssues: [
      ...diagnostics.baselineIssues,
      ...validationFilter.baselineIssues,
      ...auditFilter.baselineIssues,
    ],
  };

  if (outputOptions.githubAnnotations) {
    emitGithubAnnotations(allIssues, options.cwd);
  }

  if (outputOptions.format === "sarif") {
    writeJson(createSarifLog(allIssues, { cwd: options.cwd }));
  } else if (outputOptions.format === "json") {
    writeJson({
      ...report,
      diagnostics: issuesForJson(report.diagnostics, options),
      validationIssues: issuesForJson(report.validationIssues, options),
      auditIssues: issuesForJson(report.auditIssues, options),
      suppressedIssues: issuesForJson(report.suppressedIssues, options),
      baselineIssues: issuesForJson(report.baselineIssues, options),
    });
  } else {
    console.log(
      `Skills: ${report.summary.skills} registered, ${report.summary.invalidSkills} invalid`,
    );
    console.log(`MCP servers: ${report.summary.mcpServers} discovered`);
    console.log(`Plugins: ${report.summary.plugins} discovered`);
    console.log(`Workflows: ${report.summary.workflows} discovered`);
    console.log(
      `Audit: ${report.summary.auditIssues} issue${report.summary.auditIssues === 1 ? "" : "s"} found`,
    );
    console.log(`Suppressed: ${report.summary.suppressedIssues}`);
    console.log(`Baseline: ${report.summary.baselineIssues}`);

    if (report.diagnostics.length > 0) {
      console.log("\nDiagnostics:");
      console.log(formatValidationIssues(report.diagnostics, { cwd: options.cwd }));
    }

    if (validationIssues.length > 0) {
      console.log("\nValidation:");
      console.log(formatValidationIssues(validationIssues, { cwd: options.cwd }));
    }

    if (auditIssues.length > 0) {
      console.log("\nAudit:");
      console.log(formatValidationIssues(auditIssues, { cwd: options.cwd }));
    }
  }

  if (shouldFail(allIssues, registry.getPolicy())) {
    process.exitCode = 1;
  }
}

async function handleAudit(
  options: CliLoadOptions,
  auditOptions: { strict?: boolean } = {},
  outputOptions: CliOutputOptions = DEFAULT_OUTPUT_OPTIONS,
): Promise<void> {
  const registry = await SkillsRegistry.load(options);
  const filterContext = await createCliIssueFilterContext(options, registry);
  const diagnostics = filterCliIssues(registry.listDiagnostics(), options, registry, filterContext);
  const auditFilter = filterCliIssues(
    registry.audit({ strict: auditOptions.strict }),
    options,
    registry,
    filterContext,
  );
  const auditIssues = auditFilter.activeIssues;
  const issues = [
    ...filterContext.baselineDiagnostics,
    ...diagnostics.activeIssues,
    ...auditIssues,
  ];

  if (outputOptions.githubAnnotations) {
    emitGithubAnnotations(issues, options.cwd);
  }

  if (outputOptions.format === "sarif") {
    writeJson(createSarifLog(issues, { cwd: options.cwd }));
  } else if (outputOptions.format === "json") {
    writeJson({
      diagnostics: issuesForJson(
        [...filterContext.baselineDiagnostics, ...diagnostics.activeIssues],
        options,
      ),
      issues: issuesForJson(auditIssues, options),
      suppressedIssues: issuesForJson(
        [...diagnostics.suppressedIssues, ...auditFilter.suppressedIssues],
        options,
      ),
      baselineIssues: issuesForJson(
        [...diagnostics.baselineIssues, ...auditFilter.baselineIssues],
        options,
      ),
      policy: registry.getPolicy(),
      policyPath: registry.getPolicyPath(),
    });
  } else {
    if (filterContext.baselineDiagnostics.length > 0) {
      console.log("Baseline diagnostics:");
      console.log(formatValidationIssues(filterContext.baselineDiagnostics, { cwd: options.cwd }));
    }

    if (diagnostics.activeIssues.length > 0) {
      if (filterContext.baselineDiagnostics.length > 0) {
        console.log("");
      }
      console.log("Diagnostics:");
      console.log(formatValidationIssues(diagnostics.activeIssues, { cwd: options.cwd }));
    }

    if (auditIssues.length > 0) {
      if (diagnostics.activeIssues.length > 0 || filterContext.baselineDiagnostics.length > 0) {
        console.log("\nAudit:");
      }
      console.log(formatValidationIssues(auditIssues, { cwd: options.cwd }));
    } else if (
      diagnostics.activeIssues.length === 0 &&
      filterContext.baselineDiagnostics.length === 0
    ) {
      console.log(formatValidationIssues(auditIssues, { cwd: options.cwd }));
    }
  }

  if (shouldFail(issues, registry.getPolicy())) {
    process.exitCode = 1;
  }
}

async function handleExport(
  options: CliLoadOptions,
  outFile?: string,
  outputOptions: CliOutputOptions = DEFAULT_OUTPUT_OPTIONS,
): Promise<void> {
  rejectSarifFor("export", outputOptions);
  const registry = await SkillsRegistry.load(options);
  const json = `${JSON.stringify(registry.toIndex({ relativePaths: true }), null, 2)}\n`;

  if (!outFile) {
    console.log(json);
    return;
  }

  const outputPath = path.resolve(options.cwd ?? process.cwd(), outFile);
  await writeFile(outputPath, json, "utf8");
  console.log(`Exported registry index to ${outputPath}`);
}

async function handleReport(
  options: CliLoadOptions,
  reportOptions: { out?: string; html?: boolean },
  outputOptions: CliOutputOptions = DEFAULT_OUTPUT_OPTIONS,
): Promise<void> {
  rejectSarifFor("report", outputOptions);
  const registry = await SkillsRegistry.load(options);
  const filterContext = await createCliIssueFilterContext(options, registry);
  const index = registry.toIndex({ relativePaths: true });
  const filteredDiagnostics = filterCliIssues(index.diagnostics, options, registry, filterContext);
  const report = createRegistryReport({
    ...index,
    diagnostics: [...filterContext.baselineDiagnostics, ...filteredDiagnostics.activeIssues],
  });
  const output =
    outputOptions.format === "json"
      ? `${JSON.stringify(report, null, 2)}\n`
      : reportOptions.html
        ? formatRegistryReportHtml(report)
        : formatRegistryReportMarkdown(report);

  if (!reportOptions.out) {
    console.log(output);
    return;
  }

  const outputPath = path.resolve(options.cwd ?? process.cwd(), reportOptions.out);
  await writeFile(outputPath, output, "utf8");
  console.log(`Wrote registry report to ${outputPath}`);
}

async function handlePrComment(
  options: CliLoadOptions,
  commentOptions: {
    out?: string;
    maxFindings: string;
    reportPath?: string;
    sarifPath?: string;
    strict?: boolean;
    post?: boolean;
    commentMarker?: string;
  },
  outputOptions: CliOutputOptions = DEFAULT_OUTPUT_OPTIONS,
): Promise<void> {
  rejectSarifFor("pr-comment", outputOptions);
  const registry = await SkillsRegistry.load(options);
  const filterContext = await createCliIssueFilterContext(options, registry);
  const index = registry.toIndex({ relativePaths: true });
  const validationResults = await registry.validateAllSkills();
  const rawValidationIssues = [...validationResults.entries()].flatMap(([skillName, result]) =>
    prefixSkillIssuePaths(skillName, result),
  );
  const filteredDiagnostics = filterCliIssues(
    registry.listDiagnostics(),
    options,
    registry,
    filterContext,
  );
  const validationFilter = filterCliIssues(rawValidationIssues, options, registry, filterContext);
  const auditFilter = filterCliIssues(
    registry.audit({ strict: commentOptions.strict }),
    options,
    registry,
    filterContext,
  );
  const activeIssues = [
    ...filterContext.baselineDiagnostics,
    ...filteredDiagnostics.activeIssues,
    ...validationFilter.activeIssues,
    ...auditFilter.activeIssues,
  ];
  const report = createRegistryReport({
    ...index,
    diagnostics: issuesForJson(activeIssues, options),
  });
  const suppressedIssues = [
    ...filteredDiagnostics.suppressedIssues,
    ...validationFilter.suppressedIssues,
    ...auditFilter.suppressedIssues,
  ];
  const baselineIssues = [
    ...filteredDiagnostics.baselineIssues,
    ...validationFilter.baselineIssues,
    ...auditFilter.baselineIssues,
  ];
  const comment = formatPullRequestComment(report, {
    maxFindings: parsePositiveInt(commentOptions.maxFindings, "max-findings"),
    suppressedCount: suppressedIssues.length,
    baselineCount: baselineIssues.length,
    reportPath: commentOptions.reportPath,
    sarifPath: commentOptions.sarifPath,
  });
  const publishResult = commentOptions.post
    ? await publishCommentBestEffort(comment, commentOptions.commentMarker)
    : undefined;
  const output =
    outputOptions.format === "json"
      ? `${JSON.stringify(
          {
            report,
            issues: issuesForJson(report.issues, options),
            suppressedIssues: issuesForJson(suppressedIssues, options),
            baselineIssues: issuesForJson(baselineIssues, options),
            ...(publishResult ? { publishResult } : {}),
          },
          null,
          2,
        )}\n`
      : comment;

  if (!commentOptions.out) {
    console.log(output);
    return;
  }

  const outputPath = path.resolve(options.cwd ?? process.cwd(), commentOptions.out);
  await writeFile(outputPath, output, "utf8");
  console.log(`Wrote pull request comment to ${outputPath}`);
}

async function handleSite(
  options: CliLoadOptions,
  siteOptions: { out: string },
  outputOptions: CliOutputOptions = DEFAULT_OUTPUT_OPTIONS,
): Promise<void> {
  rejectSarifFor("site", outputOptions);
  const registry = await SkillsRegistry.load(options);
  const filterContext = await createCliIssueFilterContext(options, registry);
  const index = registry.toIndex({ relativePaths: true });
  const filteredDiagnostics = filterCliIssues(index.diagnostics, options, registry, filterContext);
  const report = createRegistryReport({
    ...index,
    diagnostics: [...filterContext.baselineDiagnostics, ...filteredDiagnostics.activeIssues],
  });
  const manifest = await writeRegistrySite({
    outDir: path.resolve(options.cwd ?? process.cwd(), siteOptions.out),
    report,
    rules: listRegistryRules(),
    generatedAt: index.generatedAt,
  });

  if (outputOptions.format === "json") {
    writeJson(manifest);
    return;
  }

  console.log(`Wrote registry site to ${manifest.outDir}`);
}

async function handleBaseline(
  options: CliLoadOptions,
  baselineOptions: { out: string; strict?: boolean },
  outputOptions: CliOutputOptions = DEFAULT_OUTPUT_OPTIONS,
): Promise<void> {
  rejectSarifFor("baseline", outputOptions);
  const registry = await SkillsRegistry.load(options);
  const validationResults = await registry.validateAllSkills();
  const validationIssues = [...validationResults.entries()].flatMap(([skillName, result]) =>
    prefixSkillIssuePaths(skillName, result),
  );
  const rawIssues = [
    ...registry.listDiagnostics(),
    ...validationIssues,
    ...registry.audit({ strict: baselineOptions.strict }),
  ];
  const filterContext: CliIssueFilterContext = {
    changedFiles: await loadChangedFiles(options),
    baselineDiagnostics: [],
  };
  const filtered = filterCliIssues(rawIssues, options, registry, filterContext);
  const baseline = createIssueBaseline(filtered.activeIssues, { cwd: options.cwd });
  const outputPath = path.resolve(options.cwd ?? process.cwd(), baselineOptions.out);

  await writeFile(outputPath, `${JSON.stringify(baseline, null, 2)}\n`, "utf8");
  console.log(`Wrote ${baseline.issues.length} baseline finding(s) to ${outputPath}`);
}

async function handleSchema(
  options: CliLoadOptions,
  schemaOptions: { out?: string; schema?: string },
  outputOptions: CliOutputOptions = DEFAULT_OUTPUT_OPTIONS,
): Promise<void> {
  rejectSarifFor("schema", outputOptions);
  const schema = schemaOptions.schema
    ? createNamedJsonSchema(schemaOptions.schema)
    : createRegistryJsonSchemaCatalog();
  const json = `${JSON.stringify(schema, null, 2)}\n`;

  if (!schemaOptions.out) {
    console.log(json);
    return;
  }

  const outputPath = path.resolve(options.cwd ?? process.cwd(), schemaOptions.out);
  await writeFile(outputPath, json, "utf8");
  console.log(`Exported JSON Schema to ${outputPath}`);
}

async function handleInitPolicy(
  options: CliLoadOptions,
  policyOptions: { preset: string; out?: string; force?: boolean },
  outputOptions: CliOutputOptions = DEFAULT_OUTPUT_OPTIONS,
): Promise<void> {
  rejectSarifFor("init-policy", outputOptions);
  const preset = parsePolicyPreset(policyOptions.preset);
  const yaml = formatRegistryPolicyYaml({
    extends: [preset],
    failOnWarnings: preset === "strict-mcp",
  });

  if (!policyOptions.out) {
    console.log(yaml);
    return;
  }

  const outputPath = path.resolve(options.cwd ?? process.cwd(), policyOptions.out);
  if (!policyOptions.force) {
    try {
      await access(outputPath);
      throw new Error(`Policy file already exists at ${outputPath}. Use --force to overwrite.`);
    } catch (error) {
      if (error instanceof Error && error.message.includes("already exists")) {
        throw error;
      }
    }
  }

  await writeFile(outputPath, yaml, "utf8");
  console.log(`Wrote registry policy to ${outputPath}`);
}

function handleExplain(
  code: string | undefined,
  outputOptions: CliOutputOptions = DEFAULT_OUTPUT_OPTIONS,
): void {
  rejectSarifFor("explain", outputOptions);

  if (!code) {
    const rules = listRegistryRules();
    if (outputOptions.format === "json") {
      writeJson({ rules });
      return;
    }

    console.log(rules.map((rule) => `${rule.code}: ${rule.title}`).join("\n"));
    return;
  }

  const rule = explainRegistryRule(code);
  if (!rule) {
    throw new Error(`Unknown issue code '${code}'. Run codex-skills explain to list known codes.`);
  }

  if (outputOptions.format === "json") {
    writeJson(rule);
    return;
  }

  console.log(`${rule.code}: ${rule.title}`);
  console.log(rule.description);
  console.log(`Remediation: ${rule.remediation}`);
}

function createNamedJsonSchema(name: string): Record<string, unknown> {
  if (!isRegistryJsonSchemaName(name)) {
    throw new Error(
      `Unknown schema '${name}'. Supported schemas are: ${listRegistryJsonSchemaNames().join(", ")}.`,
    );
  }

  return createRegistryJsonSchema(name);
}

function parsePolicyPreset(value: string): RegistryPolicyPreset {
  return RegistryPolicyPresetSchema.parse(value);
}

function toLoadOptions(options: Record<string, unknown>): CliLoadOptions {
  return {
    cwd: typeof options.cwd === "string" ? options.cwd : process.cwd(),
    configFile: typeof options.config === "string" ? options.config : undefined,
    policyFile: typeof options.policy === "string" ? options.policy : undefined,
    includeExamples: options.examples !== false,
    changedFilesFile: typeof options.changedFiles === "string" ? options.changedFiles : undefined,
    baselineFile: typeof options.baseline === "string" ? options.baseline : undefined,
  };
}

function toOutputOptions(options: Record<string, unknown>): CliOutputOptions {
  const format = typeof options.format === "string" ? options.format : "text";
  if (format !== "text" && format !== "json" && format !== "sarif") {
    throw new Error("Supported output formats are 'text', 'json', and 'sarif'.");
  }

  return {
    format,
    githubAnnotations: options.githubAnnotations === true,
  };
}

function writeJson(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}

function rejectSarifFor(command: string, outputOptions: CliOutputOptions): void {
  if (outputOptions.format === "sarif") {
    throw new Error(
      `SARIF output is not supported for '${command}'. Use doctor, audit, or validate.`,
    );
  }
}

function shouldFail(issues: ValidationIssue[], policy: RegistryPolicy): boolean {
  return (
    issues.some((issue) => issue.severity === "error") ||
    (policy.failOnWarnings && issues.length > 0)
  );
}

async function publishCommentBestEffort(
  body: string,
  marker?: string,
): Promise<Awaited<ReturnType<typeof publishPullRequestComment>>> {
  try {
    const result = await publishPullRequestComment({
      body,
      marker,
      token: process.env.GITHUB_TOKEN,
      repository: process.env.REGISTRY_GITHUB_REPOSITORY ?? process.env.GITHUB_REPOSITORY,
      pullRequestNumber: process.env.REGISTRY_GITHUB_PR_NUMBER ?? process.env.GITHUB_PR_NUMBER,
      apiUrl: process.env.GITHUB_API_URL,
    });

    if (result.skippedReason) {
      console.error(`Warning: skipped pull request comment publish: ${result.skippedReason}`);
    }

    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Warning: failed to publish pull request comment: ${message}`);
    return {
      posted: false,
      updated: false,
      skippedReason: message,
    };
  }
}

function issueForJson(issue: ValidationIssue, options: CliLoadOptions): ValidationIssue {
  const file = displayIssueFile(issue, options.cwd);
  const pathValue =
    issue.file && file
      ? issue.path.replace(issue.file, file).replace(/\\/g, "/")
      : issue.path.replace(/\\/g, "/");

  return {
    ...issue,
    path: pathValue,
    ...(file ? { file } : issue.file ? { file: issue.file.replace(/\\/g, "/") } : {}),
  };
}

function issuesForJson(issues: ValidationIssue[], options: CliLoadOptions): ValidationIssue[] {
  return issues.map((issue) => issueForJson(issue, options));
}

async function createCliIssueFilterContext(
  options: CliLoadOptions,
  registry: SkillsRegistry,
): Promise<CliIssueFilterContext> {
  const changedFiles = await loadChangedFiles(options);
  const baselineFile = options.baselineFile ?? registry.getPolicy().baselineFile;

  if (!baselineFile) {
    return {
      changedFiles,
      baselineDiagnostics: [],
    };
  }

  try {
    return {
      changedFiles,
      baseline: await loadIssueBaselineFile(options.cwd ?? process.cwd(), baselineFile),
      baselineDiagnostics: [],
    };
  } catch (error) {
    return {
      changedFiles,
      baselineDiagnostics: [
        {
          severity: "error",
          code: "BASELINE_LOAD_FAILED",
          path: baselineFile,
          file: baselineFile,
          message: error instanceof Error ? error.message : String(error),
          help: "Regenerate the baseline with codex-skills baseline or fix the baselineFile path.",
        },
      ],
    };
  }
}

function filterCliIssues(
  issues: ValidationIssue[],
  options: CliLoadOptions,
  registry: SkillsRegistry,
  context: CliIssueFilterContext,
): IssueFilterResult {
  const changedFiltered = filterIssuesByChangedFiles(issues, options, context.changedFiles);
  return applyIssuePolicyFilters(changedFiltered, {
    policy: registry.getPolicy(),
    cwd: options.cwd,
    baseline: context.baseline,
  });
}

function prefixSkillIssuePaths(skillName: string, result: ValidationResult): ValidationIssue[] {
  return result.issues.map((issue) => ({
    ...issue,
    path: issue.path === skillName ? issue.path : `${skillName}.${issue.path}`,
  }));
}

function parsePositiveInt(value: string, label: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${label} must be a positive integer.`);
  }

  return parsed;
}

function parseOptionalTrigger(value: string | undefined): TriggerType | undefined {
  if (!value) {
    return undefined;
  }

  return TriggerTypeSchema.parse(value);
}

if (isMainModule(import.meta.url)) {
  runCli().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
