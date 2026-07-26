#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { isMainModule } from "./utils.js";

interface NpmPackEntry {
  filename?: unknown;
}

export function readNpmPackFilename(packJsonPath: string): string {
  const parsed = JSON.parse(readFileSync(packJsonPath, "utf8")) as unknown;
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error("npm pack JSON output is empty.");
  }

  const entry = parsed[0];
  const filename =
    entry && typeof entry === "object" ? (entry as NpmPackEntry).filename : undefined;
  if (typeof filename !== "string" || filename.length === 0) {
    throw new Error("npm pack JSON output does not contain a filename.");
  }

  return filename;
}

if (isMainModule(import.meta.url)) {
  const packJsonPath = process.argv[2] ?? "npm-pack.json";
  try {
    console.log(readNpmPackFilename(packJsonPath));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
