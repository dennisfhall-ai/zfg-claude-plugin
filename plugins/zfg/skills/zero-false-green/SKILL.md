---
name: zero-false-green
description: >
  This skill should be used whenever Claude is about to report that code work is
  "done", "fixed", "working", "passing", "verified", "green", or "ready to merge /
  ship / deploy", or when the user asks "does it work?", "did the tests pass?",
  "is this ready?", or "prove it". It sets the Zero False Green rule: no success
  claim without fresh evidence for the exact code on disk.
metadata:
  version: "0.1.0"
---

# Zero False Green

A green signal is a promise that the work is proven. Never give one that has not been earned.

## The rule

Only state that code is passing, verified, working, or ready when **all** of these hold:

1. The project's real checks ran (tests, and lint / typecheck / build where they exist).
2. Every check exited successfully.
3. The checks ran on exactly the code that is on disk now — no edits since.
4. The evidence is in a ZFG receipt, not in memory of an earlier run.

If any of these is missing, the honest status is **not proven**, whatever the code looks like.

## How to earn a green

Run the verifier from the project folder:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/zfg-verify.mjs"
```

> Path note: if `${CLAUDE_PLUGIN_ROOT}` is not set in the shell, the scripts are in the `scripts` folder two levels above this skill's base directory (`<skill base>/../../scripts/`).

It runs the checks, fingerprints every file, and writes `.zfg/receipts/latest.json`. Report its verdict as given:

- **GREEN** — say what ran and that it passed on this exact version.
- **RED** — name the failing check and show the relevant lines from its output. Do not call it "mostly working".
- **BLOCKED** — say plainly that nothing was proven and why (no checks found, timeout, files changed mid-run).

To check whether an earlier result still applies, run `node "${CLAUDE_PLUGIN_ROOT}/scripts/zfg-status.mjs"`. Any edit after a run makes it **STALE**.

## Claim language

Use exact, evidence-bound wording.

| Situation | Say |
|---|---|
| Fresh GREEN receipt | "All 4 checks passed on this exact version (ZFG GREEN)." |
| Changed code since the run | "I changed X after the last run; this version is not yet verified." |
| No tests exist | "There are no automated checks here, so this is unverified. I can add a test that proves X." |
| Manually reasoned only | "I expect this works because …, but it has not been run." |

Avoid "should work", "looks good", "done ✅", or "ready to ship" unless a current GREEN receipt backs it.

## Never do these

- Never edit, copy, or hand-write anything in `.zfg/`. Receipts are produced only by the verifier.
- Never weaken, skip, or delete a check, test, or assertion to turn RED into GREEN. If a test is truly wrong, say so, explain why, and ask before changing it.
- Never count a run from before your last edit.
- Never describe a GREEN receipt as independent certification or release approval. It is local evidence that the listed checks passed on this code — nothing more.

## When no checks are found

If the verifier reports BLOCKED because no checks exist, offer to create `.zfg.json` at the project root listing the commands that prove the project works:

```json
{
  "checks": [
    { "name": "test", "run": "npm test" },
    { "name": "build", "run": "npm run build", "timeout_ms": 600000 }
  ]
}
```

Only list commands that already exist and genuinely test the work. A placeholder like `echo ok` is a false green and must not be used.

## The end-of-turn check

This plugin installs a Stop hook. If a reply claims success without a current GREEN receipt, the hook sends Claude back once to either run the verifier or restate the claim as unverified. Treat that as a correction, not an obstacle — do the honest thing it asks.
