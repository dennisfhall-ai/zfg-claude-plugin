---
name: verify
description: >
  This skill should be used when the user runs /zfg:verify or asks to "verify this",
  "run ZFG", "prove it works", "run the checks", or "get a ZFG receipt". It runs the
  project's real checks and records a Zero False Green evidence receipt.
metadata:
  version: "0.1.0"
---

# /zfg:verify

1. From the project folder, run:

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/zfg-verify.mjs"
   ```

   > Path note: if `${CLAUDE_PLUGIN_ROOT}` is not set in the shell, the scripts are in the `scripts` folder two levels above this skill's base directory (`<skill base>/../../scripts/`).

   Allow enough time for the full suite; do not interrupt it.

2. Report the verdict exactly as printed, in plain language:
   - **GREEN** — list the checks that passed and state they passed on this exact version of the code.
   - **RED** — name each failing check and quote the few output lines that show why. Offer to fix it.
   - **BLOCKED** — explain the reason given (no checks, timeout, or files changed during the run) and offer the fix, such as creating `.zfg.json`.

3. Do not edit any file during the run. If a fix is needed afterwards, make it, then run this skill again — the earlier receipt no longer counts.

Never change, skip, or delete tests to get a GREEN. Never write to `.zfg/` by hand.
