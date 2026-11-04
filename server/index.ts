import { createApp } from './app.js';
import { getServerConfig } from './config.js';
import { closeSharedBrowser } from './renderer.js';

const cfg = getServerConfig();
const app = createApp();

const server = app.listen(cfg.port, cfg.host, () => {
  console.log(
    `[break-it:api] Listening on http://${cfg.host}:${cfg.port} (Meta API key: ${
      cfg.modelApiKey ? `configured via ${cfg.keySource}` : 'not configured yet (.env.local)'
    })`
  );
});

const shutdown = async () => {
  server.close();
  await closeSharedBrowser();
  process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

