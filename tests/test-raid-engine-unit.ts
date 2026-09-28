// tests/test-raid-engine-unit.ts
import { RaidEngine } from '../src/engines/raid.engine.js';

console.log('--- Testing RaidEngine Unit Logic ---');

(globalThis as any).window = {
  location: { hash: '#mypage' },
  getComputedStyle: () => ({ display: 'block', visibility: 'visible' }),
};

const mockSentinel = {
  assertSafe: async () => {},
  isArmed: true,
} as any;

const mockBtn = {
  className: 'btn-usual-ok',
  innerText: 'OK',
  classList: { contains: () => false },
  evaluate: async (fn: any) => fn({ className: 'btn-usual-ok', innerText: 'OK', classList: { contains: () => false } }),
  boundingBox: async () => ({ x: 100, y: 100, width: 100, height: 40 }),
};

const mockExpiredModal = {
  innerText: 'This battle has already ended.',
  className: 'pop-usual',
  classList: { contains: () => false },
  evaluate: async (fn: any) => fn({ innerText: 'This battle has already ended.' }),
};

const mockPage = {
  url: () => 'https://game.granbluefantasy.jp/#quest/assist',
  evaluate: async (fn: any, arg: any) => {
    if (typeof fn === 'function') return fn(arg);
  },
  waitForSelector: async () => mockBtn,
  $: async (sel: string) => {
    if (sel === '.pop-usual') return mockExpiredModal;
    if (sel.includes('.btn-usual-ok')) return mockBtn;
    return null;
  },
  keyboard: {
    down: async () => {},
    press: async () => {},
    up: async () => {},
    type: async () => {},
  },
  mouse: {
    move: async () => {},
    down: async () => {},
    up: async () => {},
  },
} as any;

const engine = new RaidEngine(mockPage, mockSentinel);
const result = await engine.joinAndFight({ raidCode: 'DEAD1234' });

console.log('Raid Join Expired Test Result:', result);
if (result.status !== 'RAID_EXPIRED') {
  throw new Error(`Expected RAID_EXPIRED, got ${result.status}`);
}

console.log('\n✅ Task 05 Raid Engine Logic Tests: ALL PASSED!');
