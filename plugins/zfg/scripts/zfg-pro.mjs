// Zero False Green Pro — optional server signing for receipts.
// Used only when the ZFG_API_KEY environment variable is set. Signing can fail
// (offline, plan ended, server down) without ever changing the local verdict.

import fs from "node:fs";
import path from "node:path";
import { ZFG_DIR } from "./zfg-lib.mjs";

export const DEFAULT_API_BASE = "https://base44.app/api/apps/6aa369c28300b99353dcdc0f/functions";
const KEY_RE = /^zfg_(test|live)_[0-9a-f]{12}_[0-9a-f]{48}$/;
const TIMEOUT_MS = 15000;

export function apiBase(env = process.env) {
  const v = String(env.ZFG_API_URL || "").trim().replace(/\/+$/, "");
  return /^https:\/\//.test(v) ? v : DEFAULT_API_BASE;
}

export function apiKey(env = process.env) {
  const v = String(env.ZFG_API_KEY || "").trim();
  return KEY_RE.test(v) ? v : "";
}

export function signedPath(root) {
  return path.join(root, ZFG_DIR, "receipts", "latest.signed.json");
}

export async function signReceipt(receipt, { env = process.env, context = { source: "local" }, fetchImpl = globalThis.fetch } = {}) {
  const key = apiKey(env);
  if (!key) {
    return { signed: false, code: env.ZFG_API_KEY ? "API_KEY_MALFORMED" : "NO_API_KEY" };
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetchImpl(`${apiBase(env)}/zfgProSign`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify({ receipt, context }),
      signal: ctrl.signal,
    });
    let data = {};
    try { data = await res.json(); } catch { data = {}; }
    if (!res.ok || !data.envelope) {
      return { signed: false, code: String(data.code || `HTTP_${res.status}`), message: String(data.error || "Signing refused.") };
    }
    const s = data.envelope.statement;
    // The server must have signed exactly the receipt we sent.
    if (!s || s.subject?.receipt_sha256 !== receipt.receipt_sha256 || s.subject?.verdict !== receipt.verdict) {
      return { signed: false, code: "SIGNED_SUBJECT_MISMATCH" };
    }
    return { signed: true, envelope: data.envelope, verify_url: data.verify_url || null };
  } catch (err) {
    return { signed: false, code: err?.name === "AbortError" ? "TIMEOUT" : "NETWORK_ERROR" };
  } finally {
    clearTimeout(timer);
  }
}

export function writeSigned(root, envelope) {
  fs.writeFileSync(signedPath(root), JSON.stringify(envelope, null, 2) + "\n");
}

export function readSigned(root) {
  try {
    return JSON.parse(fs.readFileSync(signedPath(root), "utf8"));
  } catch {
    return null;
  }
}
