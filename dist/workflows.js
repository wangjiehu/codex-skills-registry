import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import { normalizeRepoPath, pathExists } from "./utils.js";
const WORKFLOW_EXTENSIONS = new Set([".yml", ".yaml"]);
const RISKY_WRITE_PERMISSIONS = new Set(["actions", "contents", "packages"]);
/**
 * Discovers GitHub Actions workflow files from .github/workflows.
 *
 * @param cwd - Repository root.
 * @returns Workflow entries plus parse diagnostics.
 */
export async function discoverGithubWorkflows(cwd) {
    const workflowsDir = path.join(cwd, ".github", "workflows");
    const result = {
        workflows: [],
        diagnostics: [],
    };
    if (!(await pathExists(workflowsDir))) {
        return result;
    }
    const entries = await readdir(workflowsDir, { withFileTypes: true });
    for (const entry of entries) {
        if (!entry.isFile() || !WORKFLOW_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
            continue;
        }
        const sourcePath = path.join(workflowsDir, entry.name);
        const discovered = await loadGithubWorkflow(sourcePath);
        if (discovered.workflow) {
            result.workflows.push(discovered.workflow);
        }
        result.diagnostics.push(...discovered.diagnostics);
    }
    return result;
}
/**
 * Audits a GitHub Actions workflow for high-signal CI and token risks.
 *
 * @param workflow - Discovered workflow.
 * @param options - Audit strictness and policy options.
 * @returns Audit issues.
 */
