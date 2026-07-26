import { realpathSync } from "node:fs";
import { access, realpath } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
export async function pathExists(filePath) {
    try {
        await access(filePath);
        return true;
    }
    catch {
        return false;
    }
}
export async function firstExistingPath(candidates) {
    for (const candidate of candidates) {
        if (await pathExists(candidate)) {
            return candidate;
        }
    }
    return undefined;
}
export function isSubpath(root, candidate) {
    const relative = path.relative(path.resolve(root), path.resolve(candidate));
    return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}
export function resolvePathInside(root, value, label) {
    const resolvedRoot = path.resolve(root);
    const resolved = path.resolve(resolvedRoot, value);
    if (!isSubpath(resolvedRoot, resolved)) {
        throw new Error(`${label} must stay inside ${resolvedRoot}.`);
    }
    return resolved;
}
export async function resolveExistingPathInside(root, value, label) {
    const resolvedRoot = path.resolve(root);
    const resolved = resolvePathInside(resolvedRoot, value, label);
    const [realRoot, realCandidate] = await Promise.all([realpath(resolvedRoot), realpath(resolved)]);
    if (!isSubpath(realRoot, realCandidate)) {
        throw new Error(`${label} must resolve inside ${resolvedRoot}.`);
    }
    return resolved;
}
export async function isRealSubpath(root, candidate) {
    if (!isSubpath(root, candidate)) {
        return false;
    }
    try {
        const [realRoot, realCandidate] = await Promise.all([realpath(root), realpath(candidate)]);
        return isSubpath(realRoot, realCandidate);
    }
    catch {
        return false;
    }
}
export function relativePathInside(root, candidate) {
    const relative = path.relative(path.resolve(root), path.resolve(candidate));
    return relative && !relative.startsWith("..") && !path.isAbsolute(relative)
        ? relative
        : undefined;
}
export function skillLine(skill, field) {
    const sourceLines = skill.metadata.sourceLines;
    if (!sourceLines || typeof sourceLines !== "object" || Array.isArray(sourceLines)) {
        return undefined;
    }
    const line = sourceLines[field];
    return typeof line === "number" ? line : undefined;
}
export function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
export function countChar(value, target) {
    let count = 0;
    for (let index = 0; index < value.length; index += 1) {
        if (value[index] === target) {
            count += 1;
        }
    }
    return count;
}
export function normalizeRepoPath(filePath) {
    return filePath.replace(/\\/g, "/").replace(/^\.\//, "");
}
/**
 * Reports whether the module at moduleUrl is the entry script of this process.
 * npm bin shims on POSIX invoke the CLI through a symlink, so argv[1] must be
 * resolved to its real path before comparing against the module file.
 */
export function isMainModule(moduleUrl, argv1 = process.argv[1]) {
    if (!argv1) {
        return false;
    }
    const currentFile = fileURLToPath(moduleUrl);
    const resolvedArgv = path.resolve(argv1);
    if (resolvedArgv === currentFile) {
        return true;
    }
    try {
        return realpathSync(resolvedArgv) === currentFile;
    }
    catch {
        return false;
    }
}
export function escapeHtml(value) {
    return value
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}
export function escapeMarkdownText(value) {
    return value
        .replace(/\r?\n/g, " ")
        .replace(/\\/g, "\\\\")
        .replace(/([*_`[\]()#+!|<>])/g, "\\$1")
        .replace(/@/g, "&#64;");
}
/**
 * Wraps a value in a Markdown code span. The delimiter must be longer than the
 * longest backtick run inside the value, otherwise the span closes early and
 * the remainder leaks as raw markdown.
 */
export function markdownCodeSpan(value) {
    const normalized = value.replace(/\r?\n/g, " ");
    const runs = normalized.match(/`+/g);
    if (!runs) {
        return `\`${normalized}\``;
    }
    const fence = "`".repeat(Math.max(...runs.map((run) => run.length)) + 1);
    return `${fence} ${normalized} ${fence}`;
}
export function stripWindowsDrivePrefix(value) {
    if (value.length >= 3 &&
        isAsciiLetter(value[0] ?? "") &&
        value[1] === ":" &&
        (value[2] === "\\" || value[2] === "/")) {
        return value.slice(3);
    }
    return value;
}
export function isAsciiLetter(char) {
    const code = char.charCodeAt(0);
    return (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
}
//# sourceMappingURL=utils.js.map