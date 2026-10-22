# Architecture

Transport, protocol, discovery, naming, state mapping, polling, writes and ioBroker lifecycle are separate modules.
Only `src/main.ts` touches the ioBroker API; everything else is plain TypeScript and unit-testable.

```
                          +--------------------------- main.ts (lifecycle, admin messages) --------------------------+
                          |                                                                                         |
 HttpClient + DigestAuth --> InfoWinRestApi (ControllerApi / WritableControllerApi) --> detectProtocol              |
   (limits, timeouts,       |                                                                                       |
    retries, deadline)      +--> scanSystem --> Catalog --> applyLabels <-- ResourceTexts (/res/xml, read-only)     |
                            |                     |                                                                 |
                            |                     +--> CapabilityRegistry (index, categories, cache validity)       |
                            +--> PollingService (fast/normal/slow chains) --> StateRegistry --> ioBroker objects   |
                            +--> ObjectService (typeId 30, 15-min cycle) ----^                                     |
                            +--> CommandService (validate -> PUT -> read-back) <-- onStateChange (opt-in)          |
 DiagnosticsService <-------+                                                                                       |
```

| Module                         | Responsibility                                                                                                                                                                                                           |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `api/DigestAuth`               | RFC 2617/7616 header building (MD5, MD5-sess, `qop=auth`); pure, RFC test vector                                                                                                                                         |
| `api/HttpClient`               | Digest handshake and nonce reuse, concurrency limit, idle timeout **and** total per-request deadline, keep-alive, GET retry with exponential backoff, raw-bytes GET for XML; PUT is never retried; no header logging     |
| `api/ControllerApi`            | interfaces; read and write are **separate types** so telemetry code cannot write                                                                                                                                         |
| `api/InfoWinRestApi`           | the one API family: lookup tree, `datapoint`, `datapoints` (cache), `object`, `deviceinfo`; defensive paging                                                                                                             |
| `api/ProtocolDetector`         | non-mutating probe; classifies auth / connection / timeout / unsupported / malformed                                                                                                                                     |
| `api/parsers`                  | strict parsing of untrusted JSON. OID = `/<subnet>/<node>/<function>/<group>/<member>/<instance>`; unknown shapes are skipped and counted                                                                                |
| `api/ResourceTexts`            | small dependency-free XML reader for `EbenenTexte` (menu levels), `VarIdentTexte` (variables), `AufzaehlTexte` (enum values); charset from the prolog; language chain requested -> en -> de                              |
| `discovery/SystemScanner`      | modules -> functions -> menu groups, read-only; skips locked functions; aborts on connectivity errors instead of returning a partial catalog; adds cache-only datapoints in a synthetic per-datapoint group (`*.direct`) |
| `discovery/CapabilityRegistry` | indexes, poll-category heuristic, cache validity (module signature, firmware, scan options incl. language, age)                                                                                                          |
| `mappings/Naming`              | labels: menu level + variable ("Heating limits: Max. flow temp."), code fallback; generic API names ("02-010", "Knoten 15") are ignored                                                                                  |
| `mappings/StateRoles`, `Units` | type/role/min/max/step/states from metadata; enum texts also for integers without an `enum` list; dates and times and objects are strings                                                                                |
| `services/StateRegistry`       | idempotent object creation, stale marking and revival instead of deletion, change-aware writes (`setStateChanged`), offline quality flag                                                                                 |
| `services/PollingService`      | one `setTimeout` chain per category, backoff, per-group error isolation, offline/online callbacks, **stops on auth failure**, per-datapoint reads for the `direct` group                                                 |
| `services/ObjectService`       | reads `typeId 30` objects (versions as text, time programs as verbatim JSON); read-only                                                                                                                                  |
| `services/CommandService`      | serialised queue; checks: enabled, connected, known, allow-listed, controller-writable, value valid; PUT; up to 3 read-backs; audit                                                                                      |
| `services/DiagnosticsService`  | counters, latency, error history, anonymised export (host masked everywhere, serials masked)                                                                                                                             |
| `utils/*`                      | config normalisation with fail-safe defaults, masking, secret scrubbing                                                                                                                                                  |

## Decisions

- **Identity = OID.** `/1/15/0/3/51/0` -> `modules.node_15.fn_0.03-051`. The menu level is _not_ part of an OID (this
  was wrong in versions before 0.3.0 and was found by probing a real controller). Names are labels only.
- **Poll unit = menu group** (the controller serves menu-wise reads). A group belongs to exactly one category:
  groups containing any controller-writable datapoint are "slow" (settings), pure measurement groups "normal"; the
  user can promote groups to "fast" with the key found in `native.group` of the states. Cache-only datapoints form one
  group per function that is read datapoint by datapoint.
- **Types** come from metadata at discovery and stay stable. Placeholders (`-`, `-.-`, empty) become `null`.
- **Names are best effort and layered:** controller text table -> meaningful API name -> menu level + code -> code.
  Function and module names come from the controller's own `name` fields when they are not generic.
- **Offline** = quality `0x42` on the last values; objects are never deleted; disappeared datapoints get
  `native.stale = true`.
- **No semantic layer.** `fctType` meanings are only observed (14 and 20), not verified; see RESEARCH.md section 4.
- **No shared mutable globals**: every adapter instance owns its client, catalog, registry and timers.
- **One runtime dependency** (`@iobroker/adapter-core`); Digest and XML are implemented on Node built-ins.
- **`build/` is committed** so the adapter installs straight from GitHub; CI fails if it drifts from `src/`.
