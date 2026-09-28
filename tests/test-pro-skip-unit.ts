// tests/test-pro-skip-unit.ts
import { ProSkipEngine } from '../src/engines/pro-skip.engine.js';

console.log('--- Testing ProSkipEngine Unit Logic ---');

// Mock browser global environment for evaluate
(globalThis as any).window = {
  location: { hash: '#mypage' },
  getComputedStyle: () => ({ display: 'block', visibility: 'visible' }),
};

(globalThis as any).document = {
  querySelectorAll: (sel: string) => {
    if (sel.includes('.prt-list-contents')) {
      return [{
        querySelector: (subSel: string) => subSel.includes('data-pro-quest-skip') ? {
          getAttribute: (attr: string) => {
            if (attr === 'data-pro-quest-skip') return 'true';
            if (attr === 'data-limited_count') return '0';
            if (attr === 'data-quest-id') return '300151';
            return null;
          },
          classList: { contains: () => false },
        } : null,
        getAttribute: (attr: string) => attr === 'data-quest-name' ? 'Colossus Omega (Impossible)' : null,
        classList: { contains: (cls: string) => cls === 'is-completed' },
        innerText: 'CLEARED'
      }];
    }
    return [];
  },
  querySelector: () => null
};

const mockSentinel = {
  assertSafe: async () => {},
  isArmed: true,
} as any;

const mockCompletedElement = {
  className: 'btn-treasure-raid',
  getAttribute: (attr: string) => attr === 'data-limited_count' ? '0' : null,
  closest: () => ({ getAttribute: (attr: string) => attr === 'data-limited_count' ? '0' : null }),
  evaluate: async (fn: any) => fn({
    getAttribute: (attr: string) => attr === 'data-limited_count' ? '0' : null,
    closest: () => ({ getAttribute: (attr: string) => attr === 'data-limited_count' ? '0' : null })
  }),
  boundingBox: async () => ({ x: 100, y: 100, width: 200, height: 50 }),
};

const mockPage = {
  url: () => 'https://game.granbluefantasy.jp/#quest/index',
  evaluate: async (fn: any, arg: any) => {
    if (typeof fn === 'function') {
      return fn(arg);
    }
  },
  waitForSelector: async () => mockCompletedElement,
  waitForFunction: async () => true,
  $: async () => mockCompletedElement,
  mouse: {
    move: async () => {},
    down: async () => {},
    up: async () => {},
  },
} as any;

const engine = new ProSkipEngine(mockPage, mockSentinel);
const results = await engine.execute('magna_pro');

console.log('ProSkip Result:', results[0]);
if (results[0].status !== 'ALREADY_CLEARED') {
  throw new Error(`Expected ALREADY_CLEARED, got ${results[0].status}`);
}

console.log('\n✅ Task 04 ProSkip Engine Logic Tests: ALL PASSED!');
