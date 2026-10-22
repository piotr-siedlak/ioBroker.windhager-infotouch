# Research log and evidence matrix

Research date: 2026-10-22. This file separates **what a source states** from **what has been verified**.
Sections 1-3 record the desk research (community projects, vendor manual). Section 3a records what a read-only probe
of a real InfoWIN Touch MB6621 (firmware 0.10.4) confirmed or corrected. Verification status per feature is in
[DEVICE_SUPPORT.md](DEVICE_SUPPORT.md).

Evidence levels used below:

| Level                    | Meaning                                                                                                   |
| ------------------------ | --------------------------------------------------------------------------------------------------------- |
| **manual**               | Stated in the vendor PDF. Says nothing about protocol paths.                                              |
| **community-tested**     | A community project's author reports using it against their own hardware. Not reproduced by us.           |
| **community-documented** | Written down by a community project without a stated test.                                                |
| **fixture-tested**       | Exercised by this repo's tests against a fake server (synthetic fixture, or the sanitised real capture).  |
| **real-device-verified** | Observed on the maintainer's InfoWIN Touch MB6621 (firmware 0.10.4) with a read-only probe on 2026-10-22. |
| **hypothesis**           | Plausible, not relied on.                                                                                 |

## 1. Sources inspected

Source code and commit history were read, not just READMEs. Shallow clones (depth 50) were taken on 2026-10-22.

