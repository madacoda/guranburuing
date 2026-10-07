// src/index.ts
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from './config.js';
import { CdpConnectionManager } from './cdp-connection.js';
import { SentinelWatchdog } from './sentinel-watchdog.js';
import { AlertRelay } from './alert-relay.js';
import { GatewayServer } from './gateway/server.js';

// Central Domain Barrel Exports
export * from './config.js';
export * from './cdp-connection.js';
export * from './sentinel-watchdog.js';
export * from './alert-relay.js';
export * from './human-motor.js';
export * from './types/index.js';
export * from './templates/index.js';
export * from './engines/index.js';
export * from './auth/index.js';
export * from './gateway/index.js';
export * from './core/index.js';
export * from './domain/index.js';
export * from './services/index.js';
export * from './workflows/index.js';


export async function bootstrap() {
  console.log('=====================================================');
  console.log('     Granblue Fantasy Remote Controller Daemon       ');
  console.log('=====================================================');

  // 1. Initialize CDP Connection Manager
  const cdpManager = new CdpConnectionManager();
  console.log('[Bootstrap] Attaching to Chrome CDP session on port 9222...');
  const { page } = await cdpManager.connectWithRetry();

  // 2. Initialize Safety Sentinel & Alert Relay
  const alertRelay = new AlertRelay();
  const sentinel = new SentinelWatchdog(page, alertRelay);
  console.log('[Bootstrap] Sentinel Watchdog armed and monitoring.');

  // 3. Start Gateway Server & Viewport Screencast
  const gateway = new GatewayServer(page, sentinel);
  await gateway.start();

  console.log(`[Bootstrap] Daemon is fully operational.`);
  console.log(`[Bootstrap] Companion UI available at: http://localhost:${config.PORT}/?token=${config.AUTH_TOKEN}`);

  // Graceful Shutdown Handlers
  const shutdown = async (signal: string) => {
    console.log(`\n[Shutdown] Received ${signal}. Cleaning up resources...`);
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

// Auto-run daemon if invoked directly as CLI entrypoint
const currentFile = fileURLToPath(import.meta.url);
const invokedFile = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (invokedFile && (invokedFile === currentFile || invokedFile.endsWith('index.ts') || invokedFile.endsWith('index.js'))) {
  bootstrap().catch((err: any) => {
    console.error('[Bootstrap] Fatal startup failure:', err.message);
    process.exit(1);
  });
}
