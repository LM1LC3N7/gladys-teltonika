// -----------------------------------------------------------------------------
// The SDK handlers, wired to the app. Shared by index.js and the tests, so
// the tests run the exact wiring of the container.
// -----------------------------------------------------------------------------

import { ACTIONS, WIDGETS } from './constants.js';

export function registerHandlers(gladys, app, logger) {
  // --- Discovery and device lifecycle --------------------------------------------
  gladys.onScanRequest(() => app.publishDiscovery());
  gladys.onDeviceCreated((device) => app.deviceCreated(device));
  gladys.onDeviceUpdated((device) => app.deviceUpdated(device));
  gladys.onDeviceDeleted((device) => app.deviceDeleted(device));

  // --- Commands: the reboot button only (refused unless allowed) -------------------
  gladys.onSetValue((device, feature, value) => app.setValue(device, feature, value));

  // --- Dashboard widget "Mobile router": built from memory; its Reboot
  // button takes the path of the reboot button (refused unless allowed).
  gladys.onWidgetGet(WIDGETS.ROUTER, ({ settings, language }) =>
    app.widgetContent(settings, language),
  );
  gladys.onWidgetAction(WIDGETS.ROUTER, (actionKey) => app.widgetAction(actionKey));

  // --- Configuration screen button --------------------------------------------------
  gladys.onAction(ACTIONS.TEST, () => app.testConnection());

  // --- Configuration saved by the user: refused credentials are tried again,
  // a new certificate is accepted.
  gladys.onConfigUpdated((config) => {
    logger?.info('Configuration updated: restarting');
    return app.start(config, { force: true });
  });

  // --- Connection lifecycle: (re)start on every connection (status and
  // Discovery sent again), pause while Gladys is away. A refusal, a pause or
  // a changed certificate kept in /data survives both.
  gladys.on('connected', async () => {
    try {
      await app.start(await gladys.getConfig());
    } catch (err) {
      logger?.error(`Start failed: ${err?.message}`);
    }
  });
  gladys.on('disconnected', () => app.stop());
}
