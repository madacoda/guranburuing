#!/usr/bin/env bun
// src/cli/run-discord-controller.ts
import { discordCommandGatewayService } from '../services/discord/discord-command-gateway.service.js';

async function main() {
  console.log('[DiscordController CLI] Launching Remote Controller Gateway...');
  await discordCommandGatewayService.start();

  // Keep process alive and handle graceful shutdown
  process.on('SIGINT', () => {
    console.log('\n[DiscordController CLI] Received SIGINT. Shutting down gateway gracefully...');
    discordCommandGatewayService.stop();
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    console.log('\n[DiscordController CLI] Received SIGTERM. Shutting down gateway gracefully...');
    discordCommandGatewayService.stop();
    process.exit(0);
  });
}

main().catch((err) => {
  console.error('[Fatal Error in Discord Controller]', err);
  process.exit(1);
});
