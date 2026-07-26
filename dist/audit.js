import path from "node:path";
import { skillLine } from "./utils.js";
import { auditGithubWorkflow } from "./workflows.js";
const SHELL_COMMANDS = new Set(["bash", "cmd", "fish", "pwsh", "powershell", "sh", "zsh"]);
/**
 * Normalizes an MCP command for policy comparison: basename, lowercase, and no
 * Windows executable suffix, so `C:\...\bash.exe` matches `bash` and policy
 * lists written as `node` also cover `node.exe`.
 */
function normalizeCommandName(command) {
    // win32.basename splits on both separators, so Windows-style command paths
    // normalize correctly even when the audit runs on POSIX CI hosts.
    return path.win32
        .basename(command)
        .toLowerCase()
        .replace(/\.(exe|cmd|bat)$/, "");
}
/**
 * Runs registry-level safety checks that complement schema validation. These
 * checks are intentionally conservative and focus on review visibility rather
 * than blocking every possible risk by default.
 *
 * @param input - Registry assets to audit.
 * @param options - Audit strictness options.
 * @returns Audit issues.
 */
export function auditRegistry(input, options = {}) {
    return [
        ...input.skills.flatMap((skill) => auditSkill(skill, options)),
        ...input.mcpServers.flatMap((server) => auditMcpServer(server, options)),
        ...(input.workflows ?? []).flatMap((workflow) => auditGithubWorkflow(workflow, options)),
    ];
}
/**
 * Audits a single Codex Skill entry for path and metadata risks.
 *
 * @param skill - Skill to audit.
 * @param options - Audit strictness options.
 * @returns Audit issues.
 */
export function auditSkill(skill, options = {}) {
    const issues = [];
    const policy = options.policy;
    if (policy?.allowedSkills && !policy.allowedSkills.includes(skill.name)) {
        issues.push({
            severity: "error",
            code: "SKILL_NOT_ALLOWED",
            path: `${skill.name}.name`,
            file: skill.skillFile,
            line: skillLine(skill, "name"),
            message: `Skill '${skill.name}' is not allowed by project policy.`,
            help: "Add the skill name to allowedSkills or remove the skill from this registry.",
        });
    }
    if (policy?.deniedSkills?.includes(skill.name)) {
        issues.push({
            severity: "error",
            code: "SKILL_DENIED",
            path: `${skill.name}.name`,
            file: skill.skillFile,
            line: skillLine(skill, "name"),
            message: `Skill '${skill.name}' is denied by project policy.`,
            help: "Remove the skill or update deniedSkills after maintainer review.",
        });
    }
    if (skill.entryPoint) {
        if (path.isAbsolute(skill.entryPoint)) {
            issues.push({
                severity: "error",
                code: "SKILL_ABSOLUTE_ENTRY_POINT",
                path: `${skill.name}.entryPoint`,
                file: skill.skillFile,
                line: skillLine(skill, "entryPoint"),
                message: "Skill entryPoint must be relative to the skill directory.",
                help: "Use a path such as scripts/run.js that is rooted inside the skill directory.",
            });
        }
        const normalized = path.normalize(skill.entryPoint);
        if (normalized.startsWith("..") || normalized.includes(`${path.sep}..${path.sep}`)) {
            issues.push({
                severity: "error",
                code: "SKILL_ENTRY_POINT_ESCAPE",
                path: `${skill.name}.entryPoint`,
                file: skill.skillFile,
                line: skillLine(skill, "entryPoint"),
                message: "Skill entryPoint must not escape the skill directory.",
                help: "Keep entryPoint inside the skill folder and avoid .. path segments.",
            });
        }
    }
    else if (options.strict) {
        issues.push({
            severity: "warning",
            code: "SKILL_INSTRUCTION_ONLY",
            path: `${skill.name}.entryPoint`,
            file: skill.skillFile,
            line: skillLine(skill, "entryPoint"),
            message: "Instruction-only skill has no entryPoint; document this intentionally.",
            help: "Add an entryPoint or suppress this warning with a documented reason.",
        });
    }
    if (skill.triggers.includes("security") && !skill.tags.includes("security")) {
        issues.push({
            severity: "warning",
            code: "SKILL_SECURITY_TAG_MISSING",
            path: `${skill.name}.tags`,
            file: skill.skillFile,
            line: skillLine(skill, "tags"),
            message: "Security-triggered skills should carry a security tag for review routing.",
            help: "Add the security tag so security workflows can route this skill.",
        });
    }
    return issues;
}
/**
 * Audits a discovered MCP server for approval policy, auth, and command risk.
 *
 * @param server - MCP server entry.
 * @param options - Audit strictness options.
 * @returns Audit issues.
 */
