# States

What exists depends on your controller; the lists below describe the structure, `docs/DATAPOINTS_MB6621.md` is a
complete real example.

## Fixed

| State                                           | Type    | Meaning                                                                                          |
| ----------------------------------------------- | ------- | ------------------------------------------------------------------------------------------------ |
| `info.connection`                               | boolean | polling currently succeeds                                                                       |
| `info.controllerModel` / `info.firmwareVersion` | string  | as the controller reports them (`device`, `version`, e.g. `MB6621` / `0.10.4`)                   |
| `info.protocolVersion`                          | string  | detected API family, `infowin-rest-1.0`                                                          |
| `info.lastSuccessfulPoll`                       | string  | ISO timestamp                                                                                    |
| `info.lastError`                                | string  | last connection/auth message (secrets scrubbed)                                                  |
| `diagnostics.*`                                 | number  | request count, failures, latency (last/average), consecutive failures, datapoints, discovery age |
| `diagnostics.rescan`                            | button  | rediscover structure and names                                                                   |

The controller's serial number and check number are never published.

## Modules and datapoints

`modules.node_<nodeId>.fn_<fctId>.<GG>-<MMM>[_<instance>]`

- `node_<n>`: a regulation module (device) - named by the controller, e.g. "UMUMLZ" or "ZSP-SOFU". Modules on another
  LON subnet appear as `node_<subnet>_<n>`.
- `fn_<f>`: a function of the module (channel) - e.g. "UMLZ (1)". Functions the controller marks as locked are
  listed but contain no states.
- `<GG>-<MMM>`: the controller's variable code (group-member, from the OID). Example:
  `modules.node_15.fn_0.03-051` = "Room temp. set points: Heating mode", 20.0 °C.

The controller's menu structure is _not_ part of the id (an OID does not contain it). It is part of the name and of
`native.levelId`.

| Object field                                                          | Source                                                                                                                                                                                                               |
| --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `common.name`                                                         | controller texts: menu level + variable ("Heating limits: Max. flow temp."); else level + code; else the code (`02-002`)                                                                                             |
| `common.desc`                                                         | code, OID and menu level                                                                                                                                                                                             |
| `common.type`                                                         | `number` for numeric values, units, ranges and enums; `string` for dates, times, versions and JSON                                                                                                                   |
| `common.role`                                                         | by unit: `°C` -> `value.temperature` (`level.temperature` if writable), `kW` -> `value.power`, `kWh` -> `value.energy`, `bar` -> `value.pressure`; enums -> `value`/`level`; text -> `text`; time programs -> `json` |
| `common.unit` / `min` / `max` / `step`                                | the controller's own unit and metadata, unchanged. A "unit" that is only a number (date/time marker) is dropped                                                                                                      |
| `common.states`                                                       | enum value -> controller text, e.g. `0: Stand-by`; raw code when no text exists                                                                                                                                      |
| `common.write`                                                        | true only if writes are enabled AND the OID is allow-listed AND the controller marks it writable                                                                                                                     |
| `native.oid`, `native.code`                                           | native address and display code                                                                                                                                                                                      |
| `native.group`                                                        | **poll group key** (e.g. `n15.f0.l101`, or `n15.f0.direct`) - use it in "Groups polled fast"                                                                                                                         |
| `native.levelId`, `native.nativeName`                                 | menu level id; the name the API reported (often just the code)                                                                                                                                                       |
| `native.typeId` / `subtypeId` / `unitId` / `writeProtected` / `stale` | raw controller metadata and staleness flag                                                                                                                                                                           |

Values are `ack: true`. Quality `q = 0` when fresh; `0x42` when the controller is offline (the last value is kept) or
the datapoint disappeared after a rescan (`native.stale = true`, value `null`). Placeholders (`-`, `-.-`, empty)
become `null` - for example a sensor that is not connected.

### Value types seen on a real controller

| Controller `typeId` | Meaning                                  | Published as                                           |
| ------------------- | ---------------------------------------- | ------------------------------------------------------ |
| 13                  | number with unit (°C, K, min, d, %)      | number                                                 |
| 0, 1                | integers, switches, outputs, small enums | number, with texts when the controller has them        |
| 9                   | enum with explicit value list            | number + `common.states`                               |
| 4                   | date, time, duration                     | duration (minutes) as number; date and time as string  |
| 30                  | structured object                        | string: text (versions, names) or JSON (time programs) |

Structured objects are read every 15 minutes via `/api/1.0/object`; time programs are stored verbatim, e.g.
`[{"switchPoints":[{"time":"06:00","value":20},...],"weekdays":["Mo","Tu",...]}]`, and not interpreted or written.

## Optional trees

- `lon.node_<n>.nv_<i>` - LON network variables (opt-in): raw strings, `native.snvtName` kept, no scaling applied.
- `raw.<key>` - the unconverted controller string of each datapoint (opt-in).

## Using the data

- **Scripts**: subscribe with a selector such as `windhager-infotouch.0.modules.node_15.*`, or find a state by
  `native.oid`.
- **InfluxDB / history**: enable history on the numeric states you need; original units are kept.
- **MQTT**: any MQTT adapter can publish the `modules.*` tree; the adapter itself runs no broker.
- **Grafana**: query by state id; use `common.name` for panel titles.
- Derived values (for example flow minus return) are not computed; create them in a script with an explicit formula.
- Not available on a gas boiler behind UMUMLZ/ZSP-SOFU (checked on the reference controller): burner modulation, flame,
  gas consumption, operating hours, error messages.
