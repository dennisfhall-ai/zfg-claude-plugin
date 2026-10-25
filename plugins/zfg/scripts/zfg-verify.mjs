#!/usr/bin/env node
// Zero False Green (ZFG) for Claude — run the project's real checks and write an
// evidence receipt. GREEN only when at least one real check ran, every check exited 0,
// and the code did not change while it was being checked.
//
// Usage: node zfg-verify.mjs [--cwd <dir>] [--json]
// Exit codes: 0 GREEN, 1 RED, 2 BLOCKED.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  RECEIPT_SCHEMA, TOOL_VERSION, VERDICT, ZFG_DIR,
  gitHead, gitRoot, sealReceipt, sha256, treeFingerprint,
} from "./zfg-lib.mjs";

const DEFAULT_TIMEOUT_MS = 15 * 60 * 1000;
const TAIL_LINES = 40;
const NPM_PLACEHOLDER_TEST = /no test specified/i;

function argValue(argv, name) {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

// Which checks to run. An explicit .zfg.json always wins over detection.
export function resolveChecks(root) {
  const configFile = path.join(root, ".zfg.json");
  if (fs.existsSync(configFile)) {
    const config = readJson(configFile);
    if (!config || !Array.isArray(config.checks)) {
      return { source: ".zfg.json", checks: [], error: ".zfg.json is not valid JSON with a \"checks\" list" };
    }
    const checks = config.checks
      .filter((c) => c && typeof c.run === "string" && c.run.trim())
      .map((c, i) => ({ name: String(c.name || `check-${i + 1}`), run: c.run.trim(), timeout_ms: Number(c.timeout_ms) > 0 ? Number(c.timeout_ms) : DEFAULT_TIMEOUT_MS }));
    return { source: ".zfg.json", checks };
  }

  const checks = [];
  const pkg = readJson(path.join(root, "package.json"));
  if (pkg && pkg.scripts) {
    const runner = fs.existsSync(path.join(root, "pnpm-lock.yaml")) ? "pnpm"
      : fs.existsSync(path.join(root, "yarn.lock")) ? "yarn" : "npm";
    for (const name of ["test", "lint", "typecheck", "build"]) {
      const script = pkg.scripts[name];
      if (typeof script !== "string" || !script.trim()) continue;
      if (name === "test" && NPM_PLACEHOLDER_TEST.test(script)) continue; // npm's default stub is not a test
      checks.push({ name, run: `${runner} run ${name}`, timeout_ms: DEFAULT_TIMEOUT_MS });
    }
  }
  const has = (f) => fs.existsSync(path.join(root, f));
  if (has("pyproject.toml") || has("pytest.ini") || has("setup.cfg") || has("tox.ini")) {
    if (has("tests") || has("test") || has("pytest.ini")) checks.push({ name: "pytest", run: "python -m pytest -q", timeout_ms: DEFAULT_TIMEOUT_MS });
  }
  if (has("Cargo.toml")) checks.push({ name: "cargo-test", run: "cargo test", timeout_ms: DEFAULT_TIMEOUT_MS });
  if (has("go.mod")) checks.push({ name: "go-test", run: "go test ./...", timeout_ms: DEFAULT_TIMEOUT_MS });
  return { source: "auto-detected", checks };
}

function tail(text, n) {
  const lines = text.split("\n");
  return lines.slice(Math.max(0, lines.length - n)).join("\n");
}

function runCheck(root, check) {
  const started = Date.now();
  const r = spawnSync(check.run, {
    cwd: root, shell: true, encoding: "utf8", timeout: check.timeout_ms,
    maxBuffer: 64 * 1024 * 1024, env: { ...process.env, CI: process.env.CI || "1" },
  });
  const output = `${r.stdout || ""}${r.stderr ? "\n" + r.stderr : ""}`;
  const timedOut = Boolean(r.error && r.error.code === "ETIMEDOUT") || r.signal === "SIGTERM";
  return {
    name: check.name,
    command: check.run,
    exit_code: typeof r.status === "number" ? r.status : null,
    signal: r.signal || null,
    timed_out: timedOut,
    spawn_error: r.error && !timedOut ? String(r.error.code || r.error.message) : null,
    duration_ms: Date.now() - started,
    output_sha256: sha256(output),
    output_tail: tail(output, TAIL_LINES),
  };
}

export function decideVerdict({ checks, results, fingerprintBefore, fingerprintAfter, configError }) {
  const reasons = [];
  if (configError) reasons.push(configError);
  if (!checks.length) reasons.push("No checks found. Add a .zfg.json listing the commands that prove this project works.");
  if (fingerprintBefore !== fingerprintAfter) reasons.push("Files changed while the checks were running, so the results do not describe one exact version of the code.");
  const timedOut = results.filter((r) => r.timed_out);
  for (const r of timedOut) reasons.push(`Check "${r.name}" timed out.`);
  if (reasons.length) return { verdict: VERDICT.BLOCKED, reasons };

  const failed = results.filter((r) => r.exit_code !== 0);
  if (failed.length) {
    return { verdict: VERDICT.RED, reasons: failed.map((r) => `Check "${r.name}" failed (exit ${r.exit_code ?? r.signal ?? r.spawn_error}).`) };
  }
  if (results.length !== checks.length) return { verdict: VERDICT.BLOCKED, reasons: ["Not every configured check produced a result."] };
  return { verdict: VERDICT.GREEN, reasons: [] };
}

export function verify(cwd) {
  const root = gitRoot(cwd);
  if (!root) {
    return { receipt: null, verdict: VERDICT.BLOCKED, reasons: ["Not inside a git repository, so there is no exact version of the code to bind evidence to."] };
  }
  const startedAt = new Date().toISOString();
  const before = treeFingerprint(root);
  const headBefore = gitHead(root);
  const { checks, source, error } = resolveChecks(root);
  const results = [];
  for (const check of checks) results.push(runCheck(root, check));
  const after = treeFingerprint(root);
  const headAfter = gitHead(root);
  const decision = decideVerdict({
    checks, results,
    fingerprintBefore: before.fingerprint + "@" + headBefore,
    fingerprintAfter: after.fingerprint + "@" + headAfter,
    configError: error,
  });

  const receipt = sealReceipt({
    schema: RECEIPT_SCHEMA,
    tool: "zfg-claude-plugin",
    tool_version: TOOL_VERSION,
    project: path.basename(root),
    git_head: headBefore,
    fingerprint: before.fingerprint,
    file_count: before.file_count,
    check_source: source,
    checks: results,
    verdict: decision.verdict,
    reasons: decision.reasons,
    started_at: startedAt,
    finished_at: new Date().toISOString(),
    scope_note: "Local self-run evidence. Not independent certification and not ZFG release authority.",
  });

  const dir = path.join(root, ZFG_DIR, "receipts");
  fs.mkdirSync(dir, { recursive: true });
  const ignoreFile = path.join(root, ZFG_DIR, ".gitignore");
  if (!fs.existsSync(ignoreFile)) fs.writeFileSync(ignoreFile, "*\n");
  const stamp = receipt.finished_at.replace(/[:.]/g, "-");
  const json = JSON.stringify(receipt, null, 2) + "\n";
  fs.writeFileSync(path.join(dir, `${stamp}-${receipt.verdict}.json`), json);
  fs.writeFileSync(path.join(dir, "latest.json"), json);
  return { receipt, verdict: decision.verdict, reasons: decision.reasons };
}

function summary({ receipt, verdict, reasons }) {
  const out = [`ZFG verdict: ${verdict}`];
  if (receipt) {
    out.push(`Code version: ${receipt.git_head ? receipt.git_head.slice(0, 12) : "(no commits)"} + working tree ${receipt.fingerprint.slice(0, 12)} (${receipt.file_count} files)`);
    out.push(`Checks (${receipt.check_source}):`);
    for (const c of receipt.checks) {
      const ok = c.exit_code === 0 && !c.timed_out;
      out.push(`  ${ok ? "PASS" : "FAIL"}  ${c.name}  [${c.command}]  exit=${c.exit_code ?? c.signal ?? c.spawn_error}  ${(c.duration_ms / 1000).toFixed(1)}s`);
    }
    out.push(`Receipt: ${ZFG_DIR}/receipts/latest.json  (sha256 ${receipt.receipt_sha256.slice(0, 16)}…)`);
  }
  for (const r of reasons) out.push(`  - ${r}`);
  return out.join("\n");
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
  const argv = process.argv.slice(2);
  const cwd = path.resolve(argValue(argv, "--cwd") || process.cwd());
  let result;
  try {
    result = verify(cwd);
  } catch (err) {
    result = { receipt: null, verdict: VERDICT.BLOCKED, reasons: [`Verification could not complete: ${err.message}`] };
  }
  process.stdout.write((argv.includes("--json") ? JSON.stringify(result, null, 2) : summary(result)) + "\n");
  process.exit(result.verdict === VERDICT.GREEN ? 0 : result.verdict === VERDICT.RED ? 1 : 2);
}
