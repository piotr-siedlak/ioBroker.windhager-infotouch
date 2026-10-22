# Review brief (for the Opus 5.5 review pass)

The first version was produced with Sonnet 5.5 to save tokens. Please review it adversarially. Nothing has run
against real hardware. Start with `RESEARCH.md` (evidence levels), then the code below in this order.

## Deviations and known gaps to check first

1. **Scaffold was hand-built**, not generated: `@iobroker/create-adapter@3.1.5` failed because a registry request
   (`/-/package/.../dist-tags`) timed out from the sandbox. Compare against the official template for anything missing
   (e.g. `.vscode`, `admin/` tsconfig, `release-script`, `.github` auto-merge, `test/mocha.setup`).
2. Adapter renamed to `windhager-infotouch` (0.1.2) so it matches the required repository name `ioBroker.windhager-infotouch`.
3. `@iobroker/repochecker` was **not run** (needs a reachable public repo). Run it once the repo exists.
4. Semantic namespaces from the brief (`boilers.*`, `heatingCircuits.*`, `buffers.*`, `dhw.*`, `system.*`) are **not**
   implemented on purpose (no verified `fctType` meaning for gas). Decide if that is acceptable for a first beta.
5. No Native enum texts / names from `/res/xml` yet.
6. `README`/docs claim counts (65 tests); re-check.

## Highest-risk code (please read line by line)

