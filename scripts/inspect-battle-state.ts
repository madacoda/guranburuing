import { CdpConnectionManager } from '../src/cdp-connection.js';

async function main() {
  const mgr = new CdpConnectionManager();
  const { page } = await mgr.connectWithRetry(2, 1000, true);

  console.log('Current Page URL:', page.url());

  const details = await page.evaluate(() => {
    const hash = window.location.hash;
    const stage = (window as any).stage;
    const gGameStatus = stage ? stage.gGameStatus : null;
    const gEnemyStatus = stage ? stage.gEnemyStatus : null;
    const pJsn = stage ? stage.pJsnData : null;
    const keys = stage ? Object.keys(stage) : [];

    // Check DOM ability buttons
    const domAbilities = Array.from(document.querySelectorAll('.btn-ability-available, [class*="ability-character-num"]')).map(el => ({
      className: el.className,
      dataset: Object.assign({}, (el as any).dataset),
      abilityId: el.getAttribute('ability-id') || el.getAttribute('data-ability-id'),
      abilityNum: el.getAttribute('ability-num') || el.getAttribute('data-ability-num'),
      icon: el.querySelector('img') ? el.querySelector('img')!.src : '',
      style: el.getAttribute('style') || ''
    })).slice(0, 15);

    // Check pJsnData player and abilities
    const chars = (pJsn && pJsn.player && pJsn.player.param) 
      ? pJsn.player.param 
      : ((status && status.player && status.player.param) ? status.player.param : []);

    const abilityDetails: any[] = [];
    if (pJsn && pJsn.ability) {
      for (const [k, v] of Object.entries(pJsn.ability)) {
        abilityDetails.push({ key: k, value: v });
      }
    }

    return {
      hash,
      stageKeys: keys,
      pJsnKeys: pJsn ? Object.keys(pJsn) : [],
      abilityCountInPjsn: abilityDetails.length,
      abilityDetailsSample: abilityDetails.slice(0, 8),
      boss: (pJsn && pJsn.boss && pJsn.boss.param && pJsn.boss.param[0]) ? {
        name: pJsn.boss.param[0].name,
        hp: pJsn.boss.param[0].hp,
        hpmax: pJsn.boss.param[0].hpmax,
        alive: pJsn.boss.param[0].alive,
        debuffs: (pJsn.boss.param[0].condition && pJsn.boss.param[0].condition.debuff) 
          ? pJsn.boss.param[0].condition.debuff.map((d: any) => ({ status: d.status, name: d.name || d.detail }))
          : []
      } : null,
      characters: chars.map((c: any, idx: number) => ({
        index: idx,
        name: c.name || c.char_name,
        hp: c.hp,
        hpmax: c.hpmax,
        hpPct: Math.round((c.hp / (c.hpmax || 1)) * 100),
        alive: c.alive,
        debuffs: (c.condition && c.condition.debuff) ? c.condition.debuff.length : 0
      })),
      domAbilities
    };
  });

  console.log('Battle State Details:\n', JSON.stringify(details, null, 2));
  await mgr.disconnect();
}

main().catch(console.error);
