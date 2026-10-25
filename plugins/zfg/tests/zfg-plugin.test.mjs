// Tests for the Zero False Green plugin. Run: node --test plugins/zfg/tests/
// Each test builds a throwaway git project, so nothing touches the real repository.

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { verify, resolveChecks, decideVerdict } from "../scripts/zfg-verify.mjs";
import { status } from "../scripts/zfg-status.mjs";
import { decide } from "../scripts/zfg-stop-hook.mjs";
import { detectCompletionClaim, evidenceState, latestReceiptPath, receiptIntact } from "../scripts/zfg-lib.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const SCRIPTS = path.join(here, "..", "scripts");

function project(files = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "zfg-test-"));
  execFileSync("git", ["init", "-q"], { cwd: dir });
  execFileSync("git", ["config", "user.email", "t@example.com"], { cwd: dir });
  execFileSync("git", ["config", "user.name", "t"], { cwd: dir });
  for (const [rel, body] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), body);
  }
  execFileSync("git", ["add", "-A"], { cwd: dir });
  execFileSync("git", ["commit", "-qm", "init", "--allow-empty"], { cwd: dir });
  return dir;
}

const config = (checks) => JSON.stringify({ checks });
const PASS = 'node -e "process.exit(0)"';
const FAIL = 'node -e "process.exit(3)"';
const CLAIM_MSG = "I fixed the bug and all tests pass.";

// ---------- verdicts ----------

test("GREEN only when every real check passes", () => {
  const dir = project({ ".zfg.json": config([{ name: "a", run: PASS }, { name: "b", run: PASS }]) });
  const r = verify(dir);
  assert.equal(r.verdict, "GREEN");
  assert.equal(r.receipt.checks.length, 2);
  assert.ok(receiptIntact(r.receipt));
});

test("RED when any check fails, and the failing check is named", () => {
  const dir = project({ ".zfg.json": config([{ name: "ok", run: PASS }, { name: "broken", run: FAIL }]) });
  const r = verify(dir);
  assert.equal(r.verdict, "RED");
  assert.match(r.reasons.join(" "), /broken/);
});

test("BLOCKED, never GREEN, when there are no checks at all", () => {
  const dir = project({ "README.md": "hi" });
  assert.equal(verify(dir).verdict, "BLOCKED");
});

test("npm's placeholder test script is not counted as a test", () => {
  const dir = project({ "package.json": JSON.stringify({ scripts: { test: 'echo "Error: no test specified" && exit 1' } }) });
  assert.equal(resolveChecks(dir).checks.length, 0);
  assert.equal(verify(dir).verdict, "BLOCKED");
});

test("broken .zfg.json blocks instead of silently falling back", () => {
  const dir = project({ ".zfg.json": "{not json", "package.json": JSON.stringify({ scripts: { test: PASS } }) });
  const r = verify(dir);
  assert.equal(r.verdict, "BLOCKED");
  assert.match(r.reasons.join(" "), /\.zfg\.json is not valid/);
});

test("BLOCKED when files change while checks run", () => {
  const dir = project({ ".zfg.json": config([{ name: "mutate", run: 'node -e "require(\'fs\').writeFileSync(\'x.txt\',\'changed\')"' }]) });
  const r = verify(dir);
  assert.equal(r.verdict, "BLOCKED");
  assert.match(r.reasons.join(" "), /changed while/);
});

test("BLOCKED when a check times out", () => {
  const dir = project({ ".zfg.json": config([{ name: "slow", run: 'node -e "setTimeout(()=>{},5000)"', timeout_ms: 300 }]) });
  assert.equal(verify(dir).verdict, "BLOCKED");
});

test("decideVerdict cannot return GREEN for an empty run", () => {
  assert.equal(decideVerdict({ checks: [], results: [], fingerprintBefore: "a", fingerprintAfter: "a" }).verdict, "BLOCKED");
});

test("not a git repository: BLOCKED", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "zfg-nogit-"));
  assert.equal(verify(dir).verdict, "BLOCKED");
});

// ---------- freshness and integrity ----------

test("any edit after a GREEN run makes the evidence STALE", () => {
  const dir = project({ ".zfg.json": config([{ name: "a", run: PASS }]), "src.js": "1" });
  verify(dir);
  assert.equal(status(dir).state, "CURRENT_GREEN");
  fs.writeFileSync(path.join(dir, "src.js"), "2");
  assert.equal(status(dir).state, "STALE");
});

