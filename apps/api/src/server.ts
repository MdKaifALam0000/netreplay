/**
 * NetReplay API Server Entrypoint
 *
 * Bootstraps Fastify server on configured host and port, registers graceful
 * shutdown hooks to disconnect database and clean up active faults.
 */

import { buildApp } from './app.js';
import { config } from './config.js';
import { disconnectDb } from './services/db.js';
import { toxiproxyService } from './services/toxiproxy-service.js';

async function start() {
  const app = await buildApp();

  try {
    const address = await app.listen({
      port: config.port,
      host: config.host,
    });
    console.log(`\n============================================================`);
    console.log(`  🚀 NetReplay API Service listening on ${address}`);
    console.log(`  📖 Swagger Documentation: ${address}/docs`);
    console.log(`  🩺 Health Endpoint: ${address}/health`);
    console.log(`============================================================\n`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    console.log(`\n[API] Received ${signal}. Shutting down gracefully...`);
    try {
      await app.close();
      // Ensure any lingering faults on the proxy are cleared
      await toxiproxyService.clearFaults();
      await disconnectDb();
      console.log('[API] Shutdown complete.');
      process.exit(0);
    } catch (err) {
      console.error('[API] Error during shutdown:', err);
      process.exit(1);
    }
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

start();
