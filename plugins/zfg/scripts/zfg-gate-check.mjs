#!/usr/bin/env node
// ZFG merge gate, step 2: asks the ZFG service to independently confirm that the
// signed receipt from step 1 is a valid signed GREEN for this exact commit.
// Usage: node zfg-gate-check.mjs --sha <commit> [--cwd <dir>]
// Exit 0 only when the service says pass.

import path from "node:path";
import { fileURLToPath } from "node:url";
import { gitRoot } from "./zfg-lib.mjs";
import { apiBase, readSigned } from "./zfg-pro.mjs";

export async function gateCheck({ cwd, sha, env = process.env, fetchImpl = globalThis.fetch }) {
  const root = gitRoot(cwd);
  if (!root) return { pass: false, code: "NO_REPO" };
  const envelope = readSigned(root);
  if (!envelope) return { pass: false, code: "NO_SIGNED_RECEIPT" };
  try {
    const res = await fetchImpl(`${apiBase(env)}/zfgProVerify`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "merge_gate", envelope, sha }),
    });
    const data = await res.json().catch(() => ({}));
    return { pass: res.ok && data.pass === true, code: String(data.code || `HTTP_${res.status}`) };
  } catch {
    return { pass: false, code: "NETWORK_ERROR" };
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
  const argv = process.argv.slice(2);
  const at = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };
  const result = await gateCheck({ cwd: path.resolve(at("--cwd") || process.cwd()), sha: String(at("--sha") || "") });
  process.stdout.write(`ZFG merge gate: ${result.pass ? "PASS" : "FAIL"} (${result.code})\n`);
  process.exit(result.pass ? 0 : 1);
}
