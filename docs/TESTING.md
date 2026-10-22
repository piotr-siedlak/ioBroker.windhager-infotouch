# Testing

## Automated

```bash
npm run typecheck && npm run lint
npm test                 # node:test via tsx - 65 tests against a fake controller
npm run test:package     # @iobroker/testing package-file checks (downloads JSON schemas)
npm run build && npm run test:integration   # starts the adapter in a real js-controller
```

The fake controller (`test/helpers/FakeController.ts`) implements Digest verification **independently** of the
client, and can simulate: bad credentials, timeouts, 404, HTML landing page, malformed JSON, 5xx bursts, rejected
writes, ignored writes (read-back mismatch), latency and a closed port. The fixture
(`test/fixtures/gasBoiler.ts`) is **synthetic**: it models a gas boiler with circuits, buffer and DHW-style groups
plus awkward cases (duplicate names, placeholders, missing metadata, locked function, OID-less entry, paging, LON,
time program, failing module). It proves parsing and logic, not device behaviour.

Covered: Digest handshake and nonce reuse; auth/timeout/unsupported/malformed/connection classification; GET-only
probes; discovery, exclusion, cache invalidation; paging; OID/enum/value parsing; roles and units; idempotent object
creation; stale marking and revival; write gating (disabled, offline, unknown, not allow-listed, not writable,
range/step/enum/type, rejection, mismatch, serialisation); polling dedup, backoff, offline/online, auth-stop, stop
cleanup; config fail-safe defaults; masking and scrubbing; two independent instances.

Not covered: the real controller, js-controller object/state persistence (beyond the integration smoke test),
Admin UI rendering, long-running soak tests.

## Real-hardware verification plan (read-only first)

Run only against your own installation, with a person present, and never during a heating fault.

1. Install, enter credentials, press **Test connection**. Record controller model/firmware shown.
2. Leave writes off. Let discovery finish; compare the datapoint count and a handful of values (boiler temperature,
   outdoor temperature, circuit setpoint) with the controller display.
3. Watch `diagnostics.avgLatencyMs` and `consecutiveFailures` for 24 h with default intervals. Only then tune.
4. Unplug the LAN cable for a few minutes: `info.connection` must go false, values keep last value with quality 0x42,
   recovery must be automatic.
5. Export diagnostics. Capture sanitised group payloads for a fixture (replace IPs, Neuron/program IDs).
6. Optional write test, one value: allow-list a non-critical user setpoint, change by one step, confirm on the
   controller display, restore the original value. Stop at the first anomaly.

Record results in `DEVICE_SUPPORT.md` with the exact firmware.
