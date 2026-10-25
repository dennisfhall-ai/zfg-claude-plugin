#!/usr/bin/env node
// Zero False Green (ZFG) for Claude — Stop hook.
// When Claude is about to finish with a claim that work is passing, verified or ready,
// this hook checks for a GREEN evidence receipt that matches the code exactly as it is
// now. If there is none, Claude is sent back to either prove the claim or withdraw it.
//
// Input: hook JSON on stdin. Output: {"decision":"block","reason":...} or nothing.
// Turn off for one project with {"hook": "off"} in .zfg.json, or ZFG_HOOK=off.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { detectCompletionClaim, evidenceState, gitRoot, lastAssistantText } from "./zfg-lib.mjs";

function readStdin() {
  try {
    return fs.readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

export function decide(input, env = process.env) {
  if (String(env.ZFG_HOOK || "").toLowerCase() === "off") return null;
  // Claude has already been sent back once this turn; do not loop forever.
  if (input.stop_hook_active === true) return null;

  const cwd = input.cwd || process.cwd();
  const root = gitRoot(cwd);
  if (!root) return null; // nothing to bind evidence to; ZFG cannot judge here

  try {
    const config = JSON.parse(fs.readFileSync(path.join(root, ".zfg.json"), "utf8"));
    if (config && String(config.hook || "").toLowerCase() === "off") return null;
  } catch { /* no config is the normal case */ }

  const text = typeof input.last_assistant_message === "string" && input.last_assistant_message.trim()
    ? input.last_assistant_message
    : lastAssistantText(input.transcript_path);
  const claim = detectCompletionClaim(text);
  if (!claim) return null;

  const { state } = evidenceState(root);
  if (state === "CURRENT_GREEN") return null;

  const why = {
    MISSING: "no ZFG checks have been run in this project",
    STALE: "the code changed after the last ZFG checks ran",
    TAMPERED: "the latest ZFG receipt does not match its own seal",
    CURRENT_RED: "the latest ZFG checks on this exact code FAILED",
    CURRENT_BLOCKED: "the latest ZFG run on this exact code could not prove anything",
    UNKNOWN: "the current code could not be fingerprinted",
  }[state] || `evidence state is ${state}`;

  return {
    decision: "block",
    reason:
      `Zero False Green: your reply says "${claim}", but ${why}. ` +
      `Before finishing, either (1) run \`node "${path.join(path.dirname(fileURLToPath(import.meta.url)), "zfg-verify.mjs")}"\` ` +
      `and report its verdict honestly, or (2) rewrite the claim as unverified and say what is still unproven. ` +
      `Do not edit .zfg receipts by hand.`,
  };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
  let out = null;
  try {
    const raw = readStdin();
    out = decide(raw.trim() ? JSON.parse(raw) : {});
  } catch (err) {
    // A broken hook must never trap the session. Stay silent, but tell the user.
    process.stderr.write(`ZFG hook could not evaluate this reply: ${err.message}\n`);
  }
  if (out) process.stdout.write(JSON.stringify(out) + "\n");
  process.exit(0);
}
