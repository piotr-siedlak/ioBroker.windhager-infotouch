# Review brief

The first version (0.1.x) was written with Sonnet 5.5 to save tokens and reviewed adversarially with Opus 5.5
(results below, all fixed in 0.1.1). Version 0.3.0 was then corrected against a real controller. This file tells a
reviewer where the risk is **now**.

## Status

- Verified on one real controller (InfoWIN Touch MB6621, fw 0.10.4) with read-only requests: see
  [DEVICE_SUPPORT.md](../DEVICE_SUPPORT.md). **Never verified on hardware:** all writes, polling over hours, recovery after
  a real outage.
- The scaffold was written by hand because `@iobroker/create-adapter` could not reach the npm dist-tags endpoint from the
  sandbox. Compare against the official template for anything missing (`.vscode`, release script, auto-merge workflow).
- `@iobroker/repochecker` has not been run. The repository is `ioBroker.windhager-infotouch` and the adapter is
  `windhager-infotouch`, which satisfies the naming rule.
- No semantic aliases (`boilers.*`, `heatingCircuits.*`, ...) on purpose; see RESEARCH.md section 4.

## Highest-risk code (read line by line)

| File                                                | Why                                                                                                                                                           |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/services/CommandService.ts`                    | the only path that writes. Gating order, value formatting (`toFixed` + trim), read-back tolerance and retries, queue behaviour after an error.                |
| `src/main.ts` `onStateChange` / `restoreFromDevice` | user writes arrive here; no write may happen at start-up; failures must restore the state; `Number(state.val)` for strings.                                   |
| `src/api/HttpClient.ts`                             | Digest `nc` counter shared by concurrent requests, stale-nonce re-challenge, total deadline, semaphore, shutdown, response cap.                               |
| `src/services/PollingService.ts`                    | category chains, per-group error isolation, offline/online semantics across categories, auth-failure stop, per-datapoint reads of the `direct` group.         |
| `src/services/StateRegistry.ts`                     | idempotency, stale/revive (ids changed in 0.3.0), `getObjectViewAsync` range query in `main.ts`, speed with thousands of objects (sequential `extendObject`). |
| `src/api/parsers.ts`, `InfoWinRestApi.ts`           | OID layout (corrected in 0.3.0), unit/placeholder handling, defensive paging, the `datapoint` read route.                                                     |
| `src/api/ResourceTexts.ts`, `mappings/Naming.ts`    | hand-written XML reader for controller-supplied files (hostile-input tolerance), name composition, language fallback.                                         |
| `src/discovery/SystemScanner.ts`                    | locked functions skipped, cache-only datapoints added to a synthetic group, aborts on connectivity errors.                                                    |
| `admin/jsonConfig.json`                             | `sendTo` payloads; the test button deliberately omits the password.                                                                                           |

## Questions

- Are the poll-category heuristic (settings slow, measurements normal, cache-only normal) and the intervals acceptable
  defaults for a boiler controller? They are untuned.
- Is a discovery cache stored as a file in a `meta.user` object the right choice versus object `native`?
- Is anything in `src/` derived too closely from the GPL-3.0 HeatNexus? Only wire-format facts should be shared; the
  controller's Swagger documentation is the primary source.
- Which tests would you require before a first write on hardware?

## Reproduce

```bash
npm ci && npm run check && npm run build && npm run test:integration
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

### Still open after the review pass (status updated for 0.3.0)

1. Semantic namespaces (`boilers.*`, `heatingCircuits.*`, ...) need captures of more installations. (Native enum texts were done in 0.2.0/0.3.0.)
2. Digest `nc` is shared across concurrent requests; servers with strict nonce-count checking could reject out-of-order requests. If that happens on hardware, set parallel requests to 1.
3. Stale datapoints get `val: null` (history keeps old values); keeping the last value would need an extra read per object.
4. `extendObject` runs for every object on each start; DB churn and duration on large systems are unmeasured.
5. Admin `jsonData` still templates host/username; both are validated, but a `"` in the user name would break the test button.
6. `@iobroker/repochecker` not run.
7. `node-forge` advisory via `@iobroker/adapter-core` (see SECURITY.md).
8. The whole write path is unverified on hardware. Paging was not needed on MB6621 0.10.4 (kept, experimental). The single-OID read route was corrected in 0.3.0 and verified. Concurrent requests (default 2) were not exercised on the controller: the live runs used one request at a time.
