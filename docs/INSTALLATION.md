# Installation

## Prerequisites

- ioBroker with js-controller >= 5.0.19, Admin >= 6.17.14, Node.js >= 20.
- The InfoWIN Touch is reachable from the ioBroker host over the LAN (RJ45), with a fixed or reserved IP. The
  controller must be reachable from the _host_ (not only from your PC): on macOS the app that runs tests needs the
  "Local Network" permission.
- An account on the controller's local web server. Prefer the **end-user** account (default name `USER`) over `Service`.
  If the device still has factory credentials, change them first (manual p. 7); the adapter never tries defaults. The
  password is stored encrypted.
- The LAN must not use 10.254.253.x, 10.8.x.x or 10.9.x.x (reserved by the controller, manual p. 67).
- Recommended: put the controller in its own VLAN, reachable only from the ioBroker host.

## Install while the repository is private

The ioBroker host needs an SSH key with read access to the repository. The adapter name (`windhager-infotouch`) must
equal the repository name `ioBroker.windhager-infotouch`: ioBroker derives it from the URL.

```bash
cd /opt/iobroker
iobroker url https://github.com/piotr-siedlak/ioBroker.windhager-infotouch
```

Alternatively, in Admin use "Install from custom URL" (GitHub tab), or:

```bash
cd /opt/iobroker
npm install git+ssh://git@github.com/piotr-siedlak/ioBroker.windhager-infotouch.git
iobroker upload windhager-infotouch
iobroker add windhager-infotouch
```

The compiled `build/` folder is committed, so no build step is needed on the host.

### Upgrading from earlier versions

- **From 0.1.x (adapter name `windhager`)**: this is a different adapter name. Remove the old package and instance
  first: `iobroker del windhager`, `npm uninstall iobroker.windhager`. Nothing is stored on the controller.
- **From 0.2.x**: state ids changed in 0.3.0 (the OID layout was misread before). After the update the old
  `modules.*.grp_*` states are marked stale and stay in place; delete them in the Objects tab once the new tree looks
  right. History of old states stays under the old ids. Scripts and charts must be repointed to the new ids
  (`modules.node_15.fn_0.03-051` style).
- The first start after any update runs a fresh discovery (cache schema changed).

## First run

1. Open the instance settings, enter host, user and password, press **Test connection**. The result shows the
   detected API family and the controller's reported device and firmware (for example `MB6621 0.10.4`).
2. Save. The first start performs a read-only discovery (a few dozen requests on a small system) and caches it. The log
   should say `Names loaded from controller (en): ... datapoint ... enum texts` and `Objects ready: N datapoints`.
3. `info.connection` turns `true` after the first successful poll cycle (up to about a minute).
4. Browse `modules.*`. About 15 minutes after the start the module versions and time programs appear.
5. Leave **Allow writes** off until you have read [CONFIGURATION.md](CONFIGURATION.md).

## Uninstall

`iobroker del windhager-infotouch` removes instances; `npm uninstall iobroker.windhager-infotouch` removes the
package. Objects can be deleted from the Objects tab; nothing is stored on the controller.
