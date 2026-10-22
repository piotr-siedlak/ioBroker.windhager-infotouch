# Contributing

1. Do not run anything mutating against a production heating system. Use the fake controller (`test/helpers/FakeController.ts`).
2. `npm run check` must pass (typecheck, lint, unit tests, package tests). `npm run test:integration` after `npm run build` where js-controller is available.
3. Keep layers separate: no ioBroker imports outside `src/main.ts`.
4. Do not copy code from GPL projects (HeatNexus). Protocol _facts_ with a source and evidence level go to `RESEARCH.md`.
5. New device claims need evidence: a sanitised capture (mask IPs, Neuron/program IDs, credentials) under `test/fixtures/` and an entry in `DEVICE_SUPPORT.md` stating the level honestly.
6. Never make a state writable by default. Writes need metadata authorisation, validation and read-back tests.
