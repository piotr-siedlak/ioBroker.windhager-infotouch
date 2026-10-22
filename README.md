# ioBroker.windhager

Local, capability-driven ioBroker adapter for **Windhager InfoWIN Touch / MES INFINITY** heating controllers.

> **Status: 0.1.0 beta, private, never run against real hardware.** Everything has been tested only against a
> synthetic fake controller. Read [DEVICE_SUPPORT.md](DEVICE_SUPPORT.md) before connecting it to a heating system.

- **Local only** - talks HTTP(S) to the controller on your LAN. No cloud, no WindhagerConnect.
- **Read-only by default.** A write needs two opt-ins from you plus the controller's own writable flag (see below), and is verified by reading back.
- **Discovers what the controller offers** (modules, functions, datapoints, ranges, enums, writable flags) instead
  of hard-coding a boiler model. A gas boiler behind InfoWIN Touch is the maintainer's setup, but upstream projects
  rate gas support as unverified, so nothing gas-specific is promised.
- Language: TypeScript, Node.js >= 20, js-controller >= 5.0.19, Admin >= 6.17.14.

## What you get

```
windhager.0
  info.{connection, controllerModel, firmwareVersion, protocolVersion, lastSuccessfulPoll, lastError}
  modules.node_<n>.fn_<f>.grp_<l>.dp_<member>_<instance>     one state per discovered datapoint
  lon.node_<n>...nv_<i>                                      optional, raw, read-only
  schedules.<key>                                            optional, verbatim JSON, read-only, experimental
  raw.<key>                                                  optional, unconverted strings
  diagnostics.{requests, failures, lastLatencyMs, avgLatencyMs, consecutiveFailures, datapoints, catalogAgeHours, rescan}
```

Ids are built from the controller's numeric OIDs, never from localized names. Native names, units, min/max/step and
enum codes are kept on the objects. See [docs/STATES.md](docs/STATES.md). Friendly aliases such as
`heatingCircuits.hc_1` are **not** created yet because their meaning is unverified for gas appliances.

## Install (from GitHub, while private)

```bash
cd /opt/iobroker
npm install git+ssh://git@github.com/piotr-siedlak/ioBroker.windhager-infotouch.git
iobroker upload windhager
iobroker add windhager
```

Details: [docs/INSTALLATION.md](docs/INSTALLATION.md), settings: [docs/CONFIGURATION.md](docs/CONFIGURATION.md).

## Safety model

1. `writesEnabled` is **off**. Nothing is ever written at startup.
2. A state is writable only if **all** hold: writes enabled, the OID is on your allow-list, the controller flags the
   datapoint as writable.
3. Values are validated (number, enum membership, min/max, step) before sending.
4. Success is reported only after the controller returns the new value on read-back.
5. No raw OID write exists. Combustion, safety, service and actuator-test functions are out of scope.

Use only for ordinary user parameters such as a room setpoint or an operating mode, and check the controller's
behaviour on a non-critical value first.

## Quality gates

```bash
npm run check        # typecheck + lint + 73 unit/integration tests + package tests
npm run build
```

## Credits and licence

MIT, see [LICENSE](LICENSE). Protocol knowledge comes from reading the community projects
[HeatNexus](https://github.com/xIceTea/HeatNexus) (GPL-3.0, no code reused),
[windhager-tools](https://github.com/wiesi12/windhager-tools) (MIT),
[ha-windhager](https://github.com/vermi0ffh/ha-windhager) and
[windhager-rest-api-documentation](https://github.com/domfie/windhager-rest-api-documentation). See
[RESEARCH.md](RESEARCH.md) for the evidence and licence audit. Not affiliated with Windhager.

Documents: [RESEARCH](RESEARCH.md) - [ARCHITECTURE](ARCHITECTURE.md) - [API compatibility](API_COMPATIBILITY.md) -
[Device support](DEVICE_SUPPORT.md) - [Security](SECURITY.md) - [Testing](docs/TESTING.md) -
[Troubleshooting](docs/TROUBLESHOOTING.md) - [Polski](README_PL.md)
