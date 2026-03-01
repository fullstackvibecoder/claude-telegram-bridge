import { createServer } from 'http';
import { createBot } from './bot.js';
import { config, discoverProjects } from './config.js';

async function main() {
  const projects = discoverProjects();
  console.log('Starting Claude Telegram Bridge...');
  console.log(`Projects dir: ${config.projectsDir}`);
  console.log(`Projects found: ${projects.map((p) => p.name).join(', ') || 'none'}`);
  console.log(`Default: ${config.defaultProject || '(first available)'}`);
  console.log(`Allowed users: ${config.telegram.allowedUserIds.join(', ')}`);

  // Start Telegram bot (long polling)
  const bot = createBot();

  bot.catch((err: unknown) => {
    console.error('Bot error:', err);
  });

  await bot.start({
    onStart: () => console.log('Bot is running (long polling)'),
    drop_pending_updates: true,
  });
}

// Health check server for deployment platforms
const health = createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'ok',
      projects: discoverProjects().map((p) => p.name),
    }));
  } else {
    res.writeHead(404);
    res.end();
  }
});

health.listen(config.port, () => {
  console.log(`Health check on :${config.port}/health`);
});

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
