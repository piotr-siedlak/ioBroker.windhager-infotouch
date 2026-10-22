# Testing

## Automated

```bash
npm run typecheck && npm run lint
npm test                 # node:test via tsx - 90 tests against a fake controller
npm run test:package     # @iobroker/testing package-file checks (53; downloads JSON schemas)
npm run build && npm run test:integration   # starts the adapter in a real js-controller (2 tests)
```

`npm run check` runs typecheck, lint, the unit tests and the package checks.

### Fixtures

| Fixture                          | What it is                                                                                                                                                                                                                                                       |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `test/fixtures/mb6621-real.json` | **Sanitised capture of a real controller** (InfoWIN Touch MB6621, fw 0.10.4, UMUMLZ + ZSP-SOFU, eBUS gas boiler): lookup tree, 78 datapoints, objects, controller cache, reduced text tables (en, de). Neuron/program ids, serial and check number are replaced. |
| `test/fixtures/gasBoiler.ts`     | **Synthetic**, for edge cases the real system does not have: duplicate display names, placeholders, missing metadata, OID-less entry, paging, LON, time program, one module whose function list fails.                                                           |

The fake controller (`test/helpers/FakeController.ts`) verifies Digest authentication **independently** of the
client and can simulate: bad credentials, timeouts, slow-drip responses, 404, an HTML landing page, malformed JSON, 5xx
bursts, rejected writes, ignored writes (read-back mismatch), delayed writes, latency, a closed port, XML resources,
and the controller cache.

### What is covered

Digest handshake and nonce reuse; classification of auth / timeout / unsupported / malformed / connection failures;
GET-only probes; discovery, exclusion and cache invalidation (module list, firmware, LON option, exclusions);
OID parsing (`/<subnet>/<node>/<fn>/<group>/<member>/<inst>`), enum, unit and value parsing; XML text tables (charset,
hostile input, language chain); name composition and generic-name detection; roles, units and enum states; idempotent
object creation; stale marking and revival; poll categories and group keys; write gating (disabled, offline, unknown,
not allow-listed, not writable, range/step/enum/type, rejection, mismatch, delayed apply, serialisation); polling
(deduplication, backoff, offline/online, auth stop, per-group error isolation, cleanup); config fail-safe defaults;
masking and scrubbing; two independent instances. `test/review-repro.test.ts` pins the defects found in review.
`test/real-device.test.ts` checks the real capture end to end: structure, ids, names, types, objects, cache-only
values, German names and that only GET requests were issued.

### What is not covered

Long-running polling against a real controller, behaviour under packet loss, js-controller object/state persistence
beyond the start-up smoke test, Admin UI rendering, and **any write on hardware**.

## Capturing a controller (read-only)

Please contribute captures of other installations. The probe below sends only GET requests, one at a time.

1. Use the end-user account. Run from a machine that can reach the controller.
2. Fetch, with Digest authentication and ~0.25 s between requests: `/api/1.0/info/deviceinfo`, `/api/1.0/lookup/1`
   and the tree below it (`/1/<node>`, `/1/<node>/<fn>`, `/1/<node>/<fn>/<level>`), `/api/1.0/datapoints`,
   `/api/1.0/object?OID=<oid>` for the OIDs with `typeId` 30, and `/res/xml/{EbenenTexte,VarIdentTexte,AufzaehlTexte}_en.xml`.
3. Replace `neuronId`, `programId`, `serialnumber`, `checknumber` and IP addresses before sharing.
4. Never run PUT, POST or DELETE requests, and never touch `/api/1.0/user`, `vpn`, `config`, `settings`, `scan` or the
   `Ws*` services.

## Real-hardware verification plan

Run only on your own installation, with a person present, and not during a heating fault.

1. Install, enter credentials, press **Test connection**; note model and firmware.
2. Leave writes off. After discovery compare the datapoint count (`diagnostics.datapoints`) and a handful of values
   (boiler temperature, room set points, mode) with the controller display.
3. Watch `diagnostics.avgLatencyMs` and `consecutiveFailures` for 24 h with the default intervals. Only then tune.
4. Unplug the LAN cable for a few minutes: `info.connection` must go `false`, the values keep their last value with
   quality `0x42`, recovery must be automatic.
5. Export diagnostics; capture sanitised payloads if something looks wrong.
6. Optional single write: allow-list one non-critical user set point, change it by one step, confirm on the controller
   display, restore the original value. Stop at the first anomaly.

Record results in `DEVICE_SUPPORT.md` with the exact firmware.
