// scripts/clear-discord-presence.ts
import { config } from '../src/config.js';
import net from 'net';

async function clearGatewayPresence(): Promise<void> {
  const token = config.DISCORD_BOT_TOKEN;
  if (!token) {
    console.log('[Gateway] No DISCORD_BOT_TOKEN found.');
    return;
  }

  console.log('[Gateway] Connecting to Discord Gateway to clear bot presence...');
  return new Promise((resolve) => {
    try {
      const ws = new WebSocket('wss://gateway.discord.gg/?v=10&encoding=json');
      let heartbeatTimer: any = null;

      const timeout = setTimeout(() => {
        console.log('[Gateway] Operation timed out after 8s.');
        try { ws.close(); } catch {}
        resolve();
      }, 8000);

      ws.onmessage = (event: MessageEvent) => {
        try {
          const payload = typeof event.data === 'string' ? JSON.parse(event.data) : JSON.parse(event.data.toString());
          const { op, d, t } = payload;

          if (op === 10) {
            // Heartbeat & Identify with EMPTY activities
            const interval = d?.heartbeat_interval || 41250;
            heartbeatTimer = setInterval(() => {
              if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ op: 1, d: null }));
              }
            }, interval);

            console.log('[Gateway] Identified with empty activities to clear presence...');
            ws.send(JSON.stringify({
              op: 2,
              d: {
                token,
                intents: 0,
                properties: { os: process.platform, browser: 'guranburuing', device: 'guranburuing' },
                presence: {
                  status: 'online',
                  since: null,
                  afk: true,
                  activities: [] // Empty = Cleared
                }
              }
            }));
          }

          if (op === 0 && t === 'READY') {
            console.log('[Gateway] Bot presence successfully cleared on Discord!');
            // Also explicitly send op 3 clear presence
            ws.send(JSON.stringify({
              op: 3,
              d: {
                since: null,
                status: 'online',
                afk: true,
                activities: []
              }
            }));

            setTimeout(() => {
              clearTimeout(timeout);
              if (heartbeatTimer) clearInterval(heartbeatTimer);
              ws.close();
              resolve();
            }, 1000);
          }
        } catch (e: any) {
          console.warn('[Gateway] Message error:', e.message);
        }
      };

      ws.onerror = (err: any) => {
        console.warn('[Gateway] WebSocket notice:', err.message || err);
        clearTimeout(timeout);
        resolve();
      };
    } catch (e: any) {
      console.warn('[Gateway] Connection error:', e.message);
      resolve();
    }
  });
}

async function clearIpcPresence(): Promise<void> {
  const isWin = process.platform === 'win32';
  const clientId = config.DISCORD_CLIENT_ID || '1554396837127921714';
  console.log('[IPC] Probing local Discord Desktop IPC pipes to clear Rich Presence...');

  for (let i = 0; i < 10; i++) {
    const pipePath = isWin ? `\\\\.\\pipe\\discord-ipc-${i}` : `/tmp/discord-ipc-${i}`;
    try {
      await new Promise<void>((resolve) => {
        const socket = net.connect(pipePath);
        const timer = setTimeout(() => {
          socket.destroy();
          resolve();
        }, 1500);

        socket.once('connect', () => {
          console.log(`[IPC] Connected to ${pipePath}. Sending clear activity...`);
          // Opcode 0: Handshake
          const handshake = JSON.stringify({ v: 1, client_id: clientId });
          const hBuf = Buffer.from(handshake, 'utf-8');
          const hHead = Buffer.alloc(8);
          hHead.writeInt32LE(0, 0);
          hHead.writeInt32LE(hBuf.length, 4);
          socket.write(Buffer.concat([hHead, hBuf]));

          // Send SET_ACTIVITY with empty/null activity
          setTimeout(() => {
            const clearPayload = JSON.stringify({
              cmd: 'SET_ACTIVITY',
              args: {
                pid: process.pid,
                activity: null
              },
              nonce: String(Date.now())
            });
            const cBuf = Buffer.from(clearPayload, 'utf-8');
            const cHead = Buffer.alloc(8);
            cHead.writeInt32LE(1, 0);
            cHead.writeInt32LE(cBuf.length, 4);
            socket.write(Buffer.concat([cHead, cBuf]), () => {
              console.log(`[IPC] Cleared local activity on ${pipePath}.`);
              setTimeout(() => {
                clearTimeout(timer);
                socket.end();
                resolve();
              }, 500);
            });
          }, 300);
        });

        socket.once('error', () => {
          clearTimeout(timer);
          resolve();
        });
      });
    } catch {}
  }
}

async function main() {
  console.log('=====================================================');
  console.log('      Discord Presence Terminator / Reset Utility     ');
  console.log('=====================================================\n');

  await Promise.all([
    clearGatewayPresence(),
    clearIpcPresence()
  ]);

  console.log('\n✅ Discord presence clear commands dispatched.');
  process.exit(0);
}

main().catch(console.error);