test("a new untracked file also makes the evidence STALE", () => {
  const dir = project({ ".zfg.json": config([{ name: "a", run: PASS }]) });
  verify(dir);
  fs.writeFileSync(path.join(dir, "new.js"), "x");
  assert.equal(status(dir).state, "STALE");
});

test("deleting a tracked file makes the evidence STALE", () => {
  const dir = project({ ".zfg.json": config([{ name: "a", run: PASS }]), "gone.js": "x" });
  verify(dir);
  fs.unlinkSync(path.join(dir, "gone.js"));
  assert.equal(status(dir).state, "STALE");
});

test("a new commit makes the evidence STALE", () => {
  const dir = project({ ".zfg.json": config([{ name: "a", run: PASS }]) });
  verify(dir);
  execFileSync("git", ["commit", "-qm", "empty", "--allow-empty"], { cwd: dir });
  assert.equal(status(dir).state, "STALE");
});

test("hand-editing a RED receipt to GREEN is detected as TAMPERED", () => {
  const dir = project({ ".zfg.json": config([{ name: "a", run: FAIL }]) });
  verify(dir);
  const file = latestReceiptPath(dir);
  const receipt = JSON.parse(fs.readFileSync(file, "utf8"));
  receipt.verdict = "GREEN";
  fs.writeFileSync(file, JSON.stringify(receipt));
  assert.equal(evidenceState(dir).state, "TAMPERED");
});

test("receipts never dirty the project (.zfg is self-ignored and excluded)", () => {
  const dir = project({ ".zfg.json": config([{ name: "a", run: PASS }]) });
  verify(dir);
  const porcelain = execFileSync("git", ["status", "--porcelain"], { cwd: dir }).toString().trim();
  assert.equal(porcelain, "");
});

test("receipt files never count as code changes, even if their ignore file is removed", () => {
  const dir = project({ ".zfg.json": config([{ name: "a", run: PASS }]) });
  verify(dir);
  fs.unlinkSync(path.join(dir, ".zfg", ".gitignore"));
  assert.equal(status(dir).state, "CURRENT_GREEN");
});

// ---------- claim detection ----------

test("detects success claims", () => {
  for (const s of [
    "All tests pass.", "All 42 tests are passing now.", "The build is green.", "Everything is working.",
    "This is ready to merge.", "It's production-ready.", "Lint passes and typecheck passes.", "✅ Tests",
  ]) assert.ok(detectCompletionClaim(s), s);
});

test("does not flag honest or qualified statements", () => {
  for (const s of [
    "I haven't run the tests yet.", "This is unverified.", "Tests are not passing yet; one failure remains.",
    "I could not verify the build.", "Next I'll write the migration.", "ZFG verdict: RED.",
    "I can't confirm all tests pass yet.", "I have not verified that the build is green.",
    "Once you run them, all tests pass is what I expect, but this is unverified.",
  ]) assert.equal(detectCompletionClaim(s), null, s);
});

// ---------- the Stop hook ----------

test("hook blocks a success claim when no evidence exists", () => {
  const dir = project({ "a.js": "1" });
  const out = decide({ cwd: dir, last_assistant_message: CLAIM_MSG }, {});
  assert.equal(out.decision, "block");
  assert.match(out.reason, /no ZFG checks/);
});

test("hook blocks a success claim when the latest run was RED", () => {
  const dir = project({ ".zfg.json": config([{ name: "a", run: FAIL }]) });
  verify(dir);
  assert.equal(decide({ cwd: dir, last_assistant_message: CLAIM_MSG }, {}).decision, "block");
});

test("hook blocks when code changed after a GREEN run", () => {
  const dir = project({ ".zfg.json": config([{ name: "a", run: PASS }]), "a.js": "1" });
  verify(dir);
  fs.writeFileSync(path.join(dir, "a.js"), "2");
  assert.match(decide({ cwd: dir, last_assistant_message: CLAIM_MSG }, {}).reason, /changed after/);
});

test("hook allows a success claim backed by a current GREEN receipt", () => {
  const dir = project({ ".zfg.json": config([{ name: "a", run: PASS }]) });
  verify(dir);
  assert.equal(decide({ cwd: dir, last_assistant_message: CLAIM_MSG }, {}), null);
});

test("hook stays quiet when no claim is made", () => {
  const dir = project({ "a.js": "1" });
  assert.equal(decide({ cwd: dir, last_assistant_message: "I updated the parser. Not yet run." }, {}), null);
});

test("hook never loops: second stop in the same turn is allowed", () => {
  const dir = project({ "a.js": "1" });
  assert.equal(decide({ cwd: dir, stop_hook_active: true, last_assistant_message: CLAIM_MSG }, {}), null);
});

