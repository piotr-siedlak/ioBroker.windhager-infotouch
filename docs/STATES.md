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

`modules.node_<nodeId>.fn_<fctId>.grp_<lookupId>.dp_<memberId>_<instance>`

Example (synthetic): `modules.node_16.fn_0.grp_3.dp_21_0`

| Object field               | Source                                                                                                                                                                                        |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `common.name`              | native label (may repeat), else `OID ...`                                                                                                                                                     |
| `common.type`              | `number` for enums / unit / range / numeric value, else `string`                                                                                                                              |
| `common.role`              | by unit: `°C` -> `value.temperature` (`level.temperature` if writable), `kW` -> `value.power`, `kWh` -> `value.energy`, `bar` -> `value.pressure`; enums -> `value` / `level`; text -> `text` |
| `common.unit/min/max/step` | native unit and metadata, unchanged                                                                                                                                                           |
| `common.states`            | enum **codes** (native texts not loaded yet)                                                                                                                                                  |
| `common.write`             | true only if writes enabled AND allow-listed AND controller-writable                                                                                                                          |
| `native`                   | `key`, `oid`, `typeId`, `subtypeId`, `unitId`, `writeProtected`, `stale`                                                                                                                      |

Values are `ack: true`. Quality `q = 0` when fresh, `0x42` when the controller is offline (last value kept) or the
datapoint disappeared after a rescan (`native.stale = true`; value `null`). Placeholder values (`-`, empty) become `null`.

Optional trees: `raw.<key>` (strings), `lon.node_..nv_<i>` (raw strings with `native.snvtName`), `schedules.<key>` (verbatim JSON, experimental).

## Using the data

- **Scripts**: subscribe to `windhager.0.modules.*` with the usual selector, or look up by `native.oid`.
- **InfluxDB / history**: enable history on the numeric states you need; the original units are preserved.
- **MQTT**: any MQTT adapter can publish the `modules.*` tree; the adapter itself runs no broker.
- **Grafana**: query the Influx measurement by state id; use `common.name` / `native.oid` to label panels.
- Derived values (e.g. flow minus return) are not computed. Create them in a script with an explicit formula.
