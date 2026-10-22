# ioBroker.windhager-infotouch

Local ioBroker adapter for **Windhager InfoWIN Touch / MES INFINITY** heating controllers. It discovers what your
controller offers and publishes it as states with the controller's own names, units and ranges. **Read-only by
default.**

> **Status: 0.3.0 beta, private repository.** Discovery, names, value types and structured objects were verified
> against one real controller (InfoWIN Touch MB6621, firmware 0.10.4, with an eBUS gas boiler) using read-only
> requests. Long-running polling on a live ioBroker host and **all writes are untested on hardware**. Read
> [DEVICE_SUPPORT.md](DEVICE_SUPPORT.md) before connecting it to a heating system.

## Features

- **Local only.** HTTP(S) to the controller on your LAN. No cloud, no WindhagerConnect, no inbound ports.
- **Discovery.** Modules, functions, menu groups and datapoints, with unit, min/max/step, enum and writable flag.
  Cached between restarts; re-discovered when the module list, firmware, language or discovery options change.
- **Readable names** from the controller's own text tables (`/res/xml`), in your ioBroker language (fallback English,
  then German): "Room temp. set points: Heating mode", "Heating limits: Max. flow temp.", enum values such as
  "Stand-by" or "Mixer - Radiators". Ids never depend on names.
- **Typed values.** Temperatures, minutes, percent, enums with texts, dates and times as text, versions as text,
  time programs as verbatim JSON, `-.-` placeholders as `null`.
- **Polling** in fast / normal / slow categories with backoff, offline detection (quality flag, last values kept),
  automatic recovery, and a stop on authentication failure so the controller account is not locked.
- **Safe writes (opt-in).** Two opt-ins from you plus the controller's own writable flag; validated and verified by
  reading back. See below.
- **Diagnostics** states and an anonymised export (masked host and serials, no values, no credentials).
- Admin UI in English, Polish and German. TypeScript, Node.js >= 20, js-controller >= 5.0.19, Admin >= 6.17.14.

## Object tree

```
windhager-infotouch.0
  info.{connection, controllerModel, firmwareVersion, protocolVersion, lastSuccessfulPoll, lastError}
  modules.node_<n>.fn_<f>.<GG-MMM>[_<i>]     one state per datapoint, e.g. modules.node_15.fn_0.03-051
  lon.node_<n>.nv_<i>                        optional, raw, read-only
  raw.<key>                                  optional, unconverted strings
  diagnostics.{requests, failures, lastLatencyMs, avgLatencyMs, consecutiveFailures, datapoints, catalogAgeHours, rescan}
```

`GG-MMM` is the controller's own variable code (group-member): the API reports it as the datapoint's native name, and
the controller's text tables are keyed by it. Node and function
folders carry the controller's names (for example "UMLZ (1)"). Details: [docs/STATES.md](docs/STATES.md). A complete
real example is in [docs/DATAPOINTS_MB6621.md](docs/DATAPOINTS_MB6621.md).

What you get depends on the installation. A gas boiler attached over eBUS shows up through the regulation modules and
exposes mainly set points, temperatures, pump/mixer states and time programs; it does **not** offer burner modulation
or operating hours. Friendly aliases (`boiler`, `heatingCircuit`, ...) are not created: their mapping to controller
function types is unverified (see [RESEARCH.md](RESEARCH.md) section 4).

## Install (from GitHub, while the repository is private)

The ioBroker host needs an SSH key with read access.

```bash
cd /opt/iobroker
iobroker url https://github.com/piotr-siedlak/ioBroker.windhager-infotouch
```

or `npm install git+ssh://git@github.com/piotr-siedlak/ioBroker.windhager-infotouch.git` followed by
`iobroker upload windhager-infotouch` and `iobroker add windhager-infotouch`. The compiled `build/` folder is
committed, so no build step is needed. More: [docs/INSTALLATION.md](docs/INSTALLATION.md),
[docs/CONFIGURATION.md](docs/CONFIGURATION.md).

## Safety model

1. `writesEnabled` is **off**. Nothing is ever written at startup.
2. A state is writable only if **all** hold: writes enabled, the exact OID is on your allow-list, and the controller
   marks the datapoint as writable. (On the reference controller 58 of 78 datapoints are marked writable, including
   installer settings - the controller flag alone is not a safety statement.)
3. Values are validated (number, enum membership, min/max, step) before sending. A value outside the reported range is
   refused - including any non-zero value for a datapoint whose reported range is 0..0.
4. Success is reported only after the controller returns the new value on read-back (up to 3 reads).
5. There is no raw OID write. Combustion, safety, service, actuator-test, user, VPN, firmware and configuration
   endpoints of the controller are never called ([docs/API_REFERENCE.md](docs/API_REFERENCE.md)).

Use writes only for ordinary user parameters (room set point, operating mode) and test one value first.

## Quality gates

```bash
npm run check            # typecheck + lint + 90 unit tests + 53 package-file checks
npm run build
npm run test:integration # starts the adapter in a real js-controller (needs the build)
```

## Documentation

[Installation](docs/INSTALLATION.md) - [Configuration](docs/CONFIGURATION.md) - [States](docs/STATES.md) -
[Datapoints of a real installation](docs/DATAPOINTS_MB6621.md) - [Controller API reference](docs/API_REFERENCE.md) -
[Troubleshooting](docs/TROUBLESHOOTING.md) - [Testing](docs/TESTING.md) - [Architecture](ARCHITECTURE.md) -
[Research and evidence](RESEARCH.md) - [API compatibility](API_COMPATIBILITY.md) -
[Device support](DEVICE_SUPPORT.md) - [Security](SECURITY.md) - [Contributing](CONTRIBUTING.md) -
[Changelog](CHANGELOG.md) - [Polski](README_PL.md)

## Credits and licence

MIT, see [LICENSE](LICENSE). Protocol knowledge comes from the controller's own Swagger documentation and from reading
the community projects [HeatNexus](https://github.com/xIceTea/HeatNexus) (GPL-3.0, no code reused),
[windhager-tools](https://github.com/wiesi12/windhager-tools) (MIT),
[ha-windhager](https://github.com/vermi0ffh/ha-windhager) and
[windhager-rest-api-documentation](https://github.com/domfie/windhager-rest-api-documentation); licence audit in
[RESEARCH.md](RESEARCH.md). Not affiliated with Windhager.