export function auditGithubWorkflow(workflow, options = {}) {
    const issues = [];
    const basePath = `workflows.${workflow.name}`;
    const prTriggered = hasWorkflowTrigger(workflow.triggers, "pull_request") ||
        hasWorkflowTrigger(workflow.triggers, "pull_request_target");
    if (workflow.permissions === undefined && workflow.jobs.length === 0) {
        issues.push({
            severity: "warning",
            code: "WORKFLOW_PERMISSIONS_MISSING",
            path: `${basePath}.permissions`,
            file: workflow.sourcePath,
            message: "Workflow does not declare explicit GITHUB_TOKEN permissions.",
            help: "Add top-level or job-level permissions with the least privileges needed.",
        });
    }
    if (workflow.permissions === undefined) {
        for (const job of workflow.jobs) {
            if (job.permissions !== undefined) {
                continue;
            }
            issues.push({
                severity: "warning",
                code: "WORKFLOW_PERMISSIONS_MISSING",
                path: `${basePath}.jobs.${job.id}.permissions`,
                file: workflow.sourcePath,
                line: job.line,
                message: `Workflow job '${job.id}' inherits repository-default GITHUB_TOKEN permissions.`,
                help: "Add least-privilege permissions at the workflow level or explicitly on this job.",
            });
        }
    }
    for (const issue of auditWorkflowPermissions(workflow.permissions, `${basePath}.permissions`, workflow.sourcePath, {
        scope: "workflow",
        prTriggered,
    })) {
        issues.push(issue);
    }
    for (const job of workflow.jobs) {
        for (const issue of auditWorkflowPermissions(job.permissions, `${basePath}.jobs.${job.id}.permissions`, workflow.sourcePath, {
            scope: "job",
            prTriggered,
        }, job.permissionsLine ?? job.line)) {
            issues.push(issue);
        }
    }
    if (hasWorkflowTrigger(workflow.triggers, "pull_request_target")) {
        issues.push({
            severity: options.strict ? "error" : "warning",
            code: "WORKFLOW_PULL_REQUEST_TARGET",
            path: `${basePath}.on.pull_request_target`,
            file: workflow.sourcePath,
            message: "pull_request_target runs with elevated repository context and requires strict input handling.",
            help: "Prefer pull_request, or isolate checkout and untrusted input before granting write permissions.",
        });
    }
    const shouldRequirePinnedActions = options.strict === true || options.policy?.requirePinnedWorkflowActions === true;
    if (shouldRequirePinnedActions) {
        for (const usage of workflow.uses) {
            if (isLocalOrDockerAction(usage.value) || isPinnedActionReference(usage.value)) {
                continue;
            }
            issues.push({
                severity: options.policy?.requirePinnedWorkflowActions ? "error" : "warning",
                code: "WORKFLOW_UNPINNED_ACTION",
                path: usage.path,
                file: workflow.sourcePath,
                line: usage.line,
                message: `Workflow action '${usage.value}' is not pinned to a full commit SHA.`,
                help: "Pin third-party and first-party actions to a 40-character commit SHA for reproducible CI.",
            });
        }
    }
    if (prTriggered && options.strict) {
        for (const run of workflow.runs) {
            if (!/\$\{\{\s*github\.event\.pull_request\./.test(run.value)) {
                continue;
            }
            issues.push({
                severity: "warning",
                code: "WORKFLOW_UNTRUSTED_PR_INPUT",
                path: run.path,
                file: workflow.sourcePath,
                line: run.line,
                message: "Workflow run step interpolates pull request event data into shell script text.",
                help: "Pass PR values through environment variables and quote shell references carefully.",
            });
        }
    }
    for (const run of workflow.runs) {
        if (/\b(curl|wget)\b[\s\S]{0,160}\|\s*(sh|bash|pwsh|powershell)\b/i.test(run.value)) {
            issues.push({
                severity: options.strict ? "error" : "warning",
                code: "WORKFLOW_DOWNLOAD_EXECUTE",
                path: run.path,
                file: workflow.sourcePath,
                line: run.line,
                message: "Workflow downloads and executes script content in a shell pipeline.",
                help: "Vendor the script, verify checksums, or use a pinned action instead of piping to a shell.",
            });
        }
    }
    return issues;
}
async function loadGithubWorkflow(sourcePath) {
    try {
        const content = await readFile(sourcePath, "utf8");
        const parsed = parseYaml(content);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
            return {
                diagnostics: [
                    {
                        severity: "error",
                        code: "WORKFLOW_INVALID",
                        path: sourcePath,
                        file: sourcePath,
                        message: "GitHub Actions workflow must be a YAML object.",
                        help: "Use a workflow object with on and jobs keys.",
                    },
                ],
            };
        }
        const workflow = parseWorkflowRecord(parsed, sourcePath, content);
        return {
            workflow,
            diagnostics: [],
        };
    }
    catch (error) {
        return {
            diagnostics: [
                {
                    severity: "error",
                    code: "WORKFLOW_PARSE_FAILED",
                    path: sourcePath,
                    file: sourcePath,
                    message: error instanceof Error ? error.message : String(error),
                    help: "Fix the GitHub Actions workflow YAML syntax.",
                },
            ],
        };
    }
}
function parseWorkflowRecord(record, sourcePath, content) {
    const lines = content.split(/\r?\n/);
    const jobsRecord = record.jobs && typeof record.jobs === "object" && !Array.isArray(record.jobs)
        ? record.jobs
        : {};
    const jobs = [];
    const uses = [];
    const runs = [];
    let usesIndex = 0;
    let runIndex = 0;
    for (const [jobId, jobValue] of Object.entries(jobsRecord)) {
        const job = jobValue && typeof jobValue === "object" && !Array.isArray(jobValue)
            ? jobValue
            : {};
        const jobLine = findYamlJobLine(lines, jobId);
        jobs.push({
            id: jobId,
            permissions: job.permissions,
            line: jobLine,
            permissionsLine: findNestedYamlKeyLine(lines, jobLine, "permissions"),
        });
        if (typeof job.uses === "string") {
            uses.push({
                value: job.uses,
                path: `workflows.${workflowName(record, sourcePath)}.jobs.${jobId}.uses`,
                jobId,
                line: findNthYamlFieldLine(lines, "uses", usesIndex++),
            });
        }
        const steps = Array.isArray(job.steps) ? job.steps : [];
        for (const [stepIndex, stepValue] of steps.entries()) {
            const step = stepValue && typeof stepValue === "object" && !Array.isArray(stepValue)
                ? stepValue
                : {};
            if (typeof step.uses === "string") {
                uses.push({
                    value: step.uses,
                    path: `workflows.${workflowName(record, sourcePath)}.jobs.${jobId}.steps.${stepIndex}.uses`,
                    jobId,
                    line: findNthYamlFieldLine(lines, "uses", usesIndex++),
                });
            }
            if (typeof step.run === "string") {
                runs.push({
                    value: step.run,
                    path: `workflows.${workflowName(record, sourcePath)}.jobs.${jobId}.steps.${stepIndex}.run`,
                    jobId,
                    line: findNthYamlFieldLine(lines, "run", runIndex++),
                });
            }
        }
    }
    return {
        name: workflowName(record, sourcePath),
        sourcePath,
        triggers: record.on,
        permissions: record.permissions,
        jobs,
        uses,
        runs,
    };
}
function auditWorkflowPermissions(permissions, pathValue, file, context, line) {
    if (permissions === undefined) {
        return [];
    }
    if (permissions === "write-all") {
        return [
            {
                severity: "warning",
                code: "WORKFLOW_BROAD_PERMISSIONS",
                path: pathValue,
                file,
                line,
                message: "Workflow grants write-all GITHUB_TOKEN permissions.",
                help: "Replace write-all with the smallest permission set required by this job.",
            },
        ];
    }
    if (!permissions || typeof permissions !== "object" || Array.isArray(permissions)) {
        return [];
    }
    return Object.entries(permissions)
        .filter(([permission, value]) => {
        if (value !== "write" || !RISKY_WRITE_PERMISSIONS.has(permission)) {
            return false;
        }
        return context.scope === "workflow" || context.prTriggered || permission !== "contents";
    })
        .map(([permission]) => ({
        severity: "warning",
        code: "WORKFLOW_BROAD_PERMISSIONS",
        path: `${pathValue}.${permission}`,
        file,
        line,
        message: `Workflow grants ${permission}: write permission.`,
        help: "Move write permissions to the narrowest job and prefer read-only permissions elsewhere.",
    }));
}
function workflowName(record, sourcePath) {
    return typeof record.name === "string" && record.name.trim()
        ? normalizeWorkflowName(record.name)
        : normalizeWorkflowName(path.basename(sourcePath, path.extname(sourcePath)));
}
function normalizeWorkflowName(value) {
    return normalizeRepoPath(value.trim().replace(/\s+/g, "-").toLowerCase());
}
function hasWorkflowTrigger(triggers, trigger) {
    if (typeof triggers === "string") {
        return triggers === trigger;
    }
    if (Array.isArray(triggers)) {
        return triggers.includes(trigger);
    }
    return Boolean(triggers &&
        typeof triggers === "object" &&
        !Array.isArray(triggers) &&
        Object.hasOwn(triggers, trigger));
}
function isLocalOrDockerAction(value) {
    return value.startsWith("./") || value.startsWith("../") || value.startsWith("docker://");
}
function isPinnedActionReference(value) {
    const atIndex = value.lastIndexOf("@");
    if (atIndex < 0) {
        return false;
    }
    return /^[0-9a-f]{40}$/i.test(value.slice(atIndex + 1));
}
function findYamlKeyLine(lines, key) {
    const pattern = new RegExp(`^\\s*${escapeYamlKey(key)}\\s*:`);
    const index = lines.findIndex((line) => pattern.test(line));
    return index >= 0 ? index + 1 : undefined;
}
/**
 * Finds a job id line inside the jobs: block at the job indent level, so a
 * top-level key or env entry that shares the job id name is never matched.
 */
function findYamlJobLine(lines, jobId) {
    const jobsIndex = lines.findIndex((line) => /^jobs\s*:/.test(line));
    if (jobsIndex < 0) {
        return findYamlKeyLine(lines, jobId);
    }
    const pattern = new RegExp(`^\\s+${escapeYamlKey(jobId)}\\s*:`);
    let jobIndent;
    for (let index = jobsIndex + 1; index < lines.length; index += 1) {
        const line = lines[index] ?? "";
        if (!line.trim() || line.trimStart().startsWith("#")) {
            continue;
        }
        const indent = lineIndent(line);
        if (indent === 0) {
            break;
        }
        jobIndent ??= indent;
        if (indent === jobIndent && pattern.test(line)) {
            return index + 1;
        }
    }
    return undefined;
}
function findNestedYamlKeyLine(lines, startLine, key) {
    if (!startLine) {
        return findYamlKeyLine(lines, key);
    }
    const startIndex = startLine - 1;
    const baseIndent = lineIndent(lines[startIndex] ?? "");
    const pattern = new RegExp(`^\\s*${escapeYamlKey(key)}\\s*:`);
    for (let index = startIndex + 1; index < lines.length; index += 1) {
        const line = lines[index] ?? "";
        if (!line.trim()) {
            continue;
        }
        if (lineIndent(line) <= baseIndent) {
            break;
        }
        if (pattern.test(line)) {
            return index + 1;
        }
    }
    return undefined;
}
function findNthYamlFieldLine(lines, key, occurrence) {
    const pattern = new RegExp(`^\\s*-?\\s*${escapeYamlKey(key)}\\s*:`);
    const blockScalarPattern = /:\s*[|>][+-]?\d*\s*(?:#.*)?$/;
    let seen = 0;
    let scalarIndent;
    for (const [index, line] of lines.entries()) {
        // Lines inside a block scalar (for example a run: | script that itself
        // contains uses: text) must not count as field occurrences.
        if (scalarIndent !== undefined) {
            if (!line.trim()) {
                continue;
            }
            if (lineIndent(line) > scalarIndent) {
                continue;
            }
            scalarIndent = undefined;
        }
        if (pattern.test(line)) {
            if (seen === occurrence) {
                return index + 1;
            }
            seen += 1;
        }
        if (blockScalarPattern.test(line)) {
            scalarIndent = lineIndent(line);
        }
    }
    return undefined;
}
function lineIndent(line) {
    return line.match(/^\s*/)?.[0].length ?? 0;
}
function escapeYamlKey(key) {
    return key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
//# sourceMappingURL=workflows.js.map