# Contributing

1. Never run anything mutating against a production heating system. Use the fake controller
   (`test/helpers/FakeController.ts`) and the real-device capture (`test/fixtures/mb6621-real.json`).
2. `npm run check` must pass (typecheck, lint, unit tests, package tests). After `npm run build`, also
   `npm run test:integration` where js-controller is available.
3. **Commit `build/`**: it is what gets installed from GitHub. CI fails if `build/` differs from a fresh `npm run build`.
4. Keep layers separate: no ioBroker imports outside `src/main.ts`. Identity of states comes from OIDs only, never
   from names.
5. Do not copy code from GPL projects (HeatNexus). Protocol _facts_ with a source and an evidence level go to
   `RESEARCH.md`; the controller's own Swagger documentation (`/api-docs`) is the primary source.
6. New device claims need evidence: a sanitised capture (replace IPs, Neuron/program IDs, serial and check number,
   credentials) under `test/fixtures/`, a real-device test, and an honest entry in `DEVICE_SUPPORT.md` stating the
   firmware. See [docs/TESTING.md](docs/TESTING.md) for a read-only capture procedure.
7. Never make a state writable by default. Writes need metadata authorisation, validation and read-back tests.
8. Update the docs with the change: `CHANGELOG.md`, `docs/STATES.md` for new states, `docs/CONFIGURATION.md` for new
   options, `docs/DATAPOINTS_MB6621.md` via `node --import tsx tools/datapoint-map.ts`.
