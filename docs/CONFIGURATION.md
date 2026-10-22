# Configuration

| Tab         | Option                 | Default         | Meaning                                                                                      |
| ----------- | ---------------------- | --------------- | -------------------------------------------------------------------------------------------- |
| Connection  | Host / IP              | -               | plain IP or host name, no `http://`                                                          |
|             | Transport / Port       | HTTP / 80       | HTTPS only if your device offers it                                                          |
|             | User / Password        | `USER` / -      | password stored encrypted                                                                    |
|             | Verify TLS certificate | on              | only for HTTPS; leave on                                                                     |
|             | Request timeout        | 15000 ms        | 1000-120000                                                                                  |
|             | Parallel requests      | 2               | 1-4; the controller serves requests sequentially                                             |
|             | Test connection        |                 | probes without changing anything; uses the **saved** password (save first after changing it) |
| Discovery   | Excluded node IDs      | -               | e.g. `17,18`; excluded modules are not read                                                  |
|             | Cache lifetime         | 168 h           | cache is also dropped when the module list or firmware changes                               |
|             | Rescan now / inventory |                 | or press `diagnostics.rescan`                                                                |
| Polling     | fast / normal / slow   | 30 / 60 / 300 s | min 10 / 30 / 60 s; each can be disabled                                                     |
|             | Groups polled fast     | -               | group keys such as `n15.f0.l3` (visible in `native` of the group's states)                   |
|             | Read LON variables     | off             | one request per variable; slow                                                               |
| Data        | Raw states             | off             | adds `raw.*` strings                                                                         |
| Control     | Allow writes           | **off**         | master switch                                                                                |
|             | Write allow-list       | empty           | one exact OID per line                                                                       |
|             | Verify by read-back    | on              | keep on                                                                                      |
| Diagnostics | Export                 |                 | anonymised JSON (masked host and serials, no values, no credentials)                         |

Polling categories: groups consisting only of write-protected points are "normal" (measurements); groups containing
writable parameters are "slow" (settings). These are untuned starting values; measure `diagnostics.avgLatencyMs`
and `diagnostics.consecutiveFailures` before shortening intervals.

## Enabling a write (step by step)

1. Find the state, open its object, copy `native.oid` (e.g. `/1/16/0/3/21/0`).
2. Confirm `native.writeProtected` is `false` and note `min`, `max`, `step`.
3. Put the OID on the allow-list, tick **Allow writes**, save (the instance restarts).
4. Change the value from the Objects view, watch the log: you should see an `AUDIT ... confirmed` line and the state
   re-acknowledged with the value the controller reports.
5. A refused or unverified write is logged as a warning and the state is restored from the controller.

Writes are refused when the controller reports a degenerate range (e.g. min = max = 0), because the valid range
is then unknown. Read-back is attempted up to 3 times, 1 s apart, before a `mismatch` is reported.

Never allow-list combustion, safety, service or installer parameters.
