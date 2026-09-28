// tests/test-gateway-server.ts
import { GatewayServer } from '../src/gateway/server.js';
import { WebSocket } from 'ws';
import { config } from '../src/config.js';

console.log('--- Testing Gateway Server & WebSocket Protocol ---');

// Mock browser global environment for evaluate
(globalThis as any).window = {
  location: { hash: '#mypage' },
  getComputedStyle: () => ({ display: 'block', visibility: 'visible' }),
};

const mockCompletedElement = {
  className: 'btn-pro-skip is-completed',
  innerText: '0/1',
  evaluate: async (fn: any) => fn({ className: 'btn-pro-skip is-completed', innerText: '0/1' }),
  boundingBox: async () => ({ x: 100, y: 100, width: 200, height: 50 }),
};

const mockPage = {
  url: () => 'https://game.granbluefantasy.jp/#mypage',
  target: () => ({
    createCDPSession: async () => ({
      on: () => {},
      send: async () => {},
    }),
  }),
  evaluate: async (fn: any, arg: any) => {
    if (typeof fn === 'function') {
      return fn(arg);
    }
  },
  waitForSelector: async () => mockCompletedElement,
  $: async (sel: string) => {
    if (sel.includes('pro_skip')) {
      return mockCompletedElement;
    }
    return null;
  },
  mouse: { move: async () => {}, down: async () => {}, up: async () => {} },
} as any;

const mockSentinel = {
  assertSafe: async () => {},
  isArmed: true,
  unlock: () => {},
} as any;

const gateway = new GatewayServer(mockPage, mockSentinel);
await gateway.start();
console.log('Gateway Server booted successfully on port', config.PORT);

// Test 0: HTTP Endpoints & Static PWA Serving
const healthRes = await fetch(`http://127.0.0.1:${config.PORT}/api/health`);
const healthJson = await healthRes.json() as any;
if (healthJson.status !== 'OK') throw new Error('Health check failed');
console.log('HTTP /api/health: PASSED');

const htmlRes = await fetch(`http://127.0.0.1:${config.PORT}/`);
const htmlText = await htmlRes.text();
if (!htmlText.includes('GBF Remote Companion')) throw new Error('PWA index.html not served properly');
console.log('HTTP / (PWA index.html): PASSED');

const manifestRes = await fetch(`http://127.0.0.1:${config.PORT}/manifest.json`);
const manifestJson = await manifestRes.json() as any;
if (manifestJson.short_name !== 'GBF Remote') throw new Error('PWA manifest.json not served properly');
console.log('HTTP /manifest.json: PASSED');

// Test 1: Unauthorized connection should be closed
await new Promise<void>((resolve, reject) => {
  const badWs = new WebSocket(`ws://127.0.0.1:${config.PORT}/ws?token=invalid_token`);
  badWs.on('close', (code) => {
    console.log(`Unauthorized connection closed with code ${code}: PASSED`);
    if (code === 1008 || code === 1006) {
      resolve();
    } else {
      reject(new Error(`Expected close code 1008 or 1006, got ${code}`));
    }
  });
  badWs.on('error', () => {
    resolve();
  });
});

// Test 2: Authorized connection & command round-trip
await new Promise<void>((resolve, reject) => {
  const goodWs = new WebSocket(`ws://127.0.0.1:${config.PORT}/ws?token=${config.AUTH_TOKEN}`);
  
  goodWs.on('open', () => {
    console.log('Authorized WebSocket connected: PASSED');
    goodWs.send(JSON.stringify({ type: 'CMD_TRIGGER_DAILY', payload: { target: 'magna_pro' } }));
  });

  goodWs.on('message', (raw) => {
    const msg = JSON.parse(raw.toString());
    console.log('Received WebSocket message type:', msg.type);
    if (msg.type === 'EVENT_TASK_COMPLETE') {
      console.log('Task Complete payload received:', msg.task);
      goodWs.close();
      resolve();
    }
  });

  goodWs.on('error', reject);
});

console.log('\n✅ Task 06 Gateway Server Tests: ALL PASSED!');
process.exit(0);
