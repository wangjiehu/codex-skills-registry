import type { CodexSkill } from "./schema.js";
export declare function pathExists(filePath: string): Promise<boolean>;
export declare function firstExistingPath(candidates: string[]): Promise<string | undefined>;
export declare function isSubpath(root: string, candidate: string): boolean;
export declare function resolvePathInside(root: string, value: string, label: string): string;
export declare function resolveExistingPathInside(root: string, value: string, label: string): Promise<string>;
export declare function isRealSubpath(root: string, candidate: string): Promise<boolean>;
export declare function relativePathInside(root: string, candidate: string): string | undefined;
export declare function skillLine(skill: CodexSkill, field: string): number | undefined;
export declare function escapeRegExp(value: string): string;
export declare function countChar(value: string, target: string): number;
export declare function normalizeRepoPath(filePath: string): string;
/**
 * Reports whether the module at moduleUrl is the entry script of this process.
 * npm bin shims on POSIX invoke the CLI through a symlink, so argv[1] must be
 * resolved to its real path before comparing against the module file.
 */
export declare function isMainModule(moduleUrl: string, argv1?: string | undefined): boolean;
export declare function escapeHtml(value: string): string;
export declare function escapeMarkdownText(value: string): string;
/**
 * Wraps a value in a Markdown code span. The delimiter must be longer than the
 * longest backtick run inside the value, otherwise the span closes early and
 * the remainder leaks as raw markdown.
 */
export declare function markdownCodeSpan(value: string): string;
export declare function stripWindowsDrivePrefix(value: string): string;
export declare function isAsciiLetter(char: string): boolean;
