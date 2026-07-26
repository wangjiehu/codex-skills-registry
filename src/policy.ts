import { readFile } from "node:fs/promises";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import { zodErrorToIssues, type ValidationIssue } from "./schema.js";
import { firstExistingPath, resolveExistingPathInside, resolvePathInside } from "./utils.js";

export const RegistryPolicyPresetSchema = z.enum([
  "recommended",
  "strict-mcp",
  "plugin-review",
  "strict-supply-chain",
]);
export type RegistryPolicyPreset = z.infer<typeof RegistryPolicyPresetSchema>;

const PolicyExtendsSchema = z
  .union([RegistryPolicyPresetSchema, z.array(RegistryPolicyPresetSchema).min(1)])
  .optional();

const SuppressionSchema = z
  .object({
    code: z.string().min(1).optional(),
    path: z.string().min(1).optional(),
    file: z.string().min(1).optional(),
    reason: z.string().min(8),
    owner: z.string().min(1).optional(),
    expiresOn: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .refine(isRealIsoDate, "expiresOn must be a real calendar date.")
      .optional(),
  })
  .strict()
  .refine((value) => Boolean(value.code || value.path || value.file), {
    message: "Suppression requires at least one of code, path, or file.",
  });

/**
 * Repository policy file for maintainers who want stricter or project-specific
 * registry behavior in CI.
 */
export const RegistryPolicyInputSchema = z
  .object({
    extends: PolicyExtendsSchema,
    requirePinnedMcpPackages: z.boolean().optional(),
    requirePinnedWorkflowActions: z.boolean().optional(),
    allowedSkills: z.array(z.string().min(1)).optional(),
    deniedSkills: z.array(z.string().min(1)).optional(),
    allowedPlugins: z.array(z.string().min(1)).optional(),
    deniedPlugins: z.array(z.string().min(1)).optional(),
    allowedMcpServers: z.array(z.string().min(1)).optional(),
    deniedMcpServers: z.array(z.string().min(1)).optional(),
    allowedMcpCommands: z.array(z.string().min(1)).optional(),
    deniedMcpCommands: z.array(z.string().min(1)).optional(),
    allowedRemoteMcpHosts: z.array(z.string().min(1)).optional(),
    deniedRemoteMcpHosts: z.array(z.string().min(1)).optional(),
    requireExplicitMcpToolPolicy: z.boolean().optional(),
    requirePluginSkillPaths: z.boolean().optional(),
    failOnWarnings: z.boolean().optional(),
    baselineFile: z.string().min(1).optional(),
    suppressions: z.array(SuppressionSchema).optional(),
  })
  .strict();

export const RegistryPolicySchema = RegistryPolicyInputSchema.omit({ extends: true })
  .extend({
    requirePinnedMcpPackages: z.boolean().default(false),
    requirePinnedWorkflowActions: z.boolean().default(false),
    requireExplicitMcpToolPolicy: z.boolean().default(false),
    requirePluginSkillPaths: z.boolean().default(false),
    failOnWarnings: z.boolean().default(false),
    suppressions: z.array(SuppressionSchema).default([]),
  })
  .strict();

export type RegistryPolicyInput = z.infer<typeof RegistryPolicyInputSchema>;
export type RegistryPolicy = z.infer<typeof RegistryPolicySchema>;

export interface LoadedPolicy {
  policy: RegistryPolicy;
  sourcePath?: string;
  diagnostics: ValidationIssue[];
}

export const DEFAULT_POLICY: RegistryPolicy = RegistryPolicySchema.parse({});

