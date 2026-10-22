# API compatibility matrix

| API family                                                                                         | Detected by                                                                            | Auth                         | Firmware / device (evidence)                                                                                                                                                             | Coverage in this adapter                                                                                              |
| -------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| **InfoWIN REST "lookup" 1.0** (`/api/1.0/lookup/...`, `/datapoint`, `/object`, `/info/deviceinfo`) | `GET /api/1.0/lookup/1` succeeds with a JSON module list (then `deviceinfo`, optional) | HTTP Digest, MD5, `qop=auth` | BioWIN 2 / InfoWIN Touch 1.0.2 (ha-windhager); PuroWIN, BioWIN, PelletsWIN, LogWIN, VarioWIN via HeatNexus (diagnostic exports of other users); controllers reporting `device: "MB66xx"` | Discovery, polling, LON (opt-in), time programs read-only, single-datapoint writes (opt-in). **Fixture-tested only.** |
| RC7030 service routes (`/api-docs`, `nodes`, `scan`, `config`, `user`, `vpn`)                      | not probed                                                                             | Digest                       | BioWIN RC7030 (2020 community notes)                                                                                                                                                     | **Not implemented.** Read-only `nodes`/`scan` may be added once their payloads are documented.                        |
| "comWinStack API" landing page                                                                     | HTTP 200 with HTML                                                                     | unknown                      | newer InfoWIN (windhager-tools README)                                                                                                                                                   | **Unsupported.** Reported as `malformed` ("does not look like a supported InfoWIN REST API").                         |
| Windhager cloud (WindhagerConnect / myComfort)                                                     | n/a                                                                                    | account                      | n/a                                                                                                                                                                                      | **Deliberately not used.** The adapter is local-only.                                                                 |
| LON bus directly                                                                                   | n/a                                                                                    | n/a                          | n/a                                                                                                                                                                                      | **Not possible** from this adapter; LON variables are only those the controller's web API offers.                     |

## Detection behaviour

`detectProtocol` issues only `GET` requests. Status codes map to:

| Result                   | Cause                                     | Adapter reaction                                   |
| ------------------------ | ----------------------------------------- | -------------------------------------------------- |
| `ok`                     | module list parsed                        | continue                                           |
| `auth`                   | Digest rejected                           | log error, **no automatic retry** (avoid lock-out) |
| `connection` / `timeout` | network                                   | retry with exponential backoff (30 s up to 10 min) |
| `unsupported`            | 404 or other unknown API                  | log error, retry slowly                            |
| `malformed`              | 200 but not JSON (e.g. HTML landing page) | log error, retry slowly                            |

## Request catalogue (what the adapter may send)

| Request                                               | Purpose                                                          | Mutating |
| ----------------------------------------------------- | ---------------------------------------------------------------- | -------- |
| `GET /api/1.0/lookup/1[/node[/fn[/lookup[/member]]]]` | discovery, polling                                               | no       |
| `GET /api/1.0/lookup/<OID>`                           | write read-back                                                  | no       |
| `GET /api/1.0/info/deviceinfo`                        | controller identity                                              | no       |
| `GET /api/1.0/object?OID=`                            | time programs (read-only, experimental)                          | no       |
| `PUT /api/1.0/datapoint`                              | single user value, only when writes are enabled and allow-listed | **yes**  |

Anything else is out of scope, in particular firmware, user, VPN, configuration and test endpoints.
