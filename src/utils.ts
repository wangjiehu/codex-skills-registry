import { realpathSync } from "node:fs";
import { access, realpath } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { CodexSkill } from "./schema.js";

export async function pathExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function firstExistingPath(candidates: string[]): Promise<string | undefined> {
  for (const candidate of candidates) {
    if (await pathExists(candidate)) {
      return candidate;
    }
  }

  return undefined;
}

export function isSubpath(root: string, candidate: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

export function resolvePathInside(root: string, value: string, label: string): string {
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, value);
  if (!isSubpath(resolvedRoot, resolved)) {
    throw new Error(`${label} must stay inside ${resolvedRoot}.`);
  }

  return resolved;
}

export async function resolveExistingPathInside(
  root: string,
  value: string,
  label: string,
): Promise<string> {
  const resolvedRoot = path.resolve(root);
  const resolved = resolvePathInside(resolvedRoot, value, label);
  const [realRoot, realCandidate] = await Promise.all([realpath(resolvedRoot), realpath(resolved)]);
  if (!isSubpath(realRoot, realCandidate)) {
    throw new Error(`${label} must resolve inside ${resolvedRoot}.`);
  }

  return resolved;
}

export async function isRealSubpath(root: string, candidate: string): Promise<boolean> {
  if (!isSubpath(root, candidate)) {
    return false;
  }

  try {
    const [realRoot, realCandidate] = await Promise.all([realpath(root), realpath(candidate)]);
    return isSubpath(realRoot, realCandidate);
  } catch {
    return false;
  }
}

export function relativePathInside(root: string, candidate: string): string | undefined {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative && !relative.startsWith("..") && !path.isAbsolute(relative)
    ? relative
    : undefined;
}

export function skillLine(skill: CodexSkill, field: string): number | undefined {
  const sourceLines = skill.metadata.sourceLines;
  if (!sourceLines || typeof sourceLines !== "object" || Array.isArray(sourceLines)) {
    return undefined;
  }

  const line = (sourceLines as Record<string, unknown>)[field];
  return typeof line === "number" ? line : undefined;
}

export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function countChar(value: string, target: string): number {
  let count = 0;
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] === target) {
      count += 1;
    }
  }

  return count;
}

export function normalizeRepoPath(filePath: string): string {
  return filePath.replace(/\\/g, "/").replace(/^\.\//, "");
}

/**
 * Reports whether the module at moduleUrl is the entry script of this process.
 * npm bin shims on POSIX invoke the CLI through a symlink, so argv[1] must be
 * resolved to its real path before comparing against the module file.
 */
export function isMainModule(moduleUrl: string, argv1 = process.argv[1]): boolean {
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
  } catch {
    return false;
  }
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function escapeMarkdownText(value: string): string {
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
export function markdownCodeSpan(value: string): string {
  const normalized = value.replace(/\r?\n/g, " ");
  const runs = normalized.match(/`+/g);
  if (!runs) {
    return `\`${normalized}\``;
  }

  const fence = "`".repeat(Math.max(...runs.map((run) => run.length)) + 1);
  return `${fence} ${normalized} ${fence}`;
}

export function stripWindowsDrivePrefix(value: string): string {
  if (
    value.length >= 3 &&
    isAsciiLetter(value[0] ?? "") &&
    value[1] === ":" &&
    (value[2] === "\\" || value[2] === "/")
  ) {
    return value.slice(3);
  }

  return value;
}

export function isAsciiLetter(char: string): boolean {
  const code = char.charCodeAt(0);
  return (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
}
