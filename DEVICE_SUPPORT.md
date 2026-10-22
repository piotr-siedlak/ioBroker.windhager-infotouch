# Device support

Levels: **implemented** (code exists) / **fixture-tested** (tests against our synthetic fake server) /
**real-device-tested** (verified by a person against hardware) / **experimental** / **unsupported**.

**Real-device evidence:** read-only discovery, naming, value typing and object reading were verified against an
InfoWIN Touch MB6621 (firmware 0.10.4) with UMUMLZ + ZSP-SOFU modules and an eBUS gas boiler, using a captured
probe replayed in tests. Live polling over hours and any write have **not** been tested on hardware.

| Area                                                          | Implemented                             | Fixture-tested | Real-device-tested | Notes                                                         |
| ------------------------------------------------------------- | --------------------------------------- | -------------- | ------------------ | ------------------------------------------------------------- |
| Digest auth, timeouts, retries, concurrency bound             | yes                                     | yes            | no                 |                                                               |
| Protocol detection                                            | yes                                     | yes            | no                 | one API family                                                |
| Module / function / group / datapoint discovery with metadata | yes                                     | yes            | no                 |                                                               |
| Groups with more than 10 entries (paging)                     | yes                                     | yes            | no                 | **experimental**: contract unverified (RESEARCH P7)           |
| Polling in fast / normal / slow categories                    | yes                                     | yes            | no                 | intervals are untuned defaults                                |
| Offline detection, stale quality, reconnect                   | yes                                     | yes            | no                 |                                                               |
| Discovery cache + invalidation                                | yes                                     | yes            | no                 |                                                               |
| Single-datapoint write with read-back                         | yes (off by default)                    | yes            | no                 | **experimental**; allow-list only                             |
| Time programs                                                 | read-only, verbatim JSON                | yes            | no                 | **experimental**; no interpretation, no write                 |
| LON variables                                                 | raw strings, read-only (off by default) | yes            | no                 | **experimental**                                              |
| Names and enum texts from `/res/xml` text tables              | yes                                     | yes            | no                 | function/module names stay generic until verified on hardware |
| Semantic mapping (boiler / heating circuit / buffer / DHW)    | **no**                                  | -              | -                  | needs real captures per appliance                             |

## Appliance types

| Type                                                                     | Status                                                                                                                             |
| ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| Gas / condensing gas boiler (the maintainer's installation)              | **Untested.** Generic discovery should work if the controller offers the lookup API. Upstream calls this "integrated, unverified". |
| Wood chip (PuroWIN), pellet (BioWIN, PelletsWIN), log (LogWIN, VarioWIN) | Upstream reports third-party diagnostics; **not tested here.**                                                                     |
| Oil, heat pumps (AeroWIN), hybrid, solar, cascades                       | **Unverified** upstream and here. Generic datapoints only.                                                                         |

## Firmware matrix

| Controller | Firmware | Result                                                                         |
| ---------- | -------- | ------------------------------------------------------------------------------ |
| _none yet_ | -        | Please contribute a sanitised capture; see [docs/TESTING.md](docs/TESTING.md). |
