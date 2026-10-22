# Changelog

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
