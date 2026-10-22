# Security

## Reporting

Please report vulnerabilities privately to siedlak.piotr@gmail.com rather than in a public issue.

## Threat model and measures

The controller is part of a heating system. The adapter therefore fails closed.

| Topic               | Measure                                                                                                                                                                                                                          |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Credentials         | `password` is in `encryptedNative` and `protectedNative`. Log lines pass through `scrub()` which also removes the configured password literal. Authorization headers are never logged or stored in diagnostics.                  |
| Digest              | Implemented on MD5 because the device uses it; digest does not encrypt measurement data. Keep the controller on a trusted LAN/VLAN. Do not expose it to the Internet.                                                            |
| Lock-out            | Authentication failures are never retried automatically; polling stops.                                                                                                                                                          |
| TLS                 | If HTTPS is used, certificates are verified. Disabling needs an explicit `verifyTls = false` (only boolean `false` counts).                                                                                                      |
| Default credentials | The adapter never tries `USER`/`123` or any default (manual p. 7 lists them). Change factory credentials on the device.                                                                                                          |
| Writes              | Disabled by default; allow-list of exact OIDs; controller flag; validation; serialised; read-back; audit log without credentials; PUT never auto-retried. No raw OID write, no firmware/user/VPN/config/actuator-test endpoints. |
| Input               | All controller JSON is treated as untrusted and parsed defensively; OIDs must match a strict pattern; responses are capped at 4 MiB; config values are clamped.                                                                  |
| Network scope       | Requests go only to the configured host. The adapter opens no inbound port and starts no broker or database.                                                                                                                     |
| Diagnostics export  | IP/host and Neuron/program IDs are masked, no values or credentials are included.                                                                                                                                                |
| Supply chain        | One runtime dependency. Run `npm run audit:deps`. Dependabot is configured in `.github/dependabot.yml`.                                                                                                                          |
| Cloud               | WindhagerConnect/myComfort are not used.                                                                                                                                                                                         |

Dependency audit (2026-10-22, `npm audit --omit=dev`): 3 high findings, all the same chain -
`node-forge` (RSA PKCS#1 v1.5 signature verification, GHSA-86w9-cpqp-85rv) via
`@iobroker/js-controller-common-db` via `@iobroker/adapter-core@3.4.3`. This adapter does not call node-forge and
the offered "fix" would downgrade adapter-core, so it is left to the ioBroker maintainers; the CI audit step is
informational. Re-check on each adapter-core release.

Known limitations: MD5 Digest is weak against active attackers on the LAN; the controller's own lock-out and rate-limit
behaviour is undocumented; no real-device security testing has been done.