export function auditMcpServer(server, options = {}) {
    const issues = [];
    const config = server.config;
    const basePath = `mcp_servers.${server.name}`;
    const policy = options.policy;
    if (policy?.allowedMcpServers && !policy.allowedMcpServers.includes(server.name)) {
        issues.push({
            severity: "error",
            code: "MCP_SERVER_NOT_ALLOWED",
            path: basePath,
            file: server.sourcePath,
            line: server.line,
            message: `MCP server '${server.name}' is not allowed by project policy.`,
            help: "Add the server name to allowedMcpServers or remove the MCP server config.",
        });
    }
    if (policy?.deniedMcpServers?.includes(server.name)) {
        issues.push({
            severity: "error",
            code: "MCP_SERVER_DENIED",
            path: basePath,
            file: server.sourcePath,
            line: server.line,
            message: `MCP server '${server.name}' is denied by project policy.`,
            help: "Remove this MCP server or update deniedMcpServers after review.",
        });
    }
    if (typeof config.command === "string") {
        const commandName = normalizeCommandName(config.command);
        const args = Array.isArray(config.args) ? config.args.map(String) : [];
        if (policy?.allowedMcpCommands && !policy.allowedMcpCommands.includes(commandName)) {
            issues.push({
                severity: "error",
                code: "MCP_COMMAND_NOT_ALLOWED",
                path: `${basePath}.command`,
                file: server.sourcePath,
                line: server.fieldLines?.command ?? server.line,
                message: `MCP command '${commandName}' is not allowed by project policy.`,
                help: "Use an allowed command wrapper or add this command to allowedMcpCommands after review.",
            });
        }
        if (policy?.deniedMcpCommands?.includes(commandName)) {
            issues.push({
                severity: "error",
                code: "MCP_COMMAND_DENIED",
                path: `${basePath}.command`,
                file: server.sourcePath,
                line: server.fieldLines?.command ?? server.line,
                message: `MCP command '${commandName}' is denied by project policy.`,
                help: "Replace the command or remove it from deniedMcpCommands only after review.",
            });
        }
        if (SHELL_COMMANDS.has(commandName)) {
            issues.push({
                severity: options.strict ? "error" : "warning",
                code: "MCP_SHELL_COMMAND",
                path: `${basePath}.command`,
                file: server.sourcePath,
                line: server.fieldLines?.command ?? server.line,
                message: "Shell-based MCP commands require careful review because arguments may execute arbitrary code.",
                help: "Use a direct executable command when possible and restrict enabled_tools.",
            });
        }
        if (commandName === "npx" && !args.some((arg) => /@[0-9]+\.[0-9]+\.[0-9]+/.test(arg))) {
            issues.push({
                severity: policy?.requirePinnedMcpPackages ? "error" : "warning",
                code: "MCP_UNPINNED_NPX",
                path: `${basePath}.args`,
                file: server.sourcePath,
                line: server.fieldLines?.args ?? server.line,
                message: "npx MCP servers should pin package versions for reproducible CI.",
                help: "Pin package arguments with a full version, for example @scope/server@1.2.3.",
            });
        }
    }
    if (typeof config.url === "string") {
        let url;
        try {
            url = new URL(config.url);
        }
        catch {
            issues.push({
                severity: "error",
                code: "MCP_INVALID_REMOTE_URL",
                path: `${basePath}.url`,
                file: server.sourcePath,
                line: server.fieldLines?.url ?? server.line,
                message: "Remote MCP server URL is invalid.",
                help: "Use a valid absolute URL such as https://example.com/mcp.",
            });
        }
        // An invalid URL must not short-circuit the remaining transport-independent
        // checks below, so the URL-specific checks are gated instead of returning.
        if (url) {
            if (policy?.allowedRemoteMcpHosts && !policy.allowedRemoteMcpHosts.includes(url.host)) {
                issues.push({
                    severity: "error",
                    code: "MCP_REMOTE_HOST_NOT_ALLOWED",
                    path: `${basePath}.url`,
                    file: server.sourcePath,
                    line: server.fieldLines?.url ?? server.line,
                    message: `Remote MCP host '${url.host}' is not allowed by project policy.`,
                    help: "Add the host to allowedRemoteMcpHosts or use an approved MCP endpoint.",
                });
            }
            // Deny lists must not fail open when the URL carries a non-default port,
            // so both host (with port) and hostname are compared.
            if (policy?.deniedRemoteMcpHosts?.includes(url.host) ||
                policy?.deniedRemoteMcpHosts?.includes(url.hostname)) {
                issues.push({
                    severity: "error",
                    code: "MCP_REMOTE_HOST_DENIED",
                    path: `${basePath}.url`,
                    file: server.sourcePath,
                    line: server.fieldLines?.url ?? server.line,
                    message: `Remote MCP host '${url.host}' is denied by project policy.`,
                    help: "Use a different MCP endpoint or update deniedRemoteMcpHosts after review.",
                });
            }
            if (url.protocol !== "https:") {
                issues.push({
                    severity: options.strict ? "error" : "warning",
                    code: "MCP_REMOTE_NOT_HTTPS",
                    path: `${basePath}.url`,
                    file: server.sourcePath,
                    line: server.fieldLines?.url ?? server.line,
                    message: "Remote MCP servers should use HTTPS.",
                    help: "Switch the endpoint to HTTPS or document and suppress the exception.",
                });
            }
            if (!config.bearer_token_env_var && options.strict) {
                issues.push({
                    severity: "warning",
                    code: "MCP_REMOTE_AUTH_UNDOCUMENTED",
                    path: `${basePath}.bearer_token_env_var`,
                    file: server.sourcePath,
                    line: server.fieldLines?.bearer_token_env_var ?? server.line,
                    message: "Remote MCP servers without bearer_token_env_var should be explicitly documented.",
                    help: "Set bearer_token_env_var when the endpoint requires auth, or document why it is public.",
                });
            }
            for (const [key, value] of url.searchParams.entries()) {
                if (looksLikeSecretKey(key) || looksLikeSecretLiteral(value)) {
                    issues.push({
                        severity: "warning",
                        code: "MCP_REMOTE_URL_SECRET",
                        path: `${basePath}.url`,
                        file: server.sourcePath,
                        line: server.fieldLines?.url ?? server.line,
                        message: "Remote MCP URL appears to contain a credential in the query string.",
                        help: "Move credentials to bearer_token_env_var or env_http_headers instead of committing URL secrets.",
                    });
                    break;
                }
            }
        }
    }
    if (!config.enabled_tools && !config.disabled_tools) {
        issues.push({
            severity: policy?.requireExplicitMcpToolPolicy ? "error" : "warning",
            code: "MCP_TOOL_POLICY_MISSING",
            path: `${basePath}.enabled_tools`,
            file: server.sourcePath,
            line: server.fieldLines?.enabled_tools ?? server.fieldLines?.disabled_tools ?? server.line,
            message: "MCP server does not declare enabled_tools or disabled_tools; review tool exposure.",
            help: "Declare enabled_tools for least privilege or disabled_tools for explicit exclusions.",
        });
    }
    if (config.default_tools_approval_mode === "always" ||
        config.default_tools_approval_mode === "never") {
        issues.push({
            severity: options.strict ? "error" : "warning",
            code: "MCP_BROAD_APPROVAL_MODE",
            path: `${basePath}.default_tools_approval_mode`,
            file: server.sourcePath,
            line: server.fieldLines?.default_tools_approval_mode ?? server.line,
            message: "Broad default tool approval policies should be reviewed by a maintainer.",
            help: "Prefer prompt/approve/reject or per-tool approval modes unless the broad mode is intentional.",
        });
    }
    if (config.tools && typeof config.tools === "object" && !Array.isArray(config.tools)) {
        for (const [toolName, toolValue] of Object.entries(config.tools)) {
            const toolPolicy = toolValue && typeof toolValue === "object" && !Array.isArray(toolValue)
                ? toolValue
                : {};
            if (toolPolicy.approval_mode === "always" || toolPolicy.approval_mode === "never") {
                issues.push({
                    severity: options.strict ? "error" : "warning",
                    code: "MCP_BROAD_APPROVAL_MODE",
                    path: `${basePath}.tools.${toolName}.approval_mode`,
                    file: server.sourcePath,
                    line: server.fieldLines?.tools ?? server.line,
                    message: `Broad approval mode for tool '${toolName}' should be reviewed by a maintainer.`,
                    help: "Prefer prompt/approve/reject unless the broad per-tool mode is intentional.",
                });
            }
        }
    }
    if (config.env && typeof config.env === "object" && !Array.isArray(config.env)) {
        for (const [key, value] of Object.entries(config.env)) {
            if (looksLikeSecretKey(key) && typeof value === "string" && looksLikeSecretLiteral(value)) {
                issues.push({
                    severity: "warning",
                    code: "MCP_SECRET_LITERAL",
                    path: `${basePath}.env.${key}`,
                    file: server.sourcePath,
                    line: server.fieldLines?.env ?? server.line,
                    message: "Potential secret literal found in MCP env; prefer env_vars or bearer_token_env_var.",
                    help: "Move secret values to environment variables and reference only variable names in config.",
                });
            }
        }
    }
    for (const headerField of ["http_headers", "env_http_headers"]) {
        const headers = config[headerField];
        if (!headers || typeof headers !== "object" || Array.isArray(headers)) {
            continue;
        }
        for (const [key, value] of Object.entries(headers)) {
            if ((looksLikeSecretKey(key) || key.toLowerCase() === "authorization") &&
                looksLikeSecretLiteral(value) &&
                !looksLikeEnvironmentVariableReference(value)) {
                issues.push({
                    severity: "warning",
                    code: "MCP_SECRET_LITERAL",
                    path: `${basePath}.${headerField}.${key}`,
                    file: server.sourcePath,
                    line: server.fieldLines?.[headerField] ?? server.line,
                    message: "Potential secret literal found in MCP headers; prefer env_http_headers.",
                    help: "Move literal header secrets to env_http_headers so only variable names are committed.",
                });
            }
            if (headerField === "env_http_headers" &&
                typeof value === "string" &&
                !isEnvironmentVariableName(value)) {
                issues.push({
                    severity: "warning",
                    code: "MCP_HEADER_ENV_VAR_INVALID",
                    path: `${basePath}.${headerField}.${key}`,
                    file: server.sourcePath,
                    line: server.fieldLines?.[headerField] ?? server.line,
                    message: "env_http_headers values should be portable environment variable names.",
                    help: "Use names such as MCP_AUTH_HEADER and keep literal header values out of committed config.",
                });
            }
        }
    }
    if (typeof config.bearer_token_env_var === "string") {
        if (looksLikeSecretLiteral(config.bearer_token_env_var) &&
            !looksLikeEnvironmentVariableReference(config.bearer_token_env_var)) {
            issues.push({
                severity: "warning",
                code: "MCP_SECRET_LITERAL",
                path: `${basePath}.bearer_token_env_var`,
                file: server.sourcePath,
                line: server.fieldLines?.bearer_token_env_var ?? server.line,
                message: "bearer_token_env_var should name an environment variable, not contain a token value.",
                help: "Use a variable name such as MCP_TOKEN instead of pasting the token itself.",
            });
        }
        else if (!isEnvironmentVariableName(config.bearer_token_env_var)) {
            issues.push({
                severity: "warning",
                code: "MCP_REMOTE_TOKEN_ENV_VAR_INVALID",
                path: `${basePath}.bearer_token_env_var`,
                file: server.sourcePath,
                line: server.fieldLines?.bearer_token_env_var ?? server.line,
                message: "bearer_token_env_var should be a portable environment variable name.",
                help: "Use uppercase letters, numbers, and underscores, for example MCP_TOKEN.",
            });
        }
    }
    return issues;
}
function looksLikeSecretKey(key) {
    return /(token|secret|api[_-]?key|password|credential|authorization)/i.test(key);
}
function looksLikeSecretLiteral(value) {
    return (typeof value === "string" &&
        value.length >= 16 &&
        !/^[A-Z_][A-Z0-9_]*$/.test(value) &&
        /[A-Za-z]/.test(value) &&
        /[0-9]/.test(value));
}
function isEnvironmentVariableName(value) {
    return /^[A-Z_][A-Z0-9_]*$/.test(value);
}
function looksLikeEnvironmentVariableReference(value) {
    return typeof value === "string" && /^[A-Za-z_][A-Za-z0-9_]*$/.test(value);
}
//# sourceMappingURL=audit.js.map