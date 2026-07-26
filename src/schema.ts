import { z, type ZodError } from "zod";

/**
 * Supported maintainer workflow triggers. The values intentionally map to
 * everyday OSS maintenance events rather than product-specific webhook names.
 */
export const TriggerTypeSchema = z.enum([
  "issue",
  "pr",
  "release",
  "manual",
  "security",
  "dependency",
]);

export type TriggerType = z.infer<typeof TriggerTypeSchema>;

export const SkillNameSchema = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[a-z0-9][a-z0-9._-]*$/, {
    message:
      "Use lowercase letters, numbers, dots, underscores, or hyphens; start with a letter or number.",
  });

const SemverishSchema = z
  .string()
  .regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/, {
    message: "Expected a semver-like version such as 0.1.0 or 1.0.0-beta.1.",
  });

/**
 * Frontmatter accepted in a Codex Skill SKILL.md file. Codex itself requires
 * name and description; this project accepts extra maintainer metadata for
 * registry, CI, and mock execution workflows. Extra frontmatter fields are
 * preserved here and then normalized into the strict registry shape below.
 */
export const SkillFrontmatterSchema = z
  .object({
    name: SkillNameSchema,
    description: z.string().min(20),
    version: SemverishSchema.optional(),
    author: z.string().min(1).optional(),
    triggers: z.array(TriggerTypeSchema).min(1).optional(),
    triggerType: TriggerTypeSchema.optional(),
    entryPoint: z.string().min(1).optional(),
    tags: z.array(z.string().min(1)).optional(),
  })
  .passthrough();

export type SkillFrontmatter = z.infer<typeof SkillFrontmatterSchema>;

/**
 * Normalized registry entry for a Codex Skill. Discovery layers convert
 * official SKILL.md frontmatter, JSON/YAML config entries, and legacy
 * skillName-style records into this single shape.
 */
export const CodexSkillSchema = z
  .object({
    name: SkillNameSchema,
    description: z.string().min(20),
    version: SemverishSchema.default("0.1.0"),
    author: z.string().optional(),
    triggers: z.array(TriggerTypeSchema).min(1).default(["manual"]),
    entryPoint: z.string().optional(),
    rootDir: z.string().optional(),
    skillFile: z.string().optional(),
    source: z.enum(["project", "example", "plugin", "config", "inline"]).default("inline"),
    tags: z.array(z.string()).default([]),
    metadata: z.record(z.string(), z.unknown()).default({}),
  })
  .strict();

export type CodexSkill = z.infer<typeof CodexSkillSchema>;

const ApprovalModeSchema = z.enum(["prompt", "approve", "reject", "always", "never"]);

const McpToolPolicySchema = z
  .object({
    approval_mode: ApprovalModeSchema.optional(),
  })
  .passthrough();

const BaseMcpServerConfigSchema = z
  .object({
    enabled: z.boolean().optional(),
    required: z.boolean().optional(),
    startup_timeout_sec: z.number().int().positive().optional(),
    tool_timeout_sec: z.number().int().positive().optional(),
    enabled_tools: z.array(z.string().min(1)).optional(),
    disabled_tools: z.array(z.string().min(1)).optional(),
    default_tools_approval_mode: ApprovalModeSchema.optional(),
    tools: z.record(z.string(), McpToolPolicySchema).optional(),
  })
  .passthrough();

export const StdioMcpServerConfigSchema = BaseMcpServerConfigSchema.extend({
  command: z.string().min(1),
  args: z.array(z.string()).optional(),
  env: z.record(z.string(), z.string()).optional(),
  env_vars: z
    .array(
      z.union([
        z.string().min(1),
        z
          .object({
            name: z.string().min(1),
            source: z.enum(["local", "remote"]).optional(),
          })
          .passthrough(),
      ]),
    )
    .optional(),
  cwd: z.string().optional(),
  experimental_environment: z.enum(["remote"]).optional(),
});

export const HttpMcpServerConfigSchema = BaseMcpServerConfigSchema.extend({
  url: z.string().url(),
  bearer_token_env_var: z.string().min(1).optional(),
  http_headers: z.record(z.string(), z.string()).optional(),
  env_http_headers: z.record(z.string(), z.string()).optional(),
});

/**
 * MCP server configuration accepted by Codex config.toml. This schema covers
 * both local stdio servers and streamable HTTP servers while preserving
 * unknown future fields.
 */
export const McpServerConfigSchema = z.union([
  StdioMcpServerConfigSchema,
  HttpMcpServerConfigSchema,
]);