| Project                                                                                               | Commit read                     | License                                          | Status                                       | How it was used                                                                                                                                                                                                |
| ----------------------------------------------------------------------------------------------------- | ------------------------------- | ------------------------------------------------ | -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [xIceTea/HeatNexus](https://github.com/xIceTea/HeatNexus)                                             | `88989966` (2026-10-20)         | **GPL-3.0** (name/logo excluded via `NOTICE`)    | Active                                       | Read `docs`, `tools/README.md`, `tools/heatnexus_probe.py`, tests/fixture `biowin-1403.json`, capability table. **No code copied.** Used for response shapes, verification levels, polling behaviour (see 3.). |
| [wiesi12/windhager-tools](https://github.com/wiesi12/windhager-tools)                                 | `c2e08768` (2026-08-14)         | **MIT**                                          | README says archived/superseded by HeatNexus | Read `lib/client.py`, `discovery.py`, `reader.py`, `crawler.py`, `models.py`, `resources.py`. Source of the request/response shapes in 3. **No code copied**; implementation here is independent TypeScript.   |
| [vermi0ffh/ha-windhager](https://github.com/vermi0ffh/ha-windhager)                                   | `HEAD` (last commit 2025-01-21) | **None stated** (all rights reserved by default) | Stale                                        | Read only to cross-check `/api/1.0/lookup{oid}` and `/api/1.0/datapoint`. Nothing reused.                                                                                                                      |
| [domfie/windhager-rest-api-documentation](https://github.com/domfie/windhager-rest-api-documentation) | `edee4b30` (2020-07-16)         | **None stated**                                  | Stale, RC7030 on BioWIN                      | Read for the Swagger endpoint list and Digest note. Facts only, no text reused.                                                                                                                                |
| ioBroker template / create-adapter 3.1.5 / dev-docs                                                   | create-adapter 3.1.5            | MIT                                              | Current                                      | Structure followed by hand (see 4.).                                                                                                                                                                           |
| `INFOWIN-TOUCH-Purowin-sterownik.pdf` (Polish, 10/2024)                                               | pp. 7-8, 31-33, 59-67 read      | Vendor manual                                    | n/a                                          | See 2.                                                                                                                                                                                                         |

## 2. Vendor manual (PuroWIN / InfoWIN Touch)

Read via text extraction. It documents the user interface, **not** the HTTP API.

| #   | Claim                                                                                                                                                                                                       | Page      | Level  | Applicability                |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- | ------ | ---------------------------- |
| M1  | InfoWIN Touch has an RJ45 LAN port, a LON / 12 VDC port, a microSD slot (used for software updates), LED and reset button.                                                                                  | 7         | manual | InfoWIN Touch                |
| M2  | Holding reset > 10 s resets the web-server credentials to factory: user `Serwis` and `USER`, password `123`. They are overwritten with a generated secure password when first paired with WindhagerConnect. | 7         | manual | InfoWIN Touch                |
| M3  | The integrated web server auto-connects to the WindhagerConnect cloud over a VPN tunnel; the myComfort app uses it. Local access is not described.                                                          | 8         | manual | InfoWIN Touch + MES INFINITY |
| M4  | Per-circuit/boiler/module _information level_ and _user level_; service level is entered by holding OK for 5 s.                                                                                             | 31-33, 60 | manual | PuroWIN UI                   |
| M5  | The **actuator test** (blower, ignition, ash removal, ...) is for trained service staff only and can cause damage.                                                                                          | 65-66     | manual | PuroWIN                      |
| M6  | The controller reserves 10.254.253.x, 10.8.x.x and 10.9.x.x internally; these ranges must not be used by the LAN.                                                                                           | 67        | manual | InfoWIN Touch                |
| M7  | The device is written for a PuroWIN (wood chips); the manual contains no gas-boiler content.                                                                                                                | whole     | manual | Do not infer gas behaviour   |

Consequences: M2 means installations that were never cloud-paired may still use `USER`/`123` - the adapter never
tries default credentials. M5 is why actuator tests, service parameters and combustion settings are unreachable
from this adapter.

## 3. Protocol evidence

All paths are relative to `http(s)://<host>[:port]`. Auth is HTTP Digest (MD5, `qop=auth`).

| #   | Claim                                                                                                                                                                                                    | Source                                                                                                                             | Controller / firmware                                    | R/W | Level                                | Open questions                                                                                                                                                          |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- | --- | ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1  | Digest authentication, default users `USER` / `Service`                                                                                                                                                  | HeatNexus README; windhager-tools README; domfie README; ha-windhager `aiohelper.py`                                               | BioWIN 2 (InfoWIN Touch 1.0.2 per ha-windhager), PuroWIN | R/W | community-tested                     | Behaviour of the lock-out counter is unknown, so the adapter stops polling on auth failure.                                                                             |
| P2  | `GET /api/1.0/lookup/1` returns modules `{nodeId,name,group,subnet,programId,neuronId}`                                                                                                                  | windhager-tools `discovery.py`; HeatNexus fixture `struktur`                                                                       | BioWIN 2                                                 | R   | community-tested + fixture-tested    | Other series.                                                                                                                                                           |
| P3  | `GET /api/1.0/lookup/1/<node>` returns `{functions:[{fctId,fctType,name,lock}]}`                                                                                                                         | windhager-tools `discovery.py`; HeatNexus fixture `funktionen`                                                                     | BioWIN 2                                                 | R   | community-tested + fixture-tested    | Meaning of `lock` (we treat as "do not read").                                                                                                                          |
| P4  | `GET /api/1.0/lookup/1/<node>/<fn>` returns `[{id,count}]` lookup groups                                                                                                                                 | windhager-tools `discovery.py`                                                                                                     | BioWIN 2                                                 | R   | community-tested + fixture-tested    | -                                                                                                                                                                       |
| P5  | `GET .../<node>/<fn>/<lookup>` returns entries `{OID,value,unit,unitId,typeId,subtypeId,groupNr,memberNr,minValue,maxValue,step,stepId,timestamp,enum,writeProt}`; `enum` is a JSON-encoded _string_     | windhager-tools `reader.py`; HeatNexus fixture                                                                                     | BioWIN 2                                                 | R   | community-tested + fixture-tested    | Units list; `typeId` semantics beyond enums.                                                                                                                            |
| P6  | **Corrected 2026-10-22:** OID is `/<subnet>/<node>/<function>/<group>/<member>/<instance>`; the menu level is not part of it (the first version read segment 4 as the level)                             | controller Swagger `RestApiRC7030/datapoint`; real MB6621 capture                                                                  | MB6621 0.10.4                                            | -   | **real-device-verified**             | -                                                                                                                                                                       |
| P7  | Up to 10 entries per request, paging needed                                                                                                                                                              | HeatNexus `tools/README.md`                                                                                                        | BioWIN 2                                                 | R   | community-documented                 | **Not observed on MB6621 0.10.4**: groups of 58 entries came complete. Defensive paging kept for other firmware.                                                        |
| P8  | Polling is per menu/group, controller answers requests _sequentially_; 3 parallel requests, 30 s timeout, 2 retries used by HeatNexus's probe                                                            | HeatNexus `tools/README.md`                                                                                                        | BioWIN 2                                                 | R   | community-documented                 | Our default is 2 parallel, 15 s timeout. Tune with real data.                                                                                                           |
| P9  | Single datapoint read is `GET /api/1.0/datapoint<OID>` (not `/lookup<OID>`, which addresses menu levels)                                                                                                 | controller Swagger; real capture                                                                                                   | MB6621 0.10.4                                            | R   | **real-device-verified**             | Used for write read-back and cache-only values.                                                                                                                         |
| P10 | `PUT /api/1.0/datapoint` with JSON `{"OID": "...", "value": "<string>"}`; all values are strings; works with the end-user account                                                                        | windhager-tools `client.write` (author: verified 2026-06-29 in browser dev tools); domfie README; ha-windhager                     | BioWIN 2                                                 | W   | community-tested                     | Error body format; whether rejected values return non-2xx (we verify by read-back, never trust 200).                                                                    |
| P11 | `GET /api/1.0/object?OID=<full OID>` returns structured objects (time programs, `typeId` 30) incl. `switchPoints`/`weekdays`                                                                             | windhager-tools `client.get_object` (author: verified 2026-07-28 on own system); HeatNexus fixture `objekte` (status 409 for some) | BioWIN 2                                                 | R   | community-tested (1 installation)    | Payload variants across firmware. We store it verbatim, read-only.                                                                                                      |
| P12 | `PUT /api/1.0/object?node_id&function_id&oid` writes time programs                                                                                                                                       | windhager-tools `client.write_object` ("no-op test, status 200")                                                                   | BioWIN 2                                                 | W   | community-tested (no-op only)        | **Not implemented.** Schedule writes need real-device validation first.                                                                                                 |
| P13 | `GET /api/1.0/info/deviceinfo` returns `{device, version, serialnumber, checknumber}` (object on 0.10.4, list in older samples)                                                                          | real capture; HeatNexus fixture                                                                                                    | MB6621 0.10.4                                            | R   | **real-device-verified**             | Serial is never exported by the adapter.                                                                                                                                |
| P14 | LON network variables appear as lookup entries `{nvName,nvIndex,snvtName,snvtIndex}`; values need one request per variable (`.../<lookup>/<nvIndex>?count=10&offset=0`); ~200 NVs, 25-30 s per full read | windhager-tools `reader.py`, README; HeatNexus `lon.py` (not read in detail)                                                       | BioWIN 2                                                 | R   | community-tested                     | SNVT scaling. Values stay raw strings, `role: text`.                                                                                                                    |
| P15 | `GET /api/1.0/datapoints` returns the controller cache: a superset of the menu tree (main-screen values, time programs)                                                                                  | real capture; HeatNexus probe docs                                                                                                 | MB6621 0.10.4                                            | R   | **real-device-verified**             | Used once per discovery to add datapoints no menu lists; never used for polling.                                                                                        |
| P16 | `GET /res/xml/EbenenTexte_<lang>.xml`, `VarIdentTexte_<lang>.xml` and `AufzaehlTexte_<lang>.xml` provide menu-level, datapoint and enum texts                                                            | windhager-tools `resources.py`                                                                                                     | BioWIN 2                                                 | R   | community-documented, fixture-tested | **Used since 0.2.0**, keyed by group/member number (from the OID) and (`fctType`, menu level id). Real-device-verified: 1434 variable names, all menu datapoints named. |
| P17 | Newer firmware showing a "comWinStack API" landing page is probably incompatible                                                                                                                         | windhager-tools README                                                                                                             | newer InfoWIN                                            | -   | community-documented                 | We report such a response as `malformed` / unsupported rather than guess.                                                                                               |
| P18 | RC7030 REST service is Swagger-documented at `/api-docs` with `config`, `datapoint(s)`, `nodes`, `scan`, `user`, `vpn`, `lookup`, `object`, ports 22/80/111 open                                         | domfie README                                                                                                                      | BioWIN RC7030, 2020                                      | R/W | community-documented                 | **Not used.** `nodes` / `scan` could allow cheaper discovery but their semantics are undocumented; `vpn` / `user` / `config` are write-sensitive.                       |
| P19 | USER and Service accounts return the same scope on the tested series                                                                                                                                     | HeatNexus `tools/README.md`                                                                                                        | BioWIN series                                            | R   | community-documented                 | We recommend the least-privileged user account.                                                                                                                         |

**Status of the table after the real-device probe (MB6621 0.10.4):** P1 (Digest, `USER` account), P2-P6, P8 (requests
answered one after another), P9 (corrected), P11 (read), P13 (corrected), P14 (structure and per-variable value), P15
(corrected) and P16 are **real-device-verified**. P7 (paging) was **not needed**: groups of up to 58 entries came back
complete. P10 (datapoint write), P12 (time-program write) and P17/P18/P19 were **not exercised**; the adapter never
sent a write to the controller.

## 3a. Real controller (2026-10-22)

Read-only probe (GET only, sequential, 0.25 s apart, ~145 requests) of the maintainer's installation: InfoWIN Touch
**MB6621, firmware 0.10.4**, LON subnet 1 with node 14 `ZSP-SOFU` (fctType 20, eBUS, pump/relay module with external
heating demand) and node 15 `UMUMLZ` (fctType 14, eBUS, mixer heating circuit `UMLZ (1)` + DHW; `UM (2)` locked).
The gas boiler is a third-party appliance attached via **eBUS**; it is not a LON node and is seen through these
modules (boiler temperature, external heating demand set points). Node 97 `MB6611 LOP` is the InfoWIN itself
(subnet 2). Findings:

- Text tables exist in de/en/fr/it (no Polish); structures as in P16. Names resolve for all menu datapoints.
- typeId 13 = number with unit; 0/1 = integers/switches/outputs; 9 = enum with `enum` list; 4 = date/time/duration
  (`"22.10.2026"`, `"14:54"`, minutes); 30 = structured object (subtype 9 text such as versions, subtype 14 time
  program) whose value only comes from `/api/1.0/object`.
- Enum texts (AufzaehlTexte) also exist for integer datapoints without an `enum` list.
- Some `unit` fields contain only the unit id (`"20"` date, `"21"` time).
- `-.-` is a "no value" placeholder.
- `/fehlerlog` and `/heartbeat` answer 503; `/lookup/units/{cat}` 404.
- The full API (201 operations, 7 services) is documented by the controller itself: see `docs/API_REFERENCE.md`.

The capture, sanitised, is `test/fixtures/mb6621-real.json`; the resulting datapoint list is `docs/DATAPOINTS_MB6621.md`.

## 4. Gas boilers, other fuels, heat pumps

- HeatNexus classifies gas/oil/condensing boilers, heat pumps, solar and cascades as **"integrated, unverified"**
  (described in its database, never measured). The manual is PuroWIN-only (M7).
- **Verified here:** a gas boiler attached over **eBUS** appears through the regulation modules, not as a LON node of
  its own. On the MB6621 these are node 14 `ZSP-SOFU` (`fctType 20`: pump control, external heating demand with
  analogue/digital set points, relay and speed outputs) and node 15 `UMUMLZ` (`fctType 14`: mixer heating circuit and
  DHW). Boiler temperature and set points are datapoints of node 15. The 78 datapoints of this installation include
  **no** burner modulation, flame, gas consumption or operating-hours values (searched by name); the only fault-related
  one is the node 14 setting "Collective alarm". A gas boiler on eBUS therefore exposes far less than a pellet boiler.
- `fctType 14` also marks heating-circuit functions in the HeatNexus sample installations, so it is a plausible
  "heating circuit" marker; `fctType 20` matches the pump/relay module in HeatNexus' `uml-puffer` sample. These are
  **observations from three installations, not a verified mapping**; the adapter does not use `fctType` for anything
  except looking up menu-level names.
- Consequently the adapter has **no gas-specific mapping**. States are named from the controller's own texts. Semantic
  aliases (`boilers.*`, `heatingCircuits.*`, ...) from the original brief are not created; they would be a profile layer
  on top of the module tree, to be built from captures of more installations.

## 5. Licence audit and attribution

| Item                                  | Finding                                                                       | Decision                                                                                                                                                                                                                                                       |
| ------------------------------------- | ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| HeatNexus is GPL-3.0                  | Copying or translating its code would make this project a GPL-3.0 derivative. | **No HeatNexus code, tables, texts or database content was copied or translated.** Only facts about the wire protocol (paths, field names) were taken, which are not copyrightable expression. Reviewers should confirm via `git log` that nothing was pasted. |
| windhager-tools is MIT                | Reuse is allowed with attribution.                                            | Not needed, since no code was copied. Credited in README as a research source.                                                                                                                                                                                 |
| ha-windhager, domfie docs: no licence | All rights reserved by default.                                               | Facts only. Nothing reused.                                                                                                                                                                                                                                    |
| HeatNexus name/logo                   | Excluded from GPL by `NOTICE`.                                                | Not used.                                                                                                                                                                                                                                                      |
| Fixtures                              | Real captures in HeatNexus `tests/daten` are GPL-covered data.                | Own fixtures only: a synthetic one (`test/fixtures/gasBoiler.ts`) and a sanitised capture of the maintainer's own controller (`test/fixtures/mb6621-real.json`).                                                                                               |
| This project                          | -                                                                             | **MIT** (see `LICENSE`). Chosen because no GPL material is incorporated. This is a good-faith engineering assessment, **not legal advice**. If any HeatNexus code is ever ported, relicense under GPL-3.0 first.                                               |

## 6. Open questions

Answered by the MB6621 probe:

- `writeProt` is a JSON boolean on the wire (the parser still accepts strings).
- Paging was not needed on firmware 0.10.4 (groups of 58 entries arrive complete).
- `lock: true` functions (`UM (2)`) are skipped by the adapter; whether the end-user account could read them is unknown.
- A full discovery plus reads needs about 60 sequential GET requests (live smoke run); no timing was recorded.

Still open (need more hardware or time):

1. Whether other firmware (older BioWIN/InfoWIN, "comWinStack") behaves the same, in particular paging.
2. Request-rate tolerance over days: default intervals (30/60/300 s) are conservative, not measured.
3. Auth lock-out behaviour after repeated failures (the adapter never retries a rejected login).
4. HTTPS: not probed; HeatNexus states there is no local HTTPS option.
5. Write behaviour (`PUT /api/1.0/datapoint`): documented by the controller's Swagger and by community projects, never
   exercised by this project.
6. Meaning of `fctType` values beyond 14 and 20; behaviour of installations with oil/pellet boilers, heat pumps, solar.
7. What the `/fehlerlog` (error log) and `/heartbeat` services return on firmware where they answer; they returned
   HTTP 503 on the MB6621. Error messages are therefore not exposed.
