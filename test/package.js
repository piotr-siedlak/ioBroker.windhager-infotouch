const path = require('path');
const { tests } = require('@iobroker/testing');

// Validates package.json / io-package.json consistency exactly as the ioBroker CI does.
tests.packageFiles(path.join(__dirname, '..'));
