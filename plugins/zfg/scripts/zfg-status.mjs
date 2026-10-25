#!/usr/bin/env node
// Zero False Green (ZFG) for Claude — say whether the latest evidence receipt still
// describes the code exactly as it is now.
// Usage: node zfg-status.mjs [--cwd <dir>] [--json]
// Exit codes: 0 CURRENT_GREEN, 1 anything else.

import path from "node:path";
import { fileURLToPath } from "node:url";
import { evidenceState, gitRoot } from "./zfg-lib.mjs";

const MEANING = {
  CURRENT_GREEN: "The latest checks passed on exactly this version of the code.",
  CURRENT_RED: "The latest checks ran on this version of the code and at least one failed.",
  CURRENT_BLOCKED: "The latest run on this version of the code could not prove anything (see reasons).",
  STALE: "The code has changed since the last checks ran. Earlier results no longer count.",
  MISSING: "No checks have been run with ZFG in this project yet.",
  TAMPERED: "The receipt file does not match its own seal. Do not trust it; run the checks again.",
  UNKNOWN: "The current code could not be fingerprinted, so nothing can be confirmed.",
  NO_REPO: "Not inside a git repository, so evidence cannot be bound to an exact version of the code.",
};

export function status(cwd) {
  const root = gitRoot(cwd);
  if (!root) return { state: "NO_REPO", meaning: MEANING.NO_REPO };
  const s = evidenceState(root);
  return {
    state: s.state,
    meaning: MEANING[s.state] || s.state,
    verdict: s.receipt?.verdict ?? null,
    finished_at: s.receipt?.finished_at ?? null,
    reasons: s.receipt?.reasons ?? [],
  };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
  const argv = process.argv.slice(2);
  const i = argv.indexOf("--cwd");
  const result = status(path.resolve(i >= 0 ? argv[i + 1] : process.cwd()));
  if (argv.includes("--json")) process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  else {
    process.stdout.write(`ZFG status: ${result.state}\n${result.meaning}\n`);
    if (result.finished_at) process.stdout.write(`Last run: ${result.finished_at} (verdict ${result.verdict})\n`);
    for (const r of result.reasons) process.stdout.write(`  - ${r}\n`);
  }
  process.exit(result.state === "CURRENT_GREEN" ? 0 : 1);
}
