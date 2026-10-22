# Device support

Levels: **implemented** (code exists) / **fixture-tested** (automated tests against a fake controller) /
**real-device-verified** (observed on hardware, see below) / **experimental** / **unsupported**.

## What was verified on hardware, and how

One real controller, read-only, on 2026-10-22: **InfoWIN Touch MB6621, firmware 0.10.4**, LON subnet 1 with node 14
`ZSP-SOFU` (pump/relay module, external heating demand) and node 15 `UMUMLZ` (mixer heating circuit `UMLZ (1)` and
DHW; `UM (2)` locked), a **gas boiler attached over eBUS**. Method: a GET-only probe (every request path checked
against an allow-list of reads, ~145 requests), then a live smoke run of the adapter's own discovery code (60 GET
requests, no other method). The responses were sanitised into `test/fixtures/mb6621-real.json` and are replayed in
tests. **Nothing was ever written to the controller.**

| Area                                                                        | Implemented          | Fixture-tested | Real-device-verified | Notes                                                                                         |
| --------------------------------------------------------------------------- | -------------------- | -------------- | -------------------- | --------------------------------------------------------------------------------------------- |
| Digest auth with the end-user account                                       | yes                  | yes            | **yes**              |                                                                                               |
| API detection (`lookup/1`, `deviceinfo`)                                    | yes                  | yes            | **yes**              | one API family                                                                                |
| Discovery of modules / functions / menu groups / 78 datapoints              | yes                  | yes            | **yes**              | locked function `UM (2)` skipped                                                              |
| Cache-only datapoints (`/api/1.0/datapoints`)                               | yes                  | yes            | **yes**              | 10 values no menu lists (actual room/flow temperature, time programs, operation mode)         |
| OID layout `/<subnet>/<node>/<fn>/<group>/<member>/<inst>`                  | yes                  | yes            | **yes**              | corrected in 0.3.0                                                                            |
| Names, enum texts (de/en/fr/it tables)                                      | yes                  | yes            | **yes**              | Polish tables do not exist on this controller: fallback to English                            |
| Value typing: numbers, units, enums, dates/times, `-.-`                     | yes                  | yes            | **yes**              |                                                                                               |
| Structured objects: versions, function names, time programs (read)          | yes                  | yes            | **yes**              | time programs stored verbatim, no interpretation                                              |
| LON variable structure                                                      | yes (off by default) | yes            | **partly**           | 87 variables listed; per-variable value read for two variables; raw strings, no SNVT decoding |
| Paging for groups over 10 entries                                           | yes                  | yes            | not needed           | groups of 58 arrived complete; kept for other firmware, **experimental**                      |
| Polling over hours, offline/recovery, quality flags in a real js-controller | yes                  | yes            | **no**               | integration test only checks start-up without a host                                          |
| Single-datapoint **write** with read-back                                   | yes (off by default) | yes            | **no**               | experimental; never exercised on hardware                                                     |
| Error log / heartbeat services                                              | no                   | -              | -                    | the controller answers HTTP 503 for both                                                      |
| Semantic mapping (boiler / heating circuit / DHW aliases)                   | **no**               | -              | -                    | needs captures of more installations                                                          |

## Appliance types

| Type                                                         | Status                                                                                                                                                                    |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Gas boiler on eBUS behind UMLZ + ZSP-SOFU (MB6621 0.10.4)    | **Works for reading** (discovery, names, values). Exposes set points, temperatures, pump/mixer state, time programs. No modulation, flame, gas or operating-hours values. |
| Wood chip (PuroWIN), pellet (BioWIN), log (LogWIN, VarioWIN) | Upstream projects report them; **not tested here.** Expect many more datapoints (LON NV list, burner values).                                                             |
| Oil, heat pumps (AeroWIN), hybrid, solar, cascades           | **Unverified** upstream and here. Generic datapoints only.                                                                                                                |

## Firmware matrix

| Controller                                                        | Firmware | Result                                                                                                         |
| ----------------------------------------------------------------- | -------- | -------------------------------------------------------------------------------------------------------------- |
| InfoWIN Touch MB6621 + UMUMLZ + ZSP-SOFU (eBUS gas boiler)        | 0.10.4   | Read path verified (see above). 78 datapoints, 87 LON variables, 10 objects. Writes and long polling untested. |
| Other models/firmware (BioWIN 2, "comWinStack" landing page, ...) | -        | Unknown. Please contribute a sanitised capture; see [docs/TESTING.md](docs/TESTING.md).                        |