| File                                                | Why                                                                                                                                                                                                                                                                                   |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/services/CommandService.ts`                    | the only path that writes. Check gating order, value formatting (`toFixed` + trim), read-back tolerance, queue behaviour after a thrown error.                                                                                                                                        |
| `src/main.ts` `onStateChange` / `restoreFromDevice` | user writes arrive here; confirm no write can occur at startup and that failures restore state correctly; `Number(state.val)` for strings.                                                                                                                                            |
| `src/api/HttpClient.ts`                             | Digest nonce reuse and `nc` counter on concurrent requests (requests share a counter - is reuse across sockets safe?), 401 re-challenge handling when the nonce goes stale mid-session, queue/semaphore correctness, shutdown behaviour, response-size cap, redirect handling (none). |
| `src/services/PollingService.ts`                    | overlapping/lost cycles, backoff arithmetic, `online` flag semantics when different categories fail independently, auth-failure stop.                                                                                                                                                 |
| `src/services/StateRegistry.ts`                     | idempotency, stale/revive, `getObjectViewAsync` range query in `main.ts`, performance with thousands of objects (sequential `extendObject`).                                                                                                                                          |
| `src/api/InfoWinRestApi.ts`                         | paging loop (unverified contract), tolerance to odd payloads, `readDatapoint` route.                                                                                                                                                                                                  |
| `src/utils/Validation.ts`                           | fail-safe defaults; host regex; allow-list parsing.                                                                                                                                                                                                                                   |
| `admin/jsonConfig.json`                             | `sendTo` payloads (`jsonData` templating with an empty password / unsaved values), password handling with `encryptedNative` for the test button (does Admin pass the plaintext?).                                                                                                     |

## Questions

- Are the assumptions in `RESEARCH.md` P7 (paging) and P9 (single OID read) acceptable, or should those features be disabled until verified?
- Should group-level polling categories default differently (settings = slow is a heuristic)?
- Is storing the discovery cache as a file in a `meta.user` object the right choice vs. object `native`?
- Is anything in `src/` derived too closely from GPL-3.0 HeatNexus? Compare response-field handling in `parsers.ts`
  against the MIT `windhager-tools` and GPL sources; only wire-format facts should be shared.
- Missing tests you would require before a first real-hardware run.

## Reproduce

```bash
npm ci && npm run check && npm run build
```

---

## Review results (Opus 5.5, 2026-10-22)

Every defect below was first reproduced by a failing test (`test/review-repro.test.ts` and new cases in the existing
suites), then fixed. Suite: 65 -> 73 tests, all passing.

### Fixed

| #   | Severity | Defect                                                                                                                                                                                                          | Fix                                                                                                                                                                 |
| --- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | High     | With the default config (no fast groups) the empty `fast` cycle counted as a success every 30 s, resetting the failure counter: **a controller outage was never reported** and `info.connection` stayed `true`. | Empty categories are not scheduled and never count as success.                                                                                                      |
| 2   | High     | One group answering with a persistent HTTP error failed its whole category on every cycle, so the controller was reported **offline although it was reachable**.                                                | Non-fatal per-group errors are skipped (logged at debug); only connectivity errors, or every group failing, count as a failed cycle. Same for single LON variables. |
| 3   | High     | Paging (unverified contract) threw on an error page and **discarded the first 10 entries** of the group, which then failed every poll.                                                                          | Paging errors keep the partial result (`incomplete`); connectivity errors still propagate.                                                                          |
| 4   | Medium   | If the controller ignores `offset`, LON items (no OID) were re-added on every page: duplicates and up to 50 requests per group.                                                                                 | All item kinds are de-duplicated (OID, nvIndex, raw JSON).                                                                                                          |
| 5   | Medium   | `schedule()` replaced the timer handle without clearing it; any direct `runCycle()` started a **second polling chain** (also kept the test process alive).                                                      | Timer replaced and cleared; concurrent runs of one category are coalesced.                                                                                          |
| 6   | Medium   | A failed manual rescan left polling **stopped forever**.                                                                                                                                                        | Previous catalog keeps being served; error is reported.                                                                                                             |
| 7   | Medium   | Discovery cache ignored `pollLon` / `excludedNodes`: enabling LON or un-excluding a module had no effect until the cache expired (7 days).                                                                      | Scan options fingerprint stored in the cache (schema v2) and compared.                                                                                              |
| 8   | Medium   | "Anonymised" diagnostics export contained the controller IP inside Node error texts (`connect ECONNREFUSED 192.168.x.y:80`).                                                                                    | Every occurrence of the host is masked.                                                                                                                             |
| 9   | Medium   | `npm test` used a quoted `**` glob; Node 20 (in the CI matrix) does not expand test globs.                                                                                                                      | `test/*.test.ts`, expanded by the shell.                                                                                                                            |
| 10  | Low      | Socket `timeout` is an idle timeout only; a slow-drip response could hold a request open indefinitely.                                                                                                          | Total per-request deadline.                                                                                                                                         |
| 11  | Low      | Read-back was a single immediate read: a controller applying values with a delay produced false `mismatch` results.                                                                                             | Up to 3 reads, 1 s apart (configurable in code).                                                                                                                    |
| 12  | Low      | Test-connection button templated the password into JSON (`"${data.password}"`): breaks on quotes and puts the plaintext on the message bus.                                                                     | Password no longer sent; the saved one is used (UI help text added).                                                                                                |
| 13  | Low      | README said "three independent opt-ins"; one of the three is the controller flag.                                                                                                                               | Wording corrected (EN/PL).                                                                                                                                          |

### Checked and found correct

- Digest: RFC 2617 vector reproduced; nonce reuse; stale-nonce re-challenge; 401 after re-challenge -> `auth`, never retried.
- `setStateChanged` compares `val`, `ack` **and** `q` (verified in js-controller source), so stale -> good quality transitions are written.
- No write can occur at startup: write states are only subscribed; ioBroker does not replay existing values on subscribe.
- Write gating order is fail-closed (enabled -> connected -> known -> allow-listed -> controller-writable -> valid); PUT is never retried; success only after read-back.
- No GPL-3.0 code: implementation is independent; only wire-format facts (paths, field names) are shared with HeatNexus/windhager-tools. `parsers.ts` was compared against both; structure and code differ.
- Polling never overlaps within a category; backoff arithmetic caps at 8x.

### Still open (deliberately not changed in this pass)

1. Semantic namespaces (`boilers.*`, `heatingCircuits.*`, ...) and native enum texts: need real captures.
2. Digest `nc` is shared across concurrent requests; servers with strict nonce-count checking could reject out-of-order requests. If that happens on hardware, set parallel requests to 1.
3. Stale datapoints get `val: null` (history keeps old values); keeping the last value would need an extra read per object.
4. `extendObject` runs for every object on each start; DB churn and duration on large systems are unmeasured.
5. Admin `jsonData` still templates host/username; both are validated, but a `"` in the user name would break the test button.
6. `@iobroker/repochecker` not run.
7. `node-forge` advisory via `@iobroker/adapter-core` (see SECURITY.md).
8. Paging (P7), single-OID read (P9) and the whole write path remain unverified on hardware.
