const path = require('path');
const { tests } = require('@iobroker/testing');

// Starts the built adapter in a real js-controller. Needs `npm run build` first. Without a configured host the
// adapter must start cleanly and stay disconnected; it must never crash or write anywhere.
tests.integration(path.join(__dirname, '..'), {
    defineAdditionalTests({ suite }) {
        suite('startup without configuration', getHarness => {
            it('starts and keeps info.connection false', async function () {
                this.timeout(60000);
                const harness = getHarness();
                await harness.startAdapterAndWait();
                const state = await harness.states.getStateAsync('windhager.0.info.connection');
                if (state && state.val !== false) {
                    throw new Error('info.connection should be false without a configured host');
                }
            });
        });
    },
});