export const REGISTRY_POLICY_PRESETS: Record<RegistryPolicyPreset, RegistryPolicyInput> = {
  // Milder presets deliberately omit failOnWarnings: false (the schema default)
  // so combining presets via extends never silently downgrades a stricter one.
  recommended: {
    requirePinnedMcpPackages: true,
    requireExplicitMcpToolPolicy: true,
    requirePluginSkillPaths: true,
  },
  "strict-mcp": {
    requirePinnedMcpPackages: true,
    allowedMcpCommands: ["node", "python", "uvx"],
    requireExplicitMcpToolPolicy: true,
    failOnWarnings: true,
  },
  "plugin-review": {
    requirePluginSkillPaths: true,
    requireExplicitMcpToolPolicy: true,
  },
  "strict-supply-chain": {
    requirePinnedMcpPackages: true,
    requirePinnedWorkflowActions: true,
    requireExplicitMcpToolPolicy: true,
    requirePluginSkillPaths: true,
    failOnWarnings: true,
  },
};

const POLICY_FILENAMES = [
  ".codex-skills-registry.yaml",
  ".codex-skills-registry.yml",
  ".codex-skills-registry.json",
];

/**
 * Loads a project policy file. When no policy is present, the permissive
 * default policy is returned.
 *
 * @param cwd - Project directory.
 * @param policyFile - Optional explicit policy file path.
 * @returns Loaded policy and validation diagnostics.
 */
export async function loadRegistryPolicy(cwd: string, policyFile?: string): Promise<LoadedPolicy> {
  let candidates: string[];
  if (policyFile) {
    try {
      candidates = [resolvePathInside(cwd, policyFile, "policy path")];
    } catch (error) {
      return {
        policy: DEFAULT_POLICY,
        diagnostics: [
          {
            severity: "error",
            path: policyFile,
            message: error instanceof Error ? error.message : String(error),
          },
        ],
      };
    }
  } else {
    candidates = POLICY_FILENAMES.map((filename) => path.join(cwd, filename));
  }
  const sourcePath = await firstExistingPath(candidates);

  if (!sourcePath) {
    if (policyFile) {
      const resolvedPath = path.resolve(cwd, policyFile);
      return {
        policy: DEFAULT_POLICY,
        sourcePath: resolvedPath,
        diagnostics: [
          {
            severity: "error",
            path: resolvedPath,
            message: "Policy file does not exist.",
          },
        ],
      };
    }

    return {
      policy: DEFAULT_POLICY,
      diagnostics: [],
    };
  }

  try {
    if (policyFile) {
      await resolveExistingPathInside(cwd, policyFile, "policy path");
    }
    const content = await readFile(sourcePath, "utf8");
    const parsed = sourcePath.endsWith(".json")
      ? (JSON.parse(content) as unknown)
      : (parseYaml(content) as unknown);
    // An empty or comments-only policy file parses to null; treat it as an
    // empty policy instead of failing schema validation.
    const validation = RegistryPolicyInputSchema.safeParse(parsed ?? {});

    if (!validation.success) {
      return {
        policy: DEFAULT_POLICY,
        sourcePath,
        diagnostics: zodErrorToIssues(validation.error, sourcePath),
      };
    }

    return {
      policy: resolveRegistryPolicy(validation.data),
      sourcePath,
      diagnostics: [],
    };
  } catch (error) {
    return {
      policy: DEFAULT_POLICY,
      sourcePath,
      diagnostics: [
        {
          severity: "error",
          path: sourcePath,
          message: error instanceof Error ? error.message : String(error),
        },
      ],
    };
  }
}

export function resolveRegistryPolicy(input: RegistryPolicyInput = {}): RegistryPolicy {
  const presetNames = normalizePolicyExtends(input.extends);
  const presetPolicy: RegistryPolicyInput = {};
  for (const presetName of presetNames) {
    Object.assign(presetPolicy, REGISTRY_POLICY_PRESETS[presetName]);
  }
  const { extends: _extends, ...overrides } = input;

  return RegistryPolicySchema.parse({
    ...presetPolicy,
    ...removeUndefinedValues(overrides),
  });
}

