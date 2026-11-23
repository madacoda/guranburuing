import {
  diffVpsSnapshots,
  dispatchVpsAlert,
  formatConsoleReport,
  formatDiscordChangeAlert,
  formatDiscordDigest,
  loadMonitorState,
  runLiveVpsSweep,
  saveMonitorState,
  type VpsOfferSnapshot,
} from '../services/vps/bf-vps-monitor.service.js';

function parseIntervalSeconds(args: string[]): number {
  const flag = args.find((a) => a.startsWith('--interval='));
  if (!flag) return 300;
  const parsed = Number(flag.split('=')[1]);
  return Number.isFinite(parsed) ? Math.max(60, Math.round(parsed)) : 300;
}

async function runTick(
  tickNumber: number,
  options: { once: boolean; notifyInitial: boolean; noNotify: boolean; json: boolean }
): Promise<void> {
  const prevState = loadMonitorState();
  const prevOffers: VpsOfferSnapshot[] = prevState?.offers || [];
  const result = await runLiveVpsSweep();

  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
  } else if (tickNumber === 1) {
    console.log(formatConsoleReport(result));
  } else {
    const sgIn = result.offers.filter((o) => o.targetGroup === '4c8g-sg' && o.inStock).length;
    const jpIn = result.offers.filter((o) => o.targetGroup === '2c2g-jp' && o.inStock).length;
    console.log(
      `[${result.timestamp}] Tick #${tickNumber}: 4c8g-sg=${sgIn} in stock | 2c2g-jp=${jpIn} in stock | warnings=${result.errors.length}`
    );
  }

  const changes = prevOffers.length > 0 ? diffVpsSnapshots(prevOffers, result.offers) : [];
  const actionable = changes.filter((c) => c.kind !== 'sold_out');

  if (changes.length > 0 && !options.json) {
    console.log('\n[Changes Detected]');
    for (const c of changes) {
      console.log(`  * ${c.summary} -> ${c.offer.orderUrl}`);
    }
  }

  saveMonitorState(result);

  if (options.noNotify) return;

  if (tickNumber === 1 && options.notifyInitial) {
    const digest = formatDiscordDigest(result);
    const sent = await dispatchVpsAlert(digest, undefined, true);
    console.log(sent ? '[Monitor] Initial verified links digest sent.' : '[Monitor] Initial digest not dispatched (no channel or failed).');
  }

  if (actionable.length > 0) {
    process.stdout.write('\x07\x07');
    const msg = formatDiscordChangeAlert(actionable);
    const sent = await dispatchVpsAlert(msg, undefined, true);
    console.log(sent ? '[Monitor] Change alert sent.' : '[Monitor] Change alert failed/skipped.');
  }
}

async function main() {
  const args = process.argv.slice(2);
  const once = args.includes('--once');
  const notifyInitial = args.includes('--notify-initial');
  const noNotify = args.includes('--no-notify');
  const json = args.includes('--json');
  const intervalSec = parseIntervalSeconds(args);

  let stopping = false;
  const onStop = () => {
    stopping = true;
    console.log('\n[Monitor] Stopping cleanly.');
    process.exit(0);
  };
  process.on('SIGINT', onStop);
  process.on('SIGTERM', onStop);

  let tick = 1;
  await runTick(tick, { once, notifyInitial, noNotify, json });

  if (once) {
    process.exit(0);
  }

  console.log(`[Monitor] Watching 4c/8g SG & 2c/2g+ JP Tokyo every ${intervalSec}s (Ctrl+C to stop)...`);
  while (!stopping) {
    await new Promise((r) => setTimeout(r, intervalSec * 1000));
    if (stopping) break;
    tick++;
    try {
      await runTick(tick, { once: false, notifyInitial: false, noNotify, json });
    } catch (err: any) {
      console.error(`[Monitor] Tick #${tick} error:`, err?.message || err);
    }
  }
}

main().catch((err) => {
  console.error('[Monitor] Fatal:', err?.message || err);
  process.exit(1);
});
