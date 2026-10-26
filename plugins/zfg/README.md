<p align="center"><img src="assets/zfg-logo.png" alt="Zero False Green" width="420"></p>

# Zero False Green (ZFG) for Claude

**No green without proof.** AI coding assistants often report "done", "all tests pass" or "ready to merge" when the work has not actually been checked. ZFG stops that.

With ZFG installed, Claude may only say work is passing, verified or ready when a fresh evidence receipt proves it, for the exact code on disk right now.

## Install

```text
/plugin marketplace add dennisfhall-ai/zfg-claude-plugin
/plugin install zfg@dfh
```

Requires Node.js 18 or later and a git repository. The free plugin needs no account, key or network access: everything runs on your machine.

## What you get

| Piece | What it does |
|---|---|
| **Zero False Green skill** | Teaches Claude the rule: no success claim without current evidence, exact claim wording, and never weakening tests to get a pass. |
| **/zfg:verify** | Runs your project's real checks (tests, lint, typecheck, build), fingerprints every file, and writes a sealed receipt to `.zfg/receipts/`. |
| **/zfg:status** | Says whether the last receipt still matches the code: `CURRENT_GREEN`, `STALE`, `CURRENT_RED`, `MISSING` or `TAMPERED`. |
| **End-of-turn guard** | If Claude's reply claims success without a current GREEN receipt, Claude is sent back once to run the checks or restate the claim as unverified. |

## Verdicts

- **GREEN** — at least one real check ran, every check passed, and no file changed during the run.
- **RED** — a check failed. The receipt names it and keeps the last lines of its output.
- **BLOCKED** — nothing was proven: no checks found, a check timed out, the config is broken, or files changed mid-run.

Any edit, new file, deleted file or new commit after a run makes the receipt **STALE**.

## Choosing the checks

ZFG detects common setups (`npm`/`pnpm`/`yarn` scripts `test`, `lint`, `typecheck`, `build`; `pytest`; `cargo test`; `go test`). npm's default placeholder test script is ignored, not counted as a pass. To choose exactly what runs, add `.zfg.json` at the project root:

```json
{
  "checks": [
    { "name": "test", "run": "npm test" },
    { "name": "e2e", "run": "npx playwright test", "timeout_ms": 1200000 }
  ]
}
```

To turn the end-of-turn guard off for a project, add `"hook": "off"` to `.zfg.json`, or set `ZFG_HOOK=off`.

## ZFG Pro (optional, paid)

Set a `ZFG_API_KEY` from [zerofalsegreen.com](https://zerofalsegreen.com) and every `/zfg:verify` run also sends its receipt to ZFG to be signed. You get a public verification link for each receipt and, on Team and Business, a GitHub merge gate that blocks merging without a signed GREEN for that exact commit. If signing fails (offline, plan ended), the local verdict is unchanged. Without a key, the plugin never contacts any server.

## What ZFG does not claim

- A receipt is **local, self-run evidence**: your checks passed on this code, on this machine. It is not independent certification, a security audit, or release approval.
- The seal detects accidental or casual edits to a receipt. It is not a cryptographic signature and does not stop someone deliberately forging one.
- ZFG is only as strong as your checks. If the tests don't cover something, a GREEN says nothing about it.

Independent, signed release authority is the job of the full ZFG platform from DFH Software and Development Company.

## Safety note

`/zfg:verify` runs the commands listed in `.zfg.json` or your package scripts — the same commands `npm test` would run. Only verify projects you trust, just as you would before running their tests.

## Privacy

ZFG reads files in your repository to fingerprint them and stores receipts in `.zfg/` inside the project (ignored by git automatically).

- **Free use (no `ZFG_API_KEY`):** nothing leaves your machine. The plugin makes no network requests.
- **With `ZFG_API_KEY` set (ZFG Pro):** each verify run sends the receipt over HTTPS to ZFG's signing service (`https://base44.app/api/apps/6aa369c28300b99353dcdc0f/functions`, or `ZFG_API_URL` if you set it). The receipt contains file fingerprints (SHA-256 hashes, not file contents), check names, commands, exit codes and durations, the verdict, project name and git commit, the last lines of each check's output (used to confirm the seal, then discarded by the server), and in CI the repository, ref and run id. Your source code is never sent. See the [Privacy Policy](https://zerofalsegreen.com/privacy).

## License

Free to use under the **ZFG Community License 1.0** (see `LICENSE`): install and run ZFG on your own machines and CI, for personal or commercial work, at no cost. Redistribution, modified versions, competing products and hosted resale are not permitted without written permission from DFH Software and Development Company.

Version 0.1.0 was released under the MIT License; copies of 0.1.0 received under MIT keep those rights. Version 0.2.0 and later are covered by the ZFG Community License.

Signed receipts, public verification, merge gates and team features are paid ZFG services (https://zerofalsegreen.com). "Zero False Green", "ZFG" and the ZFG logo are trademarks of DFH Software and Development Company.
