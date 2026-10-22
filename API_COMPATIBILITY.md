# API compatibility matrix

The authoritative description of the controller's API is the Swagger 1.2 documentation the controller serves itself
(`/api-docs`); all 201 operations are listed and classified in [docs/API_REFERENCE.md](docs/API_REFERENCE.md).

| API family                                                                                                                   | Detected by                                        | Auth                         | Firmware / device (evidence)                                                                                                                                                   | Coverage in this adapter                                                                                                                           |
| ---------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| **InfoWIN REST "RestApiRC7030" 1.0** (`/api/1.0/lookup`, `datapoint`, `datapoints`, `object`, `info`)                        | `GET /api/1.0/lookup/1` returns a JSON module list | HTTP Digest, MD5, `qop=auth` | **MB6621 fw 0.10.4 (real-device-verified)**; BioWIN 2 / InfoWIN Touch 1.0.2 (ha-windhager); PuroWIN, BioWIN, PelletsWIN, LogWIN, VarioWIN via HeatNexus (other users' exports) | Discovery, polling, names, objects, LON (opt-in), single-datapoint writes (opt-in). Read path verified on MB6621; writes untested.                 |
| Text resources `/res/xml/{EbenenTexte,VarIdentTexte,AufzaehlTexte}_<lang>.xml`                                               | file exists                                        | same                         | MB6621: de, en, fr, it (no pl)                                                                                                                                                 | Used for names and enum texts                                                                                                                      |
| Other services on the same device: `InfoWinFehlerlog`, `InfoWinHeartbeat`, `DcmRC7030`, `WsAdmin`, `WsFUP7030`, `dprecorder` | `/api-docs`                                        | same                         | MB6621                                                                                                                                                                         | **Not used.** Error log and heartbeat answered HTTP 503; the rest are administration, LON management, recorder, firmware, time and user functions. |
| "comWinStack API" landing page                                                                                               | HTTP 200 with HTML                                 | unknown                      | newer InfoWIN (windhager-tools README)                                                                                                                                         | **Unsupported**; reported as `malformed` / "does not look like a supported InfoWIN REST API"                                                       |
| Windhager cloud (WindhagerConnect / myComfort)                                                                               | n/a                                                | account                      | n/a                                                                                                                                                                            | **Deliberately not used.**                                                                                                                         |
| LON bus directly                                                                                                             | n/a                                                | n/a                          | n/a                                                                                                                                                                            | **Not possible**; only the LON variables the controller's web API lists                                                                            |

## Detection behaviour

`detectProtocol` issues only `GET` requests. Results map to:

| Result                   | Cause                                     | Adapter reaction                                   |
| ------------------------ | ----------------------------------------- | -------------------------------------------------- |
| `ok`                     | module list parsed                        | continue                                           |
| `auth`                   | Digest rejected                           | log error, **no automatic retry** (avoid lock-out) |
| `connection` / `timeout` | network                                   | retry with exponential backoff (30 s up to 10 min) |
| `unsupported`            | 404 or other unknown API                  | log error, retry slowly                            |
| `malformed`              | 200 but not JSON (e.g. HTML landing page) | log error, retry slowly                            |

## Request catalogue (everything the adapter may send)

| Request                                                            | Purpose                                                           | Mutating |
| ------------------------------------------------------------------ | ----------------------------------------------------------------- | -------- |
| `GET /api/1.0/lookup/1[/node[/fn[/level]]]`                        | discovery, menu-wise polling                                      | no       |
| `GET /api/1.0/lookup/1/<node>/<fn>/<level>/<nvIndex>?count&offset` | LON variable value (opt-in); paging of large groups               | no       |
| `GET /api/1.0/datapoint/<OID>`                                     | per-datapoint polling of cache-only values; write read-back       | no       |
| `GET /api/1.0/datapoints`                                          | discovery of cache-only datapoints (once per discovery)           | no       |
| `GET /api/1.0/object?OID=`                                         | versions, function names, time programs (every 15 min)            | no       |
| `GET /api/1.0/info/deviceinfo`                                     | controller identity                                               | no       |
| `GET /res/xml/*.xml`                                               | name and enum text tables (once per discovery)                    | no       |
| `PUT /api/1.0/datapoint`                                           | one user value; only with writes enabled and the OID allow-listed | **yes**  |

Anything else is out of scope: user, VPN, configuration, settings, firmware, LON management, scans, hardware tests
and component tests have no code path in the adapter.