export type McpServerConfig = z.infer<typeof McpServerConfigSchema>;

export const McpConfigFileSchema = z
  .object({
    mcp_servers: z.record(z.string(), McpServerConfigSchema).default({}),
  })
  .passthrough();

export type McpConfigFile = z.infer<typeof McpConfigFileSchema>;

const ManifestPathSchema = z.string().regex(/^\.\//, {
  message: "Manifest component paths should be relative to the plugin root and start with './'.",
});

export const PluginSkillReferenceSchema = z.union([
  SkillNameSchema,
  z
    .object({
      name: SkillNameSchema.optional(),
      path: z.string().min(1),
    })
    .passthrough(),
]);

export const PluginSkillsSchema = z
  .union([ManifestPathSchema, z.array(PluginSkillReferenceSchema)])
  .optional();

export const PluginMcpServersSchema = z
  .union([ManifestPathSchema, z.record(z.string(), McpServerConfigSchema)])
  .optional();

export const PluginManifestSchema = z
  .object({
    name: z
      .string()
      .min(1)
      .max(120)
      .regex(/^[a-z0-9@/._-]+$/),
    version: SemverishSchema,
    description: z.string().optional(),
    author: z
      .union([
        z.string().min(1),
        z
          .object({
            name: z.string().min(1),
            email: z.string().email().optional(),
            url: z.string().url().optional(),
          })
          .passthrough(),
      ])
      .optional(),
    homepage: z.string().url().optional(),
    repository: z.string().optional(),
    license: z.string().optional(),
    keywords: z.array(z.string().min(1)).optional(),
    skills: PluginSkillsSchema,
    mcpServers: PluginMcpServersSchema,
    apps: ManifestPathSchema.optional(),
    hooks: z.unknown().optional(),
    interface: z.record(z.string(), z.unknown()).optional(),
    mcp_servers: z.record(z.string(), McpServerConfigSchema).default({}),
  })
  .passthrough();

export type PluginManifest = z.infer<typeof PluginManifestSchema>;

export type ValidationSeverity = "error" | "warning";

export interface ValidationIssue {
  severity: ValidationSeverity;
  code?: string;
  path: string;
  message: string;
  help?: string;
  file?: string;
  line?: number;
}

export interface ValidationResult {
  valid: boolean;
  issues: ValidationIssue[];
}

/**
 * Converts Zod issues into stable, CLI-friendly validation messages.
 *
 * @param error - Zod validation error to convert.
 * @param basePath - Optional prefix such as a filename or registry path.
 * @returns Normalized validation issues.
 */
export function zodErrorToIssues(error: ZodError, basePath = "$"): ValidationIssue[] {
  return error.issues.map((issue) => ({
    severity: "error",
    code: "SCHEMA_VALIDATION_FAILED",
    path: [basePath, ...issue.path.map(String)].filter(Boolean).join("."),
    message: issue.message,
  }));
}

/**
 * Normalizes user-facing skill declarations into the canonical registry
 * schema. This accepts both official SKILL.md field names and the older
 * skillName/triggerType shape that appears in older registry records.
 *
 * @param input - Unknown skill-like record.
 * @param defaults - Registry-controlled fields such as source and filesystem paths.
 * @returns A validated CodexSkill registry entry.
 */
export function normalizeSkillInput(
  input: unknown,
  defaults: Partial<CodexSkill> = {},
): CodexSkill {
  const record = z.record(z.string(), z.unknown()).parse(input);
  // A single-string triggers value is wrapped instead of dropped; any other
  // non-array shape is passed through so validation rejects it loudly.
  const rawTriggers =
    record.triggers ?? (typeof record.triggerType === "string" ? [record.triggerType] : undefined);
  const triggers = typeof rawTriggers === "string" ? [rawTriggers] : rawTriggers;
  const aliased = {
    ...record,
    name: record.name ?? record.skillName,
    triggers,
    entryPoint: record.entryPoint ?? record.entry_point,
  };

  const frontmatter = SkillFrontmatterSchema.parse(aliased);

  return CodexSkillSchema.parse({
    ...defaults,
    name: frontmatter.name,
    description: frontmatter.description,
    version: frontmatter.version ?? defaults.version,
    author: frontmatter.author ?? defaults.author,
    triggers: frontmatter.triggers ?? defaults.triggers,
    entryPoint: frontmatter.entryPoint ?? defaults.entryPoint,
    tags: frontmatter.tags ?? defaults.tags,
    metadata: {
      ...(defaults.metadata ?? {}),
      frontmatter,
    },
  });
}
