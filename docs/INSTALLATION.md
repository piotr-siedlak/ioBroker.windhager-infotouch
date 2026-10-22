# Installation

## Prerequisites

- ioBroker with js-controller >= 5.0.19, Admin >= 6.17.14, Node.js >= 20.
- The InfoWIN Touch is reachable from the ioBroker host over the LAN (RJ45), with a fixed or reserved IP.
- An account on the controller's local web server. Prefer the **end-user** account over `Service`: upstream reports
  identical read scope on the tested series. If the device still has factory credentials, change them on the device
  first (manual p. 7). The adapter will not try defaults.
- The LAN must not use 10.254.253.x, 10.8.x.x or 10.9.x.x (reserved by the controller, manual p. 67).
- Optional but recommended: put the controller in its own VLAN, reachable only from the ioBroker host.

## Install while the repository is private

The ioBroker host needs an SSH key with read access to the repository.

```bash
cd /opt/iobroker
npm install git+ssh://git@github.com/piotr-siedlak/ioBroker.windhager-infotouch.git
iobroker upload windhager
iobroker add windhager
```

If the build output is missing (`build/main.js`), run `npm install && npm run build` inside
`node_modules/iobroker.windhager`; releases will ship `build/` prebuilt.

## First run

1. Open the instance settings, enter host, user and password, press **Test connection**. The result shows the
   detected API family and the controller's reported device/version.
2. Save. The first start performs a read-only discovery (can take a minute or more on large systems) and caches it.
3. Check `info.connection`, then browse `modules.*`.
4. Leave **Allow writes** off until you have read [CONFIGURATION.md](CONFIGURATION.md).

## Uninstall

`iobroker del windhager` removes instances. Objects can be deleted from the Objects tab; nothing is stored on the controller.
