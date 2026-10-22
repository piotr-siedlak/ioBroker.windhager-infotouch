# States

Names below are generated from discovery; **nothing here is a promise that a given controller has it**.

## Fixed

| State                                           | Type    | Meaning                                                                                                 |
| ----------------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------- |
| `info.connection`                               | boolean | polling currently succeeds                                                                              |
| `info.controllerModel` / `info.firmwareVersion` | string  | exactly as the controller reports (`deviceinfo`)                                                        |
| `info.protocolVersion`                          | string  | detected API family, e.g. `infowin-rest-1.0`                                                            |
| `info.lastSuccessfulPoll`                       | string  | ISO timestamp                                                                                           |
| `info.lastError`                                | string  | last connection/auth message (secrets scrubbed)                                                         |
| `diagnostics.*`                                 | number  | request count, failures, latency (last/avg), consecutive failures, discovered datapoints, discovery age |
| `diagnostics.rescan`                            | button  | rediscover structure                                                                                    |

## Dynamic

`modules.node_<nodeId>.fn_<fctId>.<GG>-<MMM>[_<instance>]` - `GG-MMM` is the controller's own code (group-member, as
shown in its service menus and in `docs/DATAPOINTS_MB6621.md`). Subnets other than 1 appear as `node_<subnet>_<node>`.

Example (real): `modules.node_15.fn_0.03-051` = "Room temp. set points: Heating mode", 20.0 °C.

| Object field               | Source                                                                                                                                                                                        |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `common.name`              | controller text table (VarIdentTexte by group/member) in the chosen language; else a meaningful API name; else `OID ...`                                                                      |
| `common.desc`              | OID and group-member code, e.g. `/1/16/0/3/21/0 (3-21)`                                                                                                                                       |
| `common.type`              | `number` for enums / unit / range / numeric value, else `string`                                                                                                                              |
| `common.role`              | by unit: `°C` -> `value.temperature` (`level.temperature` if writable), `kW` -> `value.power`, `kWh` -> `value.energy`, `bar` -> `value.pressure`; enums -> `value` / `level`; text -> `text` |
| `common.unit/min/max/step` | native unit and metadata, unchanged                                                                                                                                                           |
| `common.states`            | enum code -> controller text (AufzaehlTexte); raw code when no text exists                                                                                                                    |
| `common.write`             | true only if writes enabled AND allow-listed AND controller-writable                                                                                                                          |
| `native`                   | `key`, `oid`, `groupNr`, `memberNr`, `nativeName`, `typeId`, `subtypeId`, `unitId`, `writeProtected`, `stale`                                                                                 |

Values are `ack: true`. Quality `q = 0` when fresh, `0x42` when the controller is offline (last value kept) or the
datapoint disappeared after a rescan (`native.stale = true`; the value is set to `null`, history adapters keep past values). Placeholder values (`-`, empty) become `null`.

Structured objects (typeId 30: versions, function names, time programs) live in the same tree; their value is read
every 15 min via `/api/1.0/object` (text, or verbatim JSON for time programs). Optional trees: `raw.<key>` (strings),
`lon.node_<n>.nv_<i>` (raw strings with `native.snvtName`).

## Using the data

- **Scripts**: subscribe to `windhager-infotouch.0.modules.*` with the usual selector, or look up by `native.oid`.
- **InfluxDB / history**: enable history on the numeric states you need; the original units are preserved.
- **MQTT**: any MQTT adapter can publish the `modules.*` tree; the adapter itself runs no broker.
- **Grafana**: query the Influx measurement by state id; use `common.name` / `native.oid` to label panels.
- Derived values (e.g. flow minus return) are not computed. Create them in a script with an explicit formula.
