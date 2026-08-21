import config from './config.js';
import prisma, { initDatabase } from './lib/db.js';
import { createApp } from './app.js';

const app = createApp();

async function main() {
  await initDatabase();

  const server = app.listen(config.server.port, config.server.host, () => {
    const url = `http://${config.server.host}:${config.server.port}`;
    console.log(`\n  Paytm API  ->  ${url}`);
    console.log(`  environment   ->  ${config.env}`);
    console.log(`  database      ->  ${config.databaseUrl}`);
    console.log(`  cors origins  ->  ${config.cors.origins.join(', ')}`);
    console.log(`\n  All money in this app is simulated locally. No real payment rails.\n`);
  });

  const shutdown = async (signal) => {
    console.log(`\n${signal} received, shutting down...`);
    server.close(async () => {
      await prisma.$disconnect();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 5000).unref();
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch(async (err) => {
  console.error('Failed to start Paytm API:', err);
  await prisma.$disconnect();
  process.exit(1);
});
