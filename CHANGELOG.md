# Changelog

## 0.3.0 (unreleased)

Based on a read-only probe of a real InfoWIN Touch MB6621 (firmware 0.10.4) and the controller's own Swagger docs.

- **Breaking - fix:** OIDs are `/<subnet>/<node>/<function>/<group>/<member>/<instance>`. Earlier versions read the
  4th segment as the menu level, which filed states under non-existent `grp_*` channels and broke name lookup.
  State ids are now `modules.node_<n>.fn_<f>.<GG-MMM>` (the controller's own code, e.g. `03-051`). Old objects are
  marked stale, not deleted; delete `modules.*.grp_*` by hand if you like.
- Fix: single-datapoint read uses `GET /api/1.0/datapoint<OID>` (documented route) instead of `/lookup<OID>`.
- Names combine menu level and variable like the controller UI ("Heating limits: Max. flow temp.").
- Enum texts are applied to integer datapoints without an `enum` list ("Off / 0 to 10V / PWM").
- Dates and times (`22.10.2026`, `14:54`) are text states; numeric-only unit ids are no longer shown as units.
- Structured objects (versions, function names, time programs) are read via `/api/1.0/object` into the same tree;
  the separate `schedules.*` tree is gone.
- Datapoints that only the controller cache knows (actual room/flow temperature, time programs, operation mode)
  are discovered and polled individually.
- New docs: `docs/API_REFERENCE.md` (all 201 controller operations, classified), `docs/DATAPOINTS_MB6621.md`.
- Tests against a sanitised real-device capture (`test/fixtures/mb6621-real.json`).
- Each datapoint object carries `native.group`, the poll group key for the "Groups polled fast" setting.
- The per-datapoint group of cache-only main-screen values is polled as "normal" (not "slow") by default.
- All documentation rewritten against the real controller: verification status, state layout, configuration,
  installation and upgrade notes, troubleshooting, testing and capture procedure.

## 0.2.0 (unreleased)

- Readable names: datapoints, menu groups and enum values are named from the controller's own text tables
  (`/res/xml/VarIdentTexte`, `EbenenTexte`, `AufzaehlTexte`), keyed by the `groupNr`/`memberNr` the API reports.
  New option "Language of names" (default: ioBroker system language, fallback English, then German).
- Generic API names ("02-010", "Knoten 15", "Funktion 14-0") are no longer used as labels.
- State objects now carry `common.desc` (OID and group-member code) and `native.groupNr/memberNr/nativeName`.
- Discovery cache schema v3 (language is part of the cache fingerprint); first start after the update rescans.
- Object ids are unchanged.

## 0.1.2 (unreleased)

- **Breaking:** adapter renamed from `windhager` to `windhager-infotouch` (package `iobroker.windhager-infotouch`,
  objects `windhager-infotouch.0.*`) to match the repository name. Installing from GitHub failed with
  `Cannot install ...: 0` because ioBroker derives the adapter name from the repository name.
- The compiled `build/` folder is committed so GitHub installs work without a build step.

## 0.1.1 (unreleased) - review fixes

- Fix: an empty poll category (default: no fast groups) reset the failure counter, so an outage was never reported.
- Fix: one persistently failing group no longer marks the controller offline; failing groups are skipped per cycle.
- Fix: a failing paging request no longer discards the first page; paging de-duplicates all item kinds (LON included).
- Fix: duplicate polling chains when a category ran while already scheduled; concurrent runs are coalesced.
- Fix: a failed manual rescan stopped polling permanently.
- Fix: discovery cache is invalidated when LON or module-exclusion settings change (cache schema v2).
- Fix: diagnostics export leaked the controller IP through error texts.
- Fix: `npm test` glob did not work on Node 20.
- Hardening: total request deadline (slow-drip responses), bounded write read-back retries,
  test-connection no longer transmits the password.

## 0.1.0 (unreleased)

Initial beta, synthetic-fixture tested only.

- Digest HTTP client, protocol detection, read-only discovery, discovery cache.
- Dynamic states with native metadata; stale marking; quality flags.
- Polling with fast/normal/slow categories, backoff, offline detection, auth-failure stop.
- Opt-in single-datapoint writes with allow-list, validation and read-back.
- Read-only time program and LON reading (experimental).
- Admin JSON config in English, Polish and German; diagnostics export.