test("hook can be turned off per project or by environment", () => {
  const dir = project({ ".zfg.json": JSON.stringify({ hook: "off", checks: [] }) });
  assert.equal(decide({ cwd: dir, last_assistant_message: CLAIM_MSG }, {}), null);
  const dir2 = project({ "a.js": "1" });
  assert.equal(decide({ cwd: dir2, last_assistant_message: CLAIM_MSG }, { ZFG_HOOK: "off" }), null);
});

test("hook reads the claim from the transcript when no message field is given", () => {
  const dir = project({ "a.js": "1" });
  const transcript = path.join(dir, "..", path.basename(dir) + "-t.jsonl");
  fs.writeFileSync(transcript, [
    JSON.stringify({ type: "user", message: { role: "user", content: "fix it" } }),
    JSON.stringify({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text: CLAIM_MSG }] } }),
  ].join("\n"));
  assert.equal(decide({ cwd: dir, transcript_path: transcript }, {}).decision, "block");
});

test("hook process: blocks via stdout JSON and always exits 0", () => {
  const dir = project({ "a.js": "1" });
  const r = spawnSync(process.execPath, [path.join(SCRIPTS, "zfg-stop-hook.mjs")], {
    input: JSON.stringify({ cwd: dir, last_assistant_message: CLAIM_MSG }), encoding: "utf8",
  });
  assert.equal(r.status, 0);
  assert.equal(JSON.parse(r.stdout).decision, "block");
});

test("hook process: malformed input does not trap the session", () => {
  const r = spawnSync(process.execPath, [path.join(SCRIPTS, "zfg-stop-hook.mjs")], { input: "{bad", encoding: "utf8" });
  assert.equal(r.status, 0);
  assert.equal(r.stdout.trim(), "");
});

// ---------- command-line exit codes ----------

test("verify CLI exit codes: 0 GREEN, 1 RED, 2 BLOCKED", () => {
  const run = (dir) => spawnSync(process.execPath, [path.join(SCRIPTS, "zfg-verify.mjs"), "--cwd", dir], { encoding: "utf8" }).status;
  assert.equal(run(project({ ".zfg.json": config([{ name: "a", run: PASS }]) })), 0);
  assert.equal(run(project({ ".zfg.json": config([{ name: "a", run: FAIL }]) })), 1);
  assert.equal(run(project({ "x": "1" })), 2);
});

test("scripts work when installed in a folder whose path contains spaces", () => {
  const spaced = fs.mkdtempSync(path.join(os.tmpdir(), "zfg plugin dir "));
  for (const f of fs.readdirSync(SCRIPTS)) fs.copyFileSync(path.join(SCRIPTS, f), path.join(spaced, f));
  const dir = project({ ".zfg.json": config([{ name: "a", run: PASS }]) });
  const v = spawnSync(process.execPath, [path.join(spaced, "zfg-verify.mjs"), "--cwd", dir], { encoding: "utf8" });
  assert.equal(v.status, 0);
  assert.match(v.stdout, /ZFG verdict: GREEN/);
  const h = spawnSync(process.execPath, [path.join(spaced, "zfg-stop-hook.mjs")], {
    input: JSON.stringify({ cwd: project({ "a.js": "1" }), last_assistant_message: CLAIM_MSG }), encoding: "utf8",
  });
  assert.equal(JSON.parse(h.stdout).decision, "block");
});

test("plugin ships under the ZFG Community License, not MIT, and keeps the v0.1.0 MIT carve-out", () => {
  const root = path.join(here, "..");
  const manifest = JSON.parse(fs.readFileSync(path.join(root, ".claude-plugin", "plugin.json"), "utf8"));
  const license = fs.readFileSync(path.join(root, "LICENSE"), "utf8");
  assert.equal(manifest.license, "LicenseRef-ZFG-Community-1.0");
  assert.doesNotMatch(manifest.license, /MIT/i);
  assert.match(license, /^ZERO FALSE GREEN COMMUNITY LICENSE/);
  assert.doesNotMatch(license.slice(0, 80), /MIT/);
  assert.match(license, /version 0\.1\.0 under the MIT License keeps the rights/i);
  assert.match(license, /not retroactive/i);
  assert.match(license, /governed by the laws of the Province of Nova Scotia/);
  const market = JSON.parse(fs.readFileSync(path.join(root, "..", "..", ".claude-plugin", "marketplace.json"), "utf8"));
  assert.equal(market.plugins.find((p) => p.name === "zfg").version, manifest.version);
});
