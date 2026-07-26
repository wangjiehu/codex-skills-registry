import { createHash } from "node:crypto";
import path from "node:path";
import { escapeRegExp, normalizeRepoPath, relativePathInside, stripWindowsDrivePrefix, } from "./utils.js";
export function createIssueBaseline(issues, options = {}) {
    return {
        version: 1,
        generatedAt: new Date().toISOString(),
        issues: issues.map((issue) => ({
            fingerprint: issueFingerprint(issue, options),
            code: issueCode(issue),
            path: issue.path,
            ...(issue.file ? { file: displayIssueFile(issue, options.cwd) } : {}),
            message: issue.message,
        })),
    };
}
export function applyIssuePolicyFilters(issues, options) {
    const baselineFingerprints = new Set(options.baseline?.issues.map((issue) => issue.fingerprint) ?? []);
    const activeIssues = [];
    const suppressedIssues = [];
    const baselineIssues = [];
    for (const issue of issues) {
        if (matchesSuppression(issue, options.policy, options)) {
            suppressedIssues.push(issue);
            continue;
        }
        if (baselineFingerprints.has(issueFingerprint(issue, options)) ||
            baselineFingerprints.has(legacyIssueFingerprint(issue, options))) {
            baselineIssues.push(issue);
            continue;
        }
        activeIssues.push(issue);
    }
    return {
        activeIssues,
        suppressedIssues,
        baselineIssues,
    };
}
export function issueCode(issue) {
    if (issue.code) {
        return issue.code;
    }
    return `REGISTRY_${slugifyIssueCode(issue.path || issue.message || "issue")}`;
}
export function issueFingerprint(issue, options = {}) {
    const parts = [
        issueCode(issue),
        issue.path.replace(/\\/g, "/"),
        displayIssueFile(issue, options.cwd) ?? "",
    ];
    return createHash("sha256").update(parts.join("\n")).digest("hex");
}
function legacyIssueFingerprint(issue, options = {}) {
    const parts = [
        issueCode(issue),
        issue.path.replace(/\\/g, "/"),
        displayIssueFile(issue, options.cwd) ?? "",
        issue.message,
    ];
    return createHash("sha256").update(parts.join("\n")).digest("hex");
}
export function displayIssueFile(issue, cwd) {
    if (!issue.file) {
        return undefined;
    }
    if (cwd && path.isAbsolute(issue.file)) {
        const relative = relativePathInside(path.resolve(cwd), issue.file);
        if (relative) {
            return normalizeRepoPath(relative);
        }
    }
    return normalizeRepoPath(issue.file);
}
function matchesSuppression(issue, policy, options) {
    const suppressions = policy.suppressions ?? [];
    if (suppressions.length === 0) {
        return false;
    }
    return suppressions.some((suppression) => {
        if (suppression.expiresOn && isExpiredDate(suppression.expiresOn, options.today)) {
            return false;
        }
        if (suppression.code && !globMatch(issueCode(issue), suppression.code)) {
            return false;
        }
        if (suppression.path && !globMatch(issue.path.replace(/\\/g, "/"), suppression.path)) {
            return false;
        }
        if (suppression.file) {
            const file = displayIssueFile(issue, options.cwd);
            if (!file || !globMatch(file, normalizeRepoPath(suppression.file))) {
                return false;
            }
        }
        return Boolean(suppression.code || suppression.path || suppression.file);
    });
}
function isExpiredDate(value, today = new Date()) {
    const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) {
        return true;
    }
    const expiry = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 23, 59, 59);
    return expiry < today.getTime();
}
function globMatch(value, pattern) {
    const normalizedValue = value.replace(/\\/g, "/");
    const normalizedPattern = pattern.replace(/\\/g, "/");
    const regex = new RegExp(`^${globPatternToRegexSource(normalizedPattern)}$`);
    return regex.test(normalizedValue);
}
function globPatternToRegexSource(pattern) {
    let source = "";
    for (let index = 0; index < pattern.length; index += 1) {
        const char = pattern[index];
        const next = pattern[index + 1];
        if (char === "*" && next === "*") {
            if (pattern[index + 2] === "/") {
                source += "(?:.*/)?";
                index += 2;
            }
            else {
                source += ".*";
                index += 1;
            }
            continue;
        }
        if (char === "*") {
            source += "[^/]*";
            continue;
        }
        if (char === "?") {
            source += "[^/]";
            continue;
        }
        source += escapeRegExp(char ?? "");
    }
    return source;
}
function slugifyIssueCode(value) {
    const source = stripWindowsDrivePrefix(value);
    const result = [];
    let pendingSeparator = false;
    for (const char of source) {
        if (isAsciiAlphaNumeric(char)) {
            if (pendingSeparator && result.length > 0) {
                result.push("_");
            }
            result.push(char.toUpperCase());
            pendingSeparator = false;
            continue;
        }
        pendingSeparator = result.length > 0;
    }
    return result.join("").slice(0, 80) || "ISSUE";
}
function isAsciiAlphaNumeric(char) {
    const code = char.charCodeAt(0);
    return (code >= 48 && code <= 57) || (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
}
//# sourceMappingURL=issues.js.map