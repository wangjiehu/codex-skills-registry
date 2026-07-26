import { access, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import { auditRegistry, type AuditOptions } from "./audit.js";
import {
  discoverProject,
  parseSkillMarkdown,
  type DiscoverOptions,
  type DiscoveredMcpServer,
  type DiscoveredPlugin,
  type DiscoveryDiagnostic,
} from "./discovery.js";
import { DEFAULT_POLICY, loadRegistryPolicy, type RegistryPolicy } from "./policy.js";
import {
  CodexSkillSchema,
  normalizeSkillInput,
  zodErrorToIssues,
  type CodexSkill,
  type ValidationIssue,
  type ValidationResult,
} from "./schema.js";
import {
  isRealSubpath,
  isSubpath,
  relativePathInside,
  resolveExistingPathInside,
  skillLine,
} from "./utils.js";
import { discoverGithubWorkflows, type DiscoveredWorkflow } from "./workflows.js";

export interface RegistryLoadOptions extends DiscoverOptions {
  configFile?: string;
  policyFile?: string;
}

export interface RegistryIndex {
  generatedAt: string;
  skills: CodexSkill[];
  mcpServers: DiscoveredMcpServer[];
  plugins: DiscoveredPlugin[];
  workflows: DiscoveredWorkflow[];
  diagnostics: DiscoveryDiagnostic[];
  policy: RegistryPolicy;
}

export interface RegistryIndexOptions {
  relativePaths?: boolean;
}

export interface RegisterOptions {
  overwrite?: boolean;
}

/**
 * In-memory index for Codex maintainer automation assets. The registry is
 * deliberately small and side-effect free: it validates, lists, and prepares
 * mock runs, but never executes arbitrary skill scripts.
 */
export class SkillsRegistry {
  private cwd = process.cwd();
  private readonly skills = new Map<string, CodexSkill>();
  private readonly mcpServers: DiscoveredMcpServer[] = [];
  private readonly plugins: DiscoveredPlugin[] = [];
  private readonly workflows: DiscoveredWorkflow[] = [];
  private readonly diagnostics: DiscoveryDiagnostic[] = [];
  private policy: RegistryPolicy = DEFAULT_POLICY;
  private policyPath?: string;

  /**
   * Builds a registry from project directories and optional JSON/YAML config.
   *
   * @param options - Discovery roots and optional config file.
   * @returns Loaded registry instance.
   */
  static async load(options: RegistryLoadOptions = {}): Promise<SkillsRegistry> {
    const registry = new SkillsRegistry();
    const cwd = path.resolve(options.cwd ?? process.cwd());
    const policy = await loadRegistryPolicy(cwd, options.policyFile);
    const discovered = await discoverProject(options);
    const workflows = await discoverGithubWorkflows(cwd);

    registry.cwd = cwd;
    registry.policy = policy.policy;
    registry.policyPath = policy.sourcePath;
    registry.addDiagnostics(policy.diagnostics);
    registry.addDiagnostics(discovered.diagnostics);
    registry.addDiagnostics(workflows.diagnostics);
    registry.mcpServers.push(...dedupeMcpServers(discovered.mcpServers));
    registry.plugins.push(...discovered.plugins);
    registry.workflows.push(...workflows.workflows);

    for (const skill of discovered.skills) {
      registry.registerSkill(skill);
    }

    if (options.configFile) {
      await registry.loadFromConfigFile(
        await resolveExistingPathInside(cwd, options.configFile, "config path"),
      );
    }

    await registry.validatePlugins();

    return registry;
  }

  /**
   * Registers a normalized Codex Skill.
   *
   * @param skill - Skill entry to add.
   * @param options - Duplicate handling behavior.
   * @returns Validation result for this registration attempt.
   */
  registerSkill(skill: CodexSkill, options: RegisterOptions = {}): ValidationResult {
    const validation = this.validateSkill(skill);
    if (!validation.valid) {
      return validation;
    }

    if (this.skills.has(skill.name) && !options.overwrite) {
      const issue: ValidationIssue = {
        severity: "warning",
        code: "SKILL_DUPLICATE",
        path: skill.name,
        message: `Duplicate skill '${skill.name}' ignored. Use overwrite to replace it.`,
        help: "Keep skill names unique across discovered roots and config files.",
      };
      this.diagnostics.push(issue);
      return { valid: true, issues: [issue] };
    }

    this.skills.set(skill.name, skill);
    return { valid: true, issues: [] };
  }

  /**
   * Loads skill declarations from a JSON or YAML file. The file can be either
   * an array of skill entries or an object with a skills array.
   *
   * @param filePath - JSON, YAML, or YML file path.
   */
  async loadFromConfigFile(filePath: string): Promise<void> {
    const content = await readFile(filePath, "utf8");
    const parsed = parseStructuredConfig(content, filePath);
    const skillsInput = Array.isArray(parsed)
      ? parsed
      : parsed &&
          typeof parsed === "object" &&
          Array.isArray((parsed as { skills?: unknown }).skills)
        ? (parsed as { skills: unknown[] }).skills
        : undefined;

    if (!skillsInput) {
      this.diagnostics.push({
        severity: "error",
        code: "CONFIG_SKILLS_MISSING",
        path: filePath,
        file: filePath,
        message: "Config file must be an array of skills or an object with a skills array.",
        help: 'Use either [{ ...skill }] or { "skills": [{ ...skill }] }.',
      });
      return;
    }

    for (const [index, input] of skillsInput.entries()) {
      try {
        const skill = normalizeSkillInput(input, {
          source: "config",
          skillFile: filePath,
        });
        this.registerSkill(skill, { overwrite: true });
      } catch (error) {
        this.diagnostics.push({
          severity: "error",
          code: "CONFIG_SKILL_INVALID",
          path: `${filePath}.skills.${index}`,
          file: filePath,
          message: error instanceof Error ? error.message : String(error),
          help: "Fix this skill record so it matches the registry skill schema.",
        });
      }
    }
  }

  /**
   * Lists registered skills in stable alphabetical order.
   *
   * @returns Registered skills.
   */
  listSkills(): CodexSkill[] {
    return [...this.skills.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * Retrieves a skill by exact registry name.
   *
   * @param name - Skill name.
   * @returns Matching skill when present.
   */
  getSkill(name: string): CodexSkill | undefined {
    return this.skills.get(name);
  }

  /**
   * Validates an already-normalized skill object.
   *
   * @param skill - Candidate skill entry.
   * @returns Validation result.
   */
  validateSkill(skill: unknown): ValidationResult {
    const validation = CodexSkillSchema.safeParse(skill);
    if (validation.success) {
      return { valid: true, issues: [] };
    }

    return { valid: false, issues: zodErrorToIssues(validation.error) };
  }

  /**
   * Validates a named registered skill, including local entry point existence
   * when the skill was discovered from disk.
   *
   * @param name - Registered skill name.
   * @returns Validation result.
   */
  async validateSkillByName(name: string): Promise<ValidationResult> {
    const skill = this.getSkill(name);
    if (!skill) {
      return {
        valid: false,
        issues: [
          {
            severity: "error",
            code: "SKILL_NOT_REGISTERED",
            path: name,
            message: `Skill '${name}' is not registered.`,
            help: "Check the skill name or run codex-skills list to inspect registered skills.",
          },
        ],
      };
    }

    const result = this.validateSkill(skill);
    const issues = [...result.issues];

    if (skill.entryPoint && skill.rootDir) {
      const entryPath = path.resolve(skill.rootDir, skill.entryPoint);
      if (path.isAbsolute(skill.entryPoint) || !isSubpath(skill.rootDir, entryPath)) {
        issues.push({
          severity: "error",
          code: "SKILL_ENTRY_POINT_ESCAPE",
          path: `${skill.name}.entryPoint`,
          file: skill.skillFile,
          line: skillLine(skill, "entryPoint"),
          message: "Configured entryPoint must be relative and stay inside the skill directory.",
          help: "Use a relative entryPoint inside the discovered skill directory.",
        });
      } else {
        try {
          await access(entryPath);
          if (!(await isRealSubpath(skill.rootDir, entryPath))) {
            issues.push({
              severity: "error",
              code: "SKILL_ENTRY_POINT_ESCAPE",
              path: `${skill.name}.entryPoint`,
              file: skill.skillFile,
              line: skillLine(skill, "entryPoint"),
              message: "Configured entryPoint must resolve inside the skill directory.",
              help: "Avoid symlinks that resolve the entryPoint outside the skill directory.",
            });
          }
        } catch {
          issues.push({
            severity: "error",
            code: "SKILL_ENTRY_POINT_MISSING",
            path: `${skill.name}.entryPoint`,
            file: skill.skillFile,
            line: skillLine(skill, "entryPoint"),
            message: `Configured entryPoint '${skill.entryPoint}' does not exist.`,
            help: "Create the entry file or update entryPoint to the correct relative path.",
          });
        }
      }
    }

    return {
      valid: issues.every((issue) => issue.severity !== "error"),
      issues,
    };
  }

  /**
   * Validates every registered skill.
   *
   * @returns Map keyed by skill name.
   */
  async validateAllSkills(): Promise<Map<string, ValidationResult>> {
    const results = new Map<string, ValidationResult>();
    for (const skill of this.listSkills()) {
      results.set(skill.name, await this.validateSkillByName(skill.name));
    }

    return results;
  }

  /**
   * Lists discovered MCP server configurations.
   *
   * @returns MCP server entries.
   */
  listMcpServers(): DiscoveredMcpServer[] {
    return [...this.mcpServers].sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * Lists discovered plugin manifests.
   *
   * @returns Plugin entries.
   */
  listPlugins(): DiscoveredPlugin[] {
    return [...this.plugins].sort((a, b) => a.manifest.name.localeCompare(b.manifest.name));
  }

  /**
   * Lists discovered GitHub Actions workflow files.
   *
   * @returns Workflow entries.
   */
  listWorkflows(): DiscoveredWorkflow[] {
    return [...this.workflows].sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * Returns discovery and registry diagnostics collected during loading.
   *
   * @returns Diagnostics.
   */
  listDiagnostics(): DiscoveryDiagnostic[] {
    return [...this.diagnostics];
  }

  /**
   * Returns the project policy currently applied to audits and plugin checks.
   *
   * @returns Registry policy.
   */
  getPolicy(): RegistryPolicy {
    return this.policy;
  }

  /**
   * Returns the loaded policy file path, if one was discovered.
   *
   * @returns Policy file path.
   */
  getPolicyPath(): string | undefined {
    return this.policyPath;
  }

  /**
   * Audits registered skills and MCP server configs for review-worthy safety
   * risks such as shell execution, unpinned npx packages, broad MCP tools, and
   * entry points that escape the skill directory.
   *
   * @param options - Audit strictness options.
   * @returns Audit issues.
   */
  audit(options: AuditOptions = {}): ValidationIssue[] {
    return auditRegistry(
      {
        skills: this.listSkills(),
        mcpServers: this.listMcpServers(),
        workflows: this.listWorkflows(),
      },
      {
        ...options,
        policy: options.policy ?? this.policy,
      },
    );
  }

  /**
   * Creates a serializable registry index suitable for CI artifacts.
   *
   * @returns Registry snapshot.
   */
  toIndex(options: RegistryIndexOptions = {}): RegistryIndex {
    const index: RegistryIndex = {
      generatedAt: new Date().toISOString(),
      skills: this.listSkills(),
      mcpServers: this.listMcpServers(),
      plugins: this.listPlugins(),
      workflows: this.listWorkflows(),
      diagnostics: [...this.listDiagnostics(), ...this.audit()],
      policy: this.policy,
    };

    return options.relativePaths ? relativizeRegistryIndex(index, this.cwd) : index;
  }

  /**
   * Formats skills as a compact terminal table.
   *
   * @returns Table string.
   */
  formatSkillsTable(): string {
    const rows = this.listSkills().map((skill) => ({
      name: skill.name,
      triggers: skill.triggers.join(","),
      version: skill.version,
      source: skill.source,
      description: skill.description,
    }));

    return formatTable(rows, ["name", "triggers", "version", "source", "description"]);
  }

  private addDiagnostics(diagnostics: DiscoveryDiagnostic[]): void {
    this.diagnostics.push(...diagnostics);
  }

  private async validatePlugins(): Promise<void> {
    for (const plugin of this.plugins) {
      if (
        this.policy.allowedPlugins &&
        !this.policy.allowedPlugins.includes(plugin.manifest.name)
      ) {
        this.diagnostics.push({
          severity: "error",
          code: "PLUGIN_NOT_ALLOWED",
          path: `${plugin.sourcePath}.name`,
          file: plugin.sourcePath,
          message: `Plugin '${plugin.manifest.name}' is not allowed by project policy.`,
          help: "Add the plugin name to allowedPlugins or remove the plugin manifest.",
        });
      }

      if (this.policy.deniedPlugins?.includes(plugin.manifest.name)) {
        this.diagnostics.push({
          severity: "error",
          code: "PLUGIN_DENIED",
          path: `${plugin.sourcePath}.name`,
          file: plugin.sourcePath,
          message: `Plugin '${plugin.manifest.name}' is denied by project policy.`,
          help: "Remove this plugin or update deniedPlugins after review.",
        });
      }

      const declaredMcpServers = new Set([
        ...Object.keys(plugin.manifest.mcp_servers),
        ...(plugin.manifest.mcpServers &&
        typeof plugin.manifest.mcpServers === "object" &&
        !Array.isArray(plugin.manifest.mcpServers)
          ? Object.keys(plugin.manifest.mcpServers)
          : []),
      ]);

      const skillReferences = await this.resolvePluginSkillReferences(plugin);
      for (const [index, reference] of skillReferences.entries()) {
        if (typeof reference === "string") {
          if (this.policy.requirePluginSkillPaths) {
            this.diagnostics.push({
              severity: "error",
              code: "PLUGIN_SKILL_PATH_REQUIRED",
              path: `${plugin.sourcePath}.skills.${index}`,
              file: plugin.sourcePath,
              message: "Project policy requires plugin skill references to include a path.",
              help: "Use skill objects with both name and path so CI can verify bundled skill files.",
            });
          }
          continue;
        }

        const skillPath = path.resolve(plugin.rootDir, reference.path);
        if (!isSubpath(plugin.rootDir, skillPath)) {
          this.diagnostics.push({
            severity: "error",
            code: "PLUGIN_SKILL_PATH_ESCAPE",
            path: `${plugin.sourcePath}.skills.${index}.path`,
            file: plugin.sourcePath,
            message: "Plugin skill path must stay inside the plugin root.",
            help: "Use a relative path inside the plugin directory.",
          });
          continue;
        }

        const skillFile = path.join(skillPath, "SKILL.md");

        try {
          await access(skillFile);
          if (!(await isRealSubpath(plugin.rootDir, skillFile))) {
            this.diagnostics.push({
              severity: "error",
              code: "PLUGIN_SKILL_PATH_ESCAPE",
              path: `${plugin.sourcePath}.skills.${index}.path`,
              file: plugin.sourcePath,
              message: "Plugin skill path must resolve inside the plugin root.",
              help: "Use a plugin-local skill path and avoid symlinks that leave the plugin directory.",
            });
            continue;
          }

          const parsed = parseSkillMarkdown(await readFile(skillFile, "utf8"));
          const discoveredName = String(parsed.frontmatter.name ?? "");

          if (reference.name && reference.name !== discoveredName) {
            this.diagnostics.push({
              severity: "error",
              code: "PLUGIN_SKILL_NAME_MISMATCH",
              path: `${plugin.sourcePath}.skills.${index}.name`,
              file: plugin.sourcePath,
              message: `Plugin declares skill '${reference.name}' but SKILL.md declares '${discoveredName}'.`,
              help: "Make the plugin manifest skill name match the referenced SKILL.md frontmatter.",
            });
          }
        } catch (error) {
          this.diagnostics.push({
            severity: "error",
            code: "PLUGIN_SKILL_PATH_INVALID",
            path: `${plugin.sourcePath}.skills.${index}.path`,
            file: plugin.sourcePath,
            message:
              error instanceof Error
                ? `Plugin skill path '${reference.path}' is invalid: ${error.message}`
                : `Plugin skill path '${reference.path}' is invalid.`,
            help: "Point the plugin skill reference at a directory containing SKILL.md.",
          });
        }
      }

      for (const serverName of declaredMcpServers) {
        // The plugin's own inline servers are also discovery entries, so only
        // servers discovered outside the plugin count as project-enabled.
        const discoveredOutsidePlugin = this.mcpServers.some(
          (server) => server.name === serverName && !isSubpath(plugin.rootDir, server.sourcePath),
        );
        if (!discoveredOutsidePlugin) {
          this.diagnostics.push({
            severity: "warning",
            code: "PLUGIN_MCP_NOT_DISCOVERED",
            path: `${plugin.sourcePath}.mcp_servers.${serverName}`,
            file: plugin.sourcePath,
            message:
              "Plugin bundles an MCP server that is not present in the discovered project config; this is allowed but should be reviewed.",
            help: "Confirm whether this bundled MCP server should be enabled by project config.",
          });
        }
      }
    }
  }

  private async resolvePluginSkillReferences(
    plugin: DiscoveredPlugin,
  ): Promise<Array<string | { name?: string; path: string }>> {
    if (!plugin.manifest.skills) {
      return [];
    }

    if (Array.isArray(plugin.manifest.skills)) {
      return plugin.manifest.skills;
    }

    const skillsRoot = path.resolve(plugin.rootDir, plugin.manifest.skills);
    if (!isSubpath(plugin.rootDir, skillsRoot)) {
      this.diagnostics.push({
        severity: "error",
        code: "PLUGIN_SKILLS_PATH_ESCAPE",
        path: `${plugin.sourcePath}.skills`,
        file: plugin.sourcePath,
        message: "Plugin skills path must stay inside the plugin root.",
        help: "Use a plugin-local skills path such as ./skills.",
      });
      return [];
    }

    try {
      await access(skillsRoot);
      if (!(await isRealSubpath(plugin.rootDir, skillsRoot))) {
        this.diagnostics.push({
          severity: "error",
          code: "PLUGIN_SKILLS_PATH_ESCAPE",
          path: `${plugin.sourcePath}.skills`,
          file: plugin.sourcePath,
          message: "Plugin skills path must resolve inside the plugin root.",
          help: "Use a plugin-local skills path and avoid symlinks that leave the plugin directory.",
        });
        return [];
      }

      const entries = await readdir(skillsRoot, { withFileTypes: true });
      return entries
        .filter((entry) => entry.isDirectory() || entry.isSymbolicLink())
        .map((entry) => ({
          path: path.relative(plugin.rootDir, path.join(skillsRoot, entry.name)),
        }));
    } catch (error) {
      this.diagnostics.push({
        severity: "error",
        code: "PLUGIN_SKILLS_PATH_INVALID",
        path: `${plugin.sourcePath}.skills`,
        file: plugin.sourcePath,
        message:
          error instanceof Error
            ? `Plugin skills path '${plugin.manifest.skills}' is invalid: ${error.message}`
            : `Plugin skills path '${plugin.manifest.skills}' is invalid.`,
        help: "Point plugin skills to an existing directory inside the plugin root.",
      });
      return [];
    }
  }
}

/**
 * Formats validation issues for terminal output.
 *
 * @param issues - Issues to format.
 * @returns Human-readable lines.
 */
export function formatValidationIssues(
  issues: ValidationIssue[],
  options: { cwd?: string } = {},
): string {
  if (issues.length === 0) {
    return "No validation issues found.";
  }

  return issues
    .map((issue) => {
      const displayPath = issueDisplayPath(issue, options.cwd);
      const location = issueLocation(issue, options.cwd);
      const code = issue.code ? ` [${issue.code}]` : "";
      const help = issue.help ? ` ${issue.help}` : "";
      return `[${issue.severity.toUpperCase()}] ${displayPath}${location ? ` (${location})` : ""}${code}: ${issue.message}${help}`;
    })
    .join("\n");
}

function parseStructuredConfig(content: string, filePath: string): unknown {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === ".json") {
    return JSON.parse(content) as unknown;
  }

  if (extension === ".yaml" || extension === ".yml") {
    return parseYaml(content) as unknown;
  }

  throw new Error("Supported config extensions are .json, .yaml, and .yml.");
}

function formatTable<T extends Record<string, string>>(rows: T[], columns: (keyof T)[]): string {
  if (rows.length === 0) {
    return "No skills registered.";
  }

  const widths = Object.fromEntries(
    columns.map((column) => [
      column,
      Math.max(String(column).length, ...rows.map((row) => String(row[column]).length)),
    ]),
  ) as Record<keyof T, number>;

  const header = columns.map((column) => String(column).padEnd(widths[column])).join("  ");
  const divider = columns.map((column) => "-".repeat(widths[column])).join("  ");
  const body = rows
    .map((row) => columns.map((column) => String(row[column]).padEnd(widths[column])).join("  "))
    .join("\n");

  return `${header}\n${divider}\n${body}`;
}

function dedupeMcpServers(servers: DiscoveredMcpServer[]): DiscoveredMcpServer[] {
  const seen = new Set<string>();
  const deduped: DiscoveredMcpServer[] = [];

  for (const server of servers) {
    const key = `${server.sourcePath}:${server.name}`;
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    deduped.push(server);
  }

  return deduped;
}

function relativizeRegistryIndex(index: RegistryIndex, cwd: string): RegistryIndex {
  const root = path.resolve(cwd);

  return {
    ...index,
    skills: index.skills.map((skill) => ({
      ...skill,
      rootDir: relativizePathValue(skill.rootDir, root),
      skillFile: relativizePathValue(skill.skillFile, root),
    })),
    mcpServers: index.mcpServers.map((server) => ({
      ...server,
      sourcePath: relativizePathValue(server.sourcePath, root) ?? server.sourcePath,
    })),
    plugins: index.plugins.map((plugin) => ({
      ...plugin,
      sourcePath: relativizePathValue(plugin.sourcePath, root) ?? plugin.sourcePath,
      rootDir: relativizePathValue(plugin.rootDir, root) ?? plugin.rootDir,
    })),
    workflows: index.workflows.map((workflow) => ({
      ...workflow,
      sourcePath: relativizePathValue(workflow.sourcePath, root) ?? workflow.sourcePath,
    })),
    diagnostics: index.diagnostics.map((issue) => ({
      ...issue,
      path: issue.file
        ? issue.path.replace(issue.file, relativizePathValue(issue.file, root) ?? issue.file)
        : issue.path,
      file: relativizePathValue(issue.file, root),
    })),
  };
}

function relativizePathValue(value: string | undefined, root: string): string | undefined {
  if (!value) {
    return undefined;
  }

  const relative = path.isAbsolute(value) ? relativePathInside(root, value) : undefined;
  return (relative ?? value).replace(/\\/g, "/");
}

function issueLocation(issue: ValidationIssue, cwd?: string): string | undefined {
  if (!issue.file) {
    return undefined;
  }

  const file =
    cwd && path.isAbsolute(issue.file)
      ? relativePathInside(path.resolve(cwd), issue.file)
      : undefined;
  const displayFile = (file ?? issue.file).replace(/\\/g, "/");
  return issue.line ? `${displayFile}:${issue.line}` : displayFile;
}

function issueDisplayPath(issue: ValidationIssue, cwd?: string): string {
  if (!issue.file || !cwd || !path.isAbsolute(issue.file)) {
    return issue.path.replace(/\\/g, "/");
  }

  const file = relativePathInside(path.resolve(cwd), issue.file);
  return file
    ? issue.path.replace(issue.file, file.replace(/\\/g, "/"))
    : issue.path.replace(/\\/g, "/");
}
