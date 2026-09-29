// tests/test-event-engine-unit.ts
import { EventEngine } from '../src/engines/event.engine.js';
import { SentinelWatchdog } from '../src/sentinel-watchdog.js';

console.log('========================================================================');
console.log('         EventEngine & Story Routine Unit Test Suite                    ');
console.log('========================================================================');

let passed = 0;
let failed = 0;

function assert(description: string, condition: boolean) {
  if (condition) {
    console.log(`  ✅ PASS: ${description}`);
    passed++;
  } else {
    console.error(`  ❌ FAIL: ${description}`);
    failed++;
  }
}

// Mock Page
class MockPage {
  private urlStr = 'https://game.granbluefantasy.jp/#event/treasureraid177';
  public touchscreen = {
    tap: async () => {}
  };

  url() {
    return this.urlStr;
  }

  async evaluate(fn: Function, ...args: any[]) {
    // Simulate active in-progress story episode card
    if (fn.toString().includes('btn-quest-list.ico-current')) {
      return {
        chapterId: '94731',
        questId: '947314',
        questName: '1: Dealing With Deficiency',
        sceneOnly: '1',
        ap: '0'
      };
    }
    // Simulate synopsis or skip
    if (fn.toString().includes('btn-scene-skip')) {
      return true;
    }
    // Simulate isStoryFullyCleared
    if (fn.toString().includes('isStoryFullyCleared')) {
      return false;
    }
    return true;
  }

  async waitForFunction() {
    return true;
  }

  async $(sel: string) {
    return null;
  }
}

const mockPage = new MockPage() as any;
const mockSentinel = new SentinelWatchdog(mockPage);
const eventEngine = new EventEngine(mockPage, mockSentinel);

// Test 1: Event ID Resolution
console.log('\n[Test 1] Event ID Resolution...');
const idDefault = await eventEngine.resolveEventId();
assert('Resolves default event ID 177', idDefault === '177');

const idExplicit = await eventEngine.resolveEventId('treasureraid180');
assert('Parses explicit event ID numeric prefix', idExplicit === '180');

// Test 2: Active Story Card Scanning
console.log('\n[Test 2] Active Story Card Scanning...');
const card = await eventEngine.getActiveStoryCard();
assert('Detects in-progress card', card !== null);
assert('Correctly reads chapterId', card?.chapterId === '94731');
assert('Correctly reads questId', card?.questId === '947314');
assert('Identifies cutscene episode (sceneOnly: 1)', card?.sceneOnly === '1');

// Test 3: Stop Request Handling
console.log('\n[Test 3] Stop Request Handling...');
eventEngine.requestStop();
assert('Stop flag sets without error', (eventEngine as any).stopRequested === true);

console.log('\n========================================================================');
console.log(`Total: ${passed + failed} | Passed: ${passed} | Failed: ${failed}`);
console.log('========================================================================\n');

if (failed > 0) process.exit(1);
process.exit(0);