export function formatRegistryPolicyYaml(policy: RegistryPolicyInput): string {
  const lines: string[] = [];

  if (policy.extends) {
    const presetNames = normalizePolicyExtends(policy.extends);
    lines.push("extends:");
    for (const presetName of presetNames) {
      lines.push(`  - ${presetName}`);
    }
  }

  appendBooleanPolicyLine(lines, "requirePinnedMcpPackages", policy.requirePinnedMcpPackages);
  appendBooleanPolicyLine(
    lines,
    "requirePinnedWorkflowActions",
    policy.requirePinnedWorkflowActions,
  );
  appendStringListPolicyLines(lines, "allowedSkills", policy.allowedSkills);
  appendStringListPolicyLines(lines, "deniedSkills", policy.deniedSkills);
  appendStringListPolicyLines(lines, "allowedPlugins", policy.allowedPlugins);
  appendStringListPolicyLines(lines, "deniedPlugins", policy.deniedPlugins);
  appendStringListPolicyLines(lines, "allowedMcpServers", policy.allowedMcpServers);
  appendStringListPolicyLines(lines, "deniedMcpServers", policy.deniedMcpServers);
  appendStringListPolicyLines(lines, "allowedMcpCommands", policy.allowedMcpCommands);
  appendStringListPolicyLines(lines, "deniedMcpCommands", policy.deniedMcpCommands);
  appendStringListPolicyLines(lines, "allowedRemoteMcpHosts", policy.allowedRemoteMcpHosts);
  appendStringListPolicyLines(lines, "deniedRemoteMcpHosts", policy.deniedRemoteMcpHosts);
  appendBooleanPolicyLine(
    lines,
    "requireExplicitMcpToolPolicy",
    policy.requireExplicitMcpToolPolicy,
  );
  appendBooleanPolicyLine(lines, "requirePluginSkillPaths", policy.requirePluginSkillPaths);
  appendBooleanPolicyLine(lines, "failOnWarnings", policy.failOnWarnings);
  if (policy.baselineFile) {
    lines.push(`baselineFile: ${JSON.stringify(policy.baselineFile)}`);
  }
  if (policy.suppressions && policy.suppressions.length > 0) {
    lines.push("suppressions:");
    for (const suppression of policy.suppressions) {
      const entries = [
        ["code", suppression.code],
        ["path", suppression.path],
        ["file", suppression.file],
        ["reason", suppression.reason],
        ["owner", suppression.owner],
        ["expiresOn", suppression.expiresOn],
      ].filter((entry): entry is [string, string] => typeof entry[1] === "string");

      const [first, ...rest] = entries;
      if (!first) {
        continue;
      }

      lines.push(`  - ${first[0]}: ${JSON.stringify(first[1])}`);
      for (const [key, value] of rest) {
        appendOptionalNestedLine(lines, key, value);
      }
    }
  }

  return `${lines.join("\n")}\n`;
}

function normalizePolicyExtends(value: RegistryPolicyInput["extends"]): RegistryPolicyPreset[] {
  if (!value) {
    return [];
  }

  return Array.isArray(value) ? value : [value];
}

function removeUndefinedValues<T extends Record<string, unknown>>(value: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(value).filter(([, nestedValue]) => nestedValue !== undefined),
  ) as Partial<T>;
}

function isRealIsoDate(value: string): boolean {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    return false;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));

  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

function appendBooleanPolicyLine(lines: string[], key: string, value: boolean | undefined): void {
  if (typeof value === "boolean") {
    lines.push(`${key}: ${value}`);
  }
}

function appendStringListPolicyLines(
  lines: string[],
  key: string,
  value: string[] | undefined,
): void {
  if (!value) {
    return;
  }

  lines.push(`${key}:`);
  for (const item of value) {
    lines.push(`  - ${JSON.stringify(item)}`);
  }
}

function appendOptionalNestedLine(lines: string[], key: string, value: string | undefined): void {
  if (value) {
    lines.push(`    ${key}: ${JSON.stringify(value)}`);
  }
}
