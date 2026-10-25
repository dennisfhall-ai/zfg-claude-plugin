// Zero False Green (ZFG) for Claude — shared library.
// No dependencies beyond Node 18+. Every function fails closed: when something
// cannot be established, the answer is "not proven", never "green".

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const TOOL_VERSION = "0.1.0";
export const RECEIPT_SCHEMA = "dfh.zfg.local-receipt.v1";
export const ZFG_DIR = ".zfg";
export const VERDICT = Object.freeze({ GREEN: "GREEN", RED: "RED", BLOCKED: "BLOCKED" });

export function sha256(data) {
  return createHash("sha256").update(data).digest("hex");
}

// Deterministic JSON: object keys sorted at every level.
export function canonicalJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(canonicalJson).join(",") + "]";
  const keys = Object.keys(value).filter((k) => value[k] !== undefined).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + canonicalJson(value[k])).join(",") + "}";
}

function git(cwd, args) {
  return execFileSync("git", args, { cwd, encoding: "buffer", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 256 * 1024 * 1024 });
}

export function gitRoot(cwd) {
  try {
    return git(cwd, ["rev-parse", "--show-toplevel"]).toString("utf8").trim() || null;
  } catch {
    return null;
  }
}

export function gitHead(root) {
  try {
    return git(root, ["rev-parse", "HEAD"]).toString("utf8").trim();
  } catch {
    return null; // repository with no commits yet
  }
}

// Fingerprint of the working tree as it actually is on disk: every tracked file
// plus every untracked, non-ignored file, path + content. The .zfg folder is excluded
// so writing a receipt never changes the fingerprint it records.
export function treeFingerprint(root) {
  const listing = git(root, ["ls-files", "-z", "--cached", "--others", "--exclude-standard"]).toString("utf8");
  const files = [...new Set(listing.split("\0").filter(Boolean))]
    .filter((f) => f !== ZFG_DIR && !f.startsWith(ZFG_DIR + "/"))
    .sort();
  const h = createHash("sha256");
  let count = 0;
  for (const rel of files) {
    const abs = path.join(root, rel);
    let content;
    try {
      const st = fs.lstatSync(abs);
      if (st.isSymbolicLink()) content = Buffer.from("symlink:" + fs.readlinkSync(abs));
      else if (st.isFile()) content = fs.readFileSync(abs);
      else continue;
    } catch {
      content = Buffer.from("deleted"); // tracked but removed from disk is a real change
    }
    h.update(rel + "\0" + sha256(content) + "\n");
    count += 1;
  }
  return { fingerprint: h.digest("hex"), file_count: count };
}

export function receiptBody(receipt) {
  const { receipt_sha256: _omit, ...body } = receipt;
  return body;
}

export function sealReceipt(body) {
  return { ...body, receipt_sha256: sha256(canonicalJson(body)) };
}

export function receiptIntact(receipt) {
  if (!receipt || typeof receipt !== "object" || typeof receipt.receipt_sha256 !== "string") return false;
  return sha256(canonicalJson(receiptBody(receipt))) === receipt.receipt_sha256;
}

export function latestReceiptPath(root) {
  return path.join(root, ZFG_DIR, "receipts", "latest.json");
}

export function readLatestReceipt(root) {
  try {
    return JSON.parse(fs.readFileSync(latestReceiptPath(root), "utf8"));
  } catch {
    return null;
  }
}

// States: CURRENT_GREEN is the only state that supports a claim of passing/done.
export function evidenceState(root) {
  const receipt = readLatestReceipt(root);
  if (!receipt) return { state: "MISSING", receipt: null };
  if (receipt.schema !== RECEIPT_SCHEMA || !receiptIntact(receipt)) return { state: "TAMPERED", receipt };
  let current;
  try {
    current = treeFingerprint(root);
  } catch {
    return { state: "UNKNOWN", receipt };
  }
  if (receipt.fingerprint !== current.fingerprint || receipt.git_head !== gitHead(root)) {
    return { state: "STALE", receipt, current };
  }
  if (receipt.verdict === VERDICT.GREEN) return { state: "CURRENT_GREEN", receipt, current };
  return { state: "CURRENT_" + receipt.verdict, receipt, current };
}

// ---- Claim detection used by the Stop hook ------------------------------------
// Deliberately narrow: it looks for statements that the work is verified, passing,
// or ready. It does not try to judge ordinary progress updates.
const CLAIM_PATTERNS = [
  /\ball (?:the )?(?:\d+ )?(?:unit |integration |e2e )?tests? (?:are |now |have )?(?:pass(?:ed|ing|es)?|green|succeed(?:ed|s)?)\b/i,
  /\btests? (?:are |now )?(?:all )?(?:pass(?:ing)?|green)\b/i,
  /\b(?:build|lint|typecheck|type-check|ci|checks?) (?:is |are |now )?(?:pass(?:es|ed|ing)?|green|succeed(?:s|ed)?|clean)\b/i,
  /\beverything (?:is |now )?(?:works?|working|passing|green)\b/i,
  /\b(?:fully|all) (?:working|verified|tested)\b/i,
  /\b(?:ready|safe) (?:to|for) (?:merge|ship|deploy|release|production)\b/i,
  /\bproduction[- ]ready\b/i,
  /\b(?:verified|confirmed) (?:that )?(?:it|this|the (?:fix|change|build|feature)) works\b/i,
  /✅\s*(?:all )?(?:tests?|build|checks?)/i,
];

// Phrases that show the claim is being withheld or qualified, e.g. "not yet verified".
const QUALIFIER_PATTERNS = [
  /\b(?:not|never|unable to|couldn['’]?t|could not|cannot|can['’]?t|haven['’]?t|have not|did not|didn['’]?t)\b[^.\n]{0,40}\b(?:verif|test|run|pass|confirm)/i,
  /\bunverified\b/i,
  /\bzfg (?:verdict|receipt)[: ]+(?:red|blocked)\b/i,
];

export function detectCompletionClaim(text) {
  if (typeof text !== "string" || !text.trim()) return null;
  const sentences = text.split(/(?<=[.!?\n])\s+/);
  for (const sentence of sentences) {
    for (const re of CLAIM_PATTERNS) {
      const m = re.exec(sentence);
      if (m && !QUALIFIER_PATTERNS.some((q) => q.test(sentence))) return m[0];
    }
  }
  return null;
}

// Reads the last assistant text from a Claude Code transcript (JSON Lines).
export function lastAssistantText(transcriptPath) {
  let raw;
  try {
    raw = fs.readFileSync(transcriptPath, "utf8");
  } catch {
    return "";
  }
  const lines = raw.split("\n").filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    let entry;
    try {
      entry = JSON.parse(lines[i]);
    } catch {
      continue;
    }
    const msg = entry.message || entry;
    const role = entry.type === "assistant" ? "assistant" : msg.role;
    if (role !== "assistant") continue;
    const content = msg.content;
    if (typeof content === "string") return content;
    if (Array.isArray(content)) {
      const text = content.filter((c) => c && c.type === "text").map((c) => c.text).join("\n");
      if (text.trim()) return text;
    }
  }
  return "";
}
