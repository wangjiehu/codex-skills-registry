import { readFile } from "node:fs/promises";
import path from "node:path";
import { normalizeRepoPath, resolveExistingPathInside } from "./utils.js";
export async function loadChangedFiles(options) {
    if (!options.changedFilesFile) {
        return undefined;
    }
    const filePath = await resolveExistingPathInside(options.cwd ?? process.cwd(), options.changedFilesFile, "changed-files path");
    const content = await readFile(filePath, "utf8");
    const values = content
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0 && !line.startsWith("#"))
        .map(unquoteGitPath)
        .map(normalizeRepoPath);
    return new Set(values);
}
/**
 * Decodes the C-style quoting git applies to paths with special or non-ASCII
 * characters (for example "docs/\303\244.md" from git diff --name-only), so
 * changed-file filtering does not silently drop findings on those files.
 */
function unquoteGitPath(line) {
    if (line.length < 2 || !line.startsWith('"') || !line.endsWith('"')) {
        return line;
    }
    const inner = line.slice(1, -1);
    const bytes = [];
    const simpleEscapes = {
        '"': 0x22,
        "\\": 0x5c,
        a: 0x07,
        b: 0x08,
        f: 0x0c,
        n: 0x0a,
        r: 0x0d,
        t: 0x09,
        v: 0x0b,
    };
    for (let index = 0; index < inner.length; index += 1) {
        const char = inner[index] ?? "";
        if (char !== "\\") {
            bytes.push(...Buffer.from(char, "utf8"));
            continue;
        }
        const next = inner[index + 1];
        if (next === undefined) {
            bytes.push(0x5c);
            continue;
        }
        const octal = inner.slice(index + 1, index + 4).match(/^[0-7]{1,3}/)?.[0];
        if (octal) {
            bytes.push(Number.parseInt(octal, 8) & 0xff);
            index += octal.length;
            continue;
        }
        bytes.push(simpleEscapes[next] ?? next.charCodeAt(0));
        index += 1;
    }
    return Buffer.from(bytes).toString("utf8");
}
export function filterIssuesByChangedFiles(issues, options, changedFiles) {
    if (!changedFiles) {
        return issues;
    }
    return issues.filter((issue) => issueMatchesChangedFiles(issue, options, changedFiles));
}
function issueMatchesChangedFiles(issue, options, changedFiles) {
    if (!issue.file) {
        return true;
    }
    const relative = path.isAbsolute(issue.file)
        ? path.relative(path.resolve(options.cwd ?? process.cwd()), issue.file)
        : issue.file;
    return changedFiles.has(normalizeRepoPath(relative));
}
//# sourceMappingURL=changed-files.js.map