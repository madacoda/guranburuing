import assert from 'node:assert/strict';
import {
  diffVpsSnapshots,
  formatDiscordDigest,
  parseContaboCore4Html,
  parseExtraVmStoreHtml,
  parseGreenCloudStoreHtml,
  parseLightNodeHtml,
  parseOrangeVpsData,
  parseOvhCatalogJson,
  parseShockHostingData,
  parseVultrPlansJson,
  type VpsOfferSnapshot,
  type VpsSweepResult,
} from '../src/services/vps/bf-vps-monitor.service.js';

function runTests() {
  // 1. Contabo SvelteKit IIFE parser (SG OOS -> SG Restock + JP In Stock)
  const contaboPayload = {
    products: {
      c4: {
        slug: 'cloud-vps-core-4',
        title: 'Cloud VPS 4',
        type: 'vps',
        price: { EUR: 5.5, USD: 6.6 },
        periods: [
          { length: 1, setup: { EUR: 2, USD: 2.4 }, discount: { EUR: 0, USD: 0 } },
          { length: 12, setup: { EUR: 0, USD: 0 }, discount: { EUR: 9.9, USD: 11.88 } },
          { length: 24, setup: { EUR: 0, USD: 0 }, discount: { EUR: 26.4, USD: 31.68 } },
        ],
        addons: {
          sin: {
            title: 'Asia (Singapore)',
            slug: 'location-singapore-cloud-vps-4',
            groupId: '2221',
            price: { EUR: 2.5, USD: 3.1 },
            outOfStock: true,
          },
          jpn: {
            title: 'Asia (Japan)',
            slug: 'location-japan-cloud-vps-4',
            groupId: '2220',
            price: { EUR: 2.55, USD: 3.15 },
            outOfStock: false,
          },
        },
      },
    },
  };
  const contaboHtml = `<script>(function(a){return ${JSON.stringify(contaboPayload)};}("x"))</script>`;
  const contaboOffers = parseContaboCore4Html(contaboHtml);
  assert.equal(contaboOffers.length, 2);
  const cSg = contaboOffers.find((o) => o.id === 'contabo:core4:sg')!;
  const cJp = contaboOffers.find((o) => o.id === 'contabo:core4:jp')!;
  assert.equal(cSg.targetGroup, '4c8g-sg');
  assert.equal(cSg.inStock, false);
  assert.equal(cSg.monthlyUsdEstimate, 9.7);
  assert.equal(cJp.targetGroup, '2c2g-jp');
  assert.equal(cJp.inStock, true);
  assert.equal(cJp.monthlyUsdEstimate, 9.75);

  const contaboRestockHtml = contaboHtml.replace('"outOfStock":true', '"outOfStock":false');
  const cSgRestocked = parseContaboCore4Html(contaboRestockHtml).find((o) => o.id === 'contabo:core4:sg')!;
  assert.equal(cSgRestocked.inStock, true);

  // 2. OVH catalog JSON parser
  const ovhJson = {
    plans: [
      {
        planCode: 'vps-2027-model2',
        configurations: [{ name: 'vps_datacenter', values: ['GRA', 'SGP', 'SYD'] }],
        pricings: [
          { mode: 'default', interval: 1, price: 0 },
          { mode: 'default', interval: 1, price: 1000000000 },
          { mode: 'upfront6', interval: 1, price: 950000000 },
          { mode: 'upfront12', interval: 1, price: 850000000 },
        ],
      },
    ],
  };
  const ovhOffers = parseOvhCatalogJson(ovhJson);
  assert.equal(ovhOffers.length, 1);
  assert.equal(ovhOffers[0].inStock, true);
  assert.equal(ovhOffers[0].monthlyUsdEstimate, 10);
  const ovhNoSgp = parseOvhCatalogJson({
    plans: [{ ...ovhJson.plans[0], configurations: [{ name: 'vps_datacenter', values: ['GRA'] }] }],
  });
  assert.equal(ovhNoSgp[0].inStock, false);

  // 3. OrangeVPS WHMCS list + cart parser (SG present, Tokyo absent -> Tokyo added)
  const orangeList = `
    <div id="product313"><span id="product313-name">BF26-2</span> 12 Available <span class="price">$2.99 USD</span> <a href="/store/vps-budget/bf26-2">Order</a></div>
    <div id="product314"><span id="product314-name">BF26-3</span> 1 Available <span class="price">$5.49 USD</span> <a href="/store/vps-budget/bf26-3">Order</a></div>
    <div id="product315"><span id="product315-name">BF26-4</span> 7 Available <span class="price">$7.49 USD</span> <a href="/store/vps-budget/bf26-4">Order</a></div>
  `;
  const bf2CartNoTy = `
    <label for="cycle">Choose Billing Cycle</label><select><option>12 Month Price - $2.99 USD</option></select>
    <label for="loc">Location</label><select><option>Kansas City</option><option>Singapore $0.42 USD</option></select>
  `;
  const bf4CartNoTy = `
    <label for="cycle">Choose Billing Cycle</label><select><option>1 Month Price - $7.49 USD</option><option>12 Month Price - $5.66 USD</option></select>
    <label for="loc">Location</label><select><option>Kansas City</option><option>Singapore (LG: sg-lg.orangevps.com) $0.50 USD</option></select>
  `;
  const orangeOffers = parseOrangeVpsData(orangeList, {
    'bf26-2': bf2CartNoTy,
    'bf26-3': bf4CartNoTy,
    'bf26-4': bf4CartNoTy,
  });
  const oBf4Sg = orangeOffers.find((o) => o.id === 'orangevps:bf26-4:sg')!;
  const oBf4Jp = orangeOffers.find((o) => o.id === 'orangevps:bf26-4:jp')!;
  const oBf2Jp = orangeOffers.find((o) => o.id === 'orangevps:bf26-2:jp')!;
  assert.equal(oBf4Sg.inStock, true);
  assert.equal(oBf4Sg.monthlyUsdEstimate, 7.99);
  assert.equal(oBf4Sg.stockQty, 7);
  assert.equal(oBf4Jp.inStock, false);
  assert.equal(oBf2Jp.inStock, false);

  const bf2CartWithTy = bf2CartNoTy.replace(
    '<option>Singapore $0.42 USD</option>',
    '<option>Singapore $0.42 USD</option><option>Tokyo, Japan $0.40 USD</option>'
  );
  const oBf2JpLive = parseOrangeVpsData(orangeList, { 'bf26-2': bf2CartWithTy }).find(
    (o) => o.id === 'orangevps:bf26-2:jp'
  )!;
  assert.equal(oBf2JpLive.inStock, true);
  assert.equal(oBf2JpLive.monthlyUsdEstimate, 3.39);

  // 4. GreenCloudVPS parser (excludes 1-core, keeps >=4c/8g SG & >=2c/2g JP, handles restock)
  const gcHtml = `
    <div id="product1"><span id="product1-name">EPYCJP-1</span> 0 Available 2048MB RAM 25GB NVMe 1 core @ EPYC Milan <span class="price">$25.00 USD</span><br/>Annually</div>
    <div id="product2"><span id="product2-name">EPYCJP-2</span> 0 Available 3072MB RAM 35GB NVMe 4.0 2 cores @ EPYC Milan <span class="price">$35.00 USD</span><br/>Annually</div>
    <div id="product3"><span id="product3-name">BudgetKVMSGDC1-3</span> 2 Available 8192MB RAM 60GB NVMe 4 cores @ EPYC Rome Singapore DC1 <span class="price">$45.00 USD</span><br/>Annually</div>
    <div id="product4"><span id="product4-name">KVMSG1-4</span> 16GB RAM 120GB SSD 8 cores Singapore DC1 <span class="price">$80.00 USD</span><br/>Monthly</div>
  `;
  const gcOffers = parseGreenCloudStoreHtml(gcHtml, 'premium-kvm-sale');
  assert.equal(gcOffers.some((o) => o.planName === 'EPYCJP-1'), false);
  const gcJp2 = gcOffers.find((o) => o.planName === 'EPYCJP-2')!;
  const gcSg3 = gcOffers.find((o) => o.planName === 'BudgetKVMSGDC1-3')!;
  assert.equal(gcJp2.targetGroup, '2c2g-jp');
  assert.equal(gcJp2.inStock, false);
  assert.equal(gcJp2.monthlyUsdEstimate, 2.92);
  assert.equal(gcSg3.targetGroup, '4c8g-sg');
  assert.equal(gcSg3.inStock, true);
  assert.equal(gcSg3.stockQty, 2);

  // 5. ExtraVM Lagom parser
  const extraHtml = `
    <div class="package" id="product432"><h3 class="package-title">2GB RAM</h3><div class="price-amount">$8.00 USD</div><div class="price-cycle">Monthly</div>2GB RAM 1 Core 30GB NVMe SSD 0 Available</div>
    <div class="package" id="product434"><h3 class="package-title">4GB RAM</h3><div class="price-amount">$16.00 USD</div><div class="price-cycle">Monthly</div>4GB RAM 2 Cores 60GB NVMe SSD 2 Available</div>
    <div class="package" id="product438"><h3 class="package-title">8GB RAM</h3><div class="price-amount">$32.00 USD</div><div class="price-cycle">Monthly</div>8GB RAM 4 Cores 120GB NVMe SSD 0 Available</div>
  `;
  const extraJp = parseExtraVmStoreHtml(extraHtml, 'JP-Tokyo', 'https://extravm.com/jp');
  const extraSg = parseExtraVmStoreHtml(extraHtml, 'SG', 'https://extravm.com/sg');
  assert.equal(extraJp.some((o) => o.ramGb === 2), false);
  assert.equal(extraJp.find((o) => o.ramGb === 4)?.inStock, true);
  assert.equal(extraJp.find((o) => o.ramGb === 4)?.stockQty, 2);
  assert.equal(extraSg.length, 1);
  assert.equal(extraSg[0].inStock, false);

  // 6. ShockHosting + LightNode + Vultr
  const shockList = `<div id="product5">SSD-KVM-8GB 4 Cores 8 GB RAM 120 GB SSD <span class="price">$19.99 USD</span></div>`;
  const shockCart = `<label for="loc">Location</label><select><option>Singapore</option></select><label for="c">Choose Billing Cycle</label><select><option>12 Month Price - $16.99 USD</option></select>`;
  const shock = parseShockHostingData(shockList, shockCart);
  assert.equal(shock[0].inStock, true);
  assert.equal(shock[0].monthlyUsdEstimate, 19.99);

  const lnJp = parseLightNodeHtml(
    'Agency $ 14.7 /month Japan VPS Hosting 4 GB DDR4 Memory 2 vCPU High Frequency 50 GB NVMe Premium $ 27.7 /month Japan VPS Hosting 8 GB DDR4 Memory 4 vCPU',
    'JP-Tokyo',
    'https://go.lightnode.com/japan-vps'
  );
  assert.equal(lnJp.length, 2);
  assert.equal(lnJp[0].monthlyUsdEstimate, 14.7);

  const vultr = parseVultrPlansJson({
    plans: [
      { id: 'vc2-2c-2gb', vcpu_count: 2, ram: 2048, disk: 65, monthly_cost: 15, locations: ['nrt', 'sgp'] },
      { id: 'vc2-2c-4gb', vcpu_count: 2, ram: 4096, disk: 80, monthly_cost: 20, locations: ['nrt'] },
    ],
  });
  assert.equal(vultr.length, 2);
  assert.equal(vultr[1].inStock, true);

  // 7. Diff detection: restock, price_drop, low_stock, sold_out
  const baseOffer: VpsOfferSnapshot = {
    id: 'test:1',
    provider: 'TestHost',
    targetGroup: '4c8g-sg',
    planName: 'Test-4c8g',
    location: 'SG',
    vcpu: 4,
    ramGb: 8,
    storage: '80 GB NVMe',
    priceDisplay: '$10.00/mo',
    monthlyUsdEstimate: 10,
    inStock: false,
    stockQty: 0,
    orderUrl: 'https://example.com/1',
  };
  const priceBase: VpsOfferSnapshot = { ...baseOffer, id: 'test:2', inStock: true, stockQty: 8 };
  const soldBase: VpsOfferSnapshot = { ...baseOffer, id: 'test:3', inStock: true, stockQty: 2 };

  const changes = diffVpsSnapshots(
    [baseOffer, priceBase, soldBase],
    [
      { ...baseOffer, inStock: true, stockQty: 5 },
      { ...priceBase, monthlyUsdEstimate: 8.5, stockQty: 2 },
      { ...soldBase, inStock: false, stockQty: 0 },
    ]
  );
  assert.deepEqual(
    changes.map((c) => c.kind).sort(),
    ['low_stock', 'price_drop', 'restock', 'sold_out']
  );

  // Unchanged yields zero changes
  assert.equal(diffVpsSnapshots([priceBase], [{ ...priceBase }]).length, 0);

  // 8. Digest formatting within Discord 2000-char limit and preserving URLs
  const mockSweep: VpsSweepResult = {
    timestamp: '2026-11-23T09:00:00.000Z',
    offers: [...contaboOffers, ...ovhOffers, ...orangeOffers, ...gcOffers, ...vultr],
    errors: [],
  };
  const digest = formatDiscordDigest(mockSweep);
  assert.ok(digest.length <= 1980, `Digest too long: ${digest.length}`);
  assert.ok(digest.includes('https://www.ovhcloud.com/asia/vps/'));
  assert.ok(digest.includes('https://portal.orangevps.com/store/vps-budget/bf26-4'));

  console.log('✅ All BF VPS monitor unit tests passed.');
}

runTests();
