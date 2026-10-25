---
name: status
description: >
  This skill should be used when the user runs /zfg:status or asks "is this still
  verified?", "is the last result current?", "what's the ZFG status?", or "has
  anything changed since the tests ran?". It checks whether the latest Zero False
  Green receipt still matches the code on disk.
metadata:
  version: "0.1.0"
---

# /zfg:status

1. From the project folder, run:

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/zfg-status.mjs"
   ```

   > Path note: if `${CLAUDE_PLUGIN_ROOT}` is not set in the shell, the scripts are in the `scripts` folder two levels above this skill's base directory (`<skill base>/../../scripts/`).

2. Report the state in one or two plain sentences:
   - **CURRENT_GREEN** — the last checks passed and the code has not changed since.
   - **STALE** — the code changed after the last run; earlier results no longer count. Offer to run /zfg:verify.
   - **CURRENT_RED / CURRENT_BLOCKED** — the last run on this exact code failed or proved nothing; give the reasons shown.
   - **MISSING** — ZFG has not run here yet. Offer /zfg:verify.
   - **TAMPERED** — the receipt does not match its seal. Say it cannot be trusted and offer a fresh run.

This skill only reads. It never changes code or receipts.
