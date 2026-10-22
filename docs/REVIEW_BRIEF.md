# Review brief (for the Opus 5.5 review pass)

The first version was produced with Sonnet 5.5 to save tokens. Please review it adversarially. Nothing has run
against real hardware. Start with `RESEARCH.md` (evidence levels), then the code below in this order.

## Deviations and known gaps to check first

1. **Scaffold was hand-built**, not generated: `@iobroker/create-adapter@3.1.5` failed because a registry request
   (`/-/package/.../dist-tags`) timed out from the sandbox. Compare against the official template for anything missing
   (e.g. `.vscode`, `admin/` tsconfig, `release-script`, `.github` auto-merge, `test/mocha.setup`).
2. **Repo does not exist on GitHub yet** (SSH auth works as `piotr-siedlak`; `gh` was not installed, so it could not be created).
3. `@iobroker/repochecker` was **not run** (needs a reachable public repo). Run it once the repo exists.
4. Semantic namespaces from the brief (`boilers.*`, `heatingCircuits.*`, `buffers.*`, `dhw.*`, `system.*`) are **not**
   implemented on purpose (no verified `fctType` meaning for gas). Decide if that is acceptable for a first beta.
5. No Native enum texts / names from `/res/xml` yet.
6. `README`/docs claim counts (65 tests); re-check.

## Highest-risk code (please read line by line)

| File | Why |
| --- | --- |
| `src/services/CommandService.ts` | the only path that writes. Check gating order, value formatting (`toFixed` + trim), read-back tolerance, queue behaviour after a thrown error. |
| `src/main.ts` `onStateChange` / `restoreFromDevice` | user writes arrive here; confirm no write can occur at startup and that failures restore state correctly; `Number(state.val)` for strings. |
| `src/api/HttpClient.ts` | Digest nonce reuse and `nc` counter on concurrent requests (requests share a counter - is reuse across sockets safe?), 401 re-challenge handling when the nonce goes stale mid-session, queue/semaphore correctness, shutdown behaviour, response-size cap, redirect handling (none). |
| `src/services/PollingService.ts` | overlapping/lost cycles, backoff arithmetic, `online` flag semantics when different categories fail independently, auth-failure stop. |
| `src/services/StateRegistry.ts` | idempotency, stale/revive, `getObjectViewAsync` range query in `main.ts`, performance with thousands of objects (sequential `extendObject`). |
| `src/api/InfoWinRestApi.ts` | paging loop (unverified contract), tolerance to odd payloads, `readDatapoint` route. |
| `src/utils/Validation.ts` | fail-safe defaults; host regex; allow-list parsing. |
| `admin/jsonConfig.json` | `sendTo` payloads (`jsonData` templating with an empty password / unsaved values), password handling with `encryptedNative` for the test button (does Admin pass the plaintext?). |

## Questions

* Are the assumptions in `RESEARCH.md` P7 (paging) and P9 (single OID read) acceptable, or should those features be disabled until verified?
* Should group-level polling categories default differently (settings = slow is a heuristic)?
* Is storing the discovery cache as a file in a `meta.user` object the right choice vs. object `native`?
* Is anything in `src/` derived too closely from GPL-3.0 HeatNexus? Compare response-field handling in `parsers.ts`
  against the MIT `windhager-tools` and GPL sources; only wire-format facts should be shared.
* Missing tests you would require before a first real-hardware run.

## Reproduce

```bash
npm ci && npm run check && npm run build
```
