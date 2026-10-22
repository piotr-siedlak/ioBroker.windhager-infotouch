# Configuration

| Tab         | Option                      | Default         | Meaning                                                                                                    |
| ----------- | --------------------------- | --------------- | ---------------------------------------------------------------------------------------------------------- |
| Connection  | Host / IP                   | -               | plain IP or host name, no `http://`                                                                        |
|             | Transport / Port            | HTTP / 80       | HTTPS only if your device offers it (not probed; the reference controller was used over HTTP)              |
|             | User / Password             | `USER` / -      | password stored encrypted. Use the end-user account; the adapter never tries default credentials           |
|             | Verify TLS certificate      | on              | only for HTTPS; leave on                                                                                   |
|             | Request timeout             | 15000 ms        | 1000-120000; also the total time limit of one request                                                      |
|             | Parallel requests           | 2               | 1-4; the controller serves requests one after another, 1-2 is enough                                       |
|             | Test connection             |                 | probes without changing anything; uses the **saved** password (save first after changing it)               |
| Discovery   | Excluded node IDs           | -               | e.g. `14`; excluded modules are not read                                                                   |
|             | Cache lifetime              | 168 h           | the cache is also dropped when the module list, firmware, language, LON option or exclusions change        |
|             | Rescan now / Show inventory |                 | or press `diagnostics.rescan`                                                                              |
| Polling     | fast / normal / slow        | 30 / 60 / 300 s | minimum 10 / 30 / 60 s; each category can be disabled                                                      |
|             | Groups polled fast          | -               | poll group keys from `native.group` of a state, comma or space separated, e.g. `n15.f0.l101 n15.f0.direct` |
|             | Read LON variables          | off             | one request per variable (87 on the reference controller); slow                                            |
| Data        | Raw states                  | off             | adds `raw.*` strings                                                                                       |
|             | Language of names           | system language | names from the controller's text tables; falls back to English, then German                                |
| Control     | Allow writes                | **off**         | master switch                                                                                              |
|             | Write allow-list            | empty           | one exact OID per line, e.g. `/1/15/0/3/51/0`                                                              |
|             | Verify by read-back         | on              | keep on                                                                                                    |
| Diagnostics | Export                      |                 | anonymised JSON (masked host and serials, no values, no credentials)                                       |

## Polling categories

The controller is read menu by menu, so the unit of polling is a **poll group** (shown in `native.group`). Default
assignment:

- groups made only of read-only datapoints (measurements such as boiler temperature) -> **normal** (60 s)
- groups holding any writable datapoint (settings such as set points and limits) -> **slow** (300 s)
- the `*.direct` group of a function (main-screen values the controller keeps in its cache: actual room and flow
  temperature, operation mode) -> **normal**, read one datapoint per request
- LON-only groups -> slow

On the reference controller this puts 20 of the 78 datapoints in "normal" (6 of them structured objects that the
15-minute object cycle reads instead) and 58 in "slow"; a full discovery takes a few dozen requests. The intervals are untuned starting points: watch `diagnostics.avgLatencyMs` and
`diagnostics.consecutiveFailures` for a day before shortening them. To follow a setting more closely (for example the
room set points), add its group key to "Groups polled fast".

Structured objects (versions, time programs) are read every 15 minutes regardless of these settings.

## Enabling a write (step by step)

1. Find the state, open its object, copy `native.oid` (e.g. `/1/15/0/3/51/0`).
2. Confirm `native.writeProtected` is `false` and note `min`, `max`, `step` (and the enum texts, if any).
3. Put the OID on the allow-list, tick **Allow writes**, save (the instance restarts).
4. Change the value from the Objects view and watch the log: you should see an `AUDIT ... confirmed` line and the
   state re-acknowledged with the value the controller reports.
5. A refused or unverified write is logged as a warning and the state is restored from the controller.

Values outside the controller's reported range are refused, including any non-zero value for a datapoint whose range is
0..0. Read-back is attempted up to 3 times, 1 s apart, before a `mismatch` is reported. Writes were never exercised on
hardware - try one non-critical value first.

**The controller's writable flag is not a safety statement.** On the reference controller 58 of 78 datapoints are
writable, including installer settings such as "Module functions" (what the module is configured as), "LON system
data", heating limits and screed drying programs. Never allow-list those, combustion or safety parameters, or anything
under "Actuator test".
