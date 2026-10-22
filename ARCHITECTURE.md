# Architecture

Transport, protocol, discovery, state mapping, polling, writes and ioBroker lifecycle are separate modules.
Only `main.ts` touches the ioBroker API; everything else is plain TypeScript and unit-testable.

```
                       +------------------------- main.ts (lifecycle, admin messages) -------------------------+
                       |                                                                                      |
 HttpClient + DigestAuth --> InfoWinRestApi (ControllerApi / WritableControllerApi) --> detectProtocol          |
        |  bounded concurrency,       |                                                                         |
        |  timeouts, GET retries      +--> scanSystem --> Catalog --> CapabilityRegistry (index, categories,    |
        |                             |                              cache validity)                            |
        |                             +--> PollingService (fast/normal/slow chains) --> StateRegistry --> ioBroker
        |                             +--> CommandService (validate -> PUT -> read-back) <-- onStateChange      |
        +--> DiagnosticsService <-----+--> ScheduleService (read-only)                                          |
```

| Module                         | Responsibility                                                                                                                                          | Notes                                                         |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| `api/DigestAuth`               | RFC 2617/7616 header building (MD5, MD5-sess, qop=auth)                                                                                                 | pure; RFC vector tested                                       |
| `api/HttpClient`               | requests, Digest handshake and nonce reuse, timeouts, keep-alive, concurrency limit, GET retry with exponential backoff, TLS verification on by default | PUT is never retried; no logging of headers                   |
| `api/ControllerApi`            | interfaces. **Read and write are separate types** so telemetry code cannot write                                                                        |                                                               |
| `api/InfoWinRestApi`           | the one API family implemented                                                                                                                          | add families behind the same interface                        |
| `api/ProtocolDetector`         | non-mutating probe, error classification                                                                                                                |                                                               |
| `api/parsers`                  | strict parsing of untrusted JSON; unknown shapes are skipped and counted                                                                                |                                                               |
| `discovery/SystemScanner`      | walks modules -> functions -> groups, read-only, skips locked functions, aborts on connectivity errors rather than returning a partial catalog          |                                                               |
| `discovery/CapabilityRegistry` | indexes, poll category heuristic, cache validity (signature + firmware + age)                                                                           |                                                               |
| `models/Datapoint`             | typed catalog                                                                                                                                           |                                                               |
| `mappings/*`                   | unit -> role, shape (type/role/min/max/step/states)                                                                                                     | heuristics, documented                                        |
| `services/StateRegistry`       | object creation (idempotent), stale marking instead of deletion, change-aware writes (`setStateChanged`)                                                | talks to a small `AdapterPort`, tested with an in-memory port |
| `services/PollingService`      | one `setTimeout` chain per category (no overlapping cycles), backoff, offline/online callbacks, **stops on auth failure**                               |                                                               |
| `services/CommandService`      | serialised queue; checks: enabled, connected, known, allow-listed, controller-writable, value valid; PUT; read-back; audit                              |                                                               |
| `services/ScheduleService`     | verbatim read of `typeId 30` objects                                                                                                                    | read-only                                                     |
| `services/DiagnosticsService`  | counters, latency, error history, anonymised export                                                                                                     |                                                               |
| `utils/*`                      | config normalisation (fail-safe defaults), masking, secret scrubbing                                                                                    |                                                               |

## Decisions

- **Identity = OID.** `n15.f0.l3.m50.i0` -> `modules.node_15.fn_0.grp_3.dp_50_0`. Display names are labels only; duplicates occur in real data.
- **Poll unit = lookup group**, because the controller serves menu-wise reads. A group belongs to exactly one category (dedup). Default heuristic: groups with any controller-writable point are settings (slow), pure measurement groups are normal; users can promote groups to fast.
- **Types** are decided from metadata (enum, unit, range) at discovery and stay stable. Unparseable values become `null` with the last good quality flag handling offline separately.
- **Offline** = quality `0x42` on the last values; objects are never deleted. Disappeared datapoints get `native.stale = true`.
- **No semantic layer yet.** `fctType` meanings are unverified for gas appliances (RESEARCH.md section 4).
- **No shared mutable globals**; every adapter instance owns its client, catalog, registry and timers.
- **Zero runtime dependencies** besides `@iobroker/adapter-core` (Digest is implemented on `node:crypto`/`node:http`).
