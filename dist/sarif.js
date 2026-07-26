import path from "node:path";
import { relativePathInside, stripWindowsDrivePrefix } from "./utils.js";
/**
 * Converts registry validation and audit issues to a SARIF 2.1.0 log. SARIF
 * output lets GitHub Code Scanning and similar tools ingest registry findings
 * without parsing terminal text.
 *
 * @param issues - Registry issues to convert.
 * @param options - Output options such as repository root path.
 * @returns SARIF log object.
 */
export function createSarifLog(issues, options = {}) {
    const rules = new Map();
    const results = issues.map((issue) => {
        const ruleName = ruleNameForIssue(issue, options.cwd);
        const ruleId = issue.code ?? ruleIdForIssue(ruleName);
        if (!rules.has(ruleId)) {
            rules.set(ruleId, {
                id: ruleId,
                name: ruleName,
                shortDescription: {
                    text: ruleName,
                },
            });
        }
        const file = issueFile(issue);
        return {
            ruleId,
            level: issue.severity === "error" ? "error" : "warning",
            message: {
                text: issue.help ? `${issue.message} ${issue.help}` : issue.message,
            },
            ...(file
                ? {
                    locations: [
                        {
                            physicalLocation: {
                                artifactLocation: {
                                    uri: toSarifUri(file, options.cwd),
                                },
                                region: {
                                    startLine: issueLine(issue),
                                },
                            },
                        },
                    ],
                }
                : {}),
        };
    });
    return {
        version: "2.1.0",
        $schema: "https://json.schemastore.org/sarif-2.1.0.json",
        runs: [
            {
                tool: {
                    driver: {
                        name: "codex-skills-registry",
                        rules: [...rules.values()],
                    },
                },
                results,
            },
        ],
    };
}
function ruleIdForIssue(ruleName) {
    const source = stripWindowsDrivePrefix(ruleName);
    const result = [];
    let pendingSeparator = false;
    for (const char of source) {
        if (isSarifRuleIdCharacter(char)) {
            if (pendingSeparator && result.length > 0) {
                result.push(".");
            }
            if (char !== "." || result.length > 0) {
                result.push(char);
            }
            pendingSeparator = false;
            continue;
        }
        pendingSeparator = result.length > 0;
    }
    while (result.at(-1) === ".") {
        result.pop();
    }
    return result.join("").slice(0, 120) || "registry.issue";
}
function isSarifRuleIdCharacter(char) {
    const code = char.charCodeAt(0);
    return ((code >= 48 && code <= 57) ||
        (code >= 65 && code <= 90) ||
        (code >= 97 && code <= 122) ||
        char === "." ||
        char === "_" ||
        char === "-");
}
function ruleNameForIssue(issue, cwd) {
    if (!issue.file || !cwd || !path.isAbsolute(issue.file)) {
        return issue.path;
    }
    const relativeFile = relativePathInside(path.resolve(cwd), path.resolve(issue.file));
    return relativeFile
        ? issue.path.replace(issue.file, relativeFile.replace(/\\/g, "/"))
        : issue.path;
}
function issueFile(issue) {
    const candidate = issue.file;
    return typeof candidate === "string" ? candidate : undefined;
}
function issueLine(issue) {
    return typeof issue.line === "number" && Number.isInteger(issue.line) && issue.line > 0
        ? issue.line
        : 1;
}
function toSarifUri(filePath, cwd) {
    if (cwd && path.isAbsolute(filePath)) {
        const relative = relativePathInside(path.resolve(cwd), path.resolve(filePath));
        if (relative) {
            return relative.replace(/\\/g, "/");
        }
    }
    return path.normalize(filePath).replace(/\\/g, "/");
}
//# sourceMappingURL=sarif.js.map