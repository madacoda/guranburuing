import fs from 'fs';
import path from 'path';
import { config } from '../../config.js';
import { discordDmRelay } from '../../relay/discord-dm-relay.js';

export type VpsTargetGroup = '4c8g-sg' | '2c2g-jp';
export type VpsLocation = 'SG' | 'JP-Tokyo';

export interface VpsOfferSnapshot {
  id: string;
  provider: string;
  targetGroup: VpsTargetGroup;
  planName: string;
  location: VpsLocation;
  vcpu: number;
  ramGb: number;
  storage: string;
  priceDisplay: string;
  monthlyUsdEstimate?: number;
  inStock: boolean;
  stockQty?: number | null;
  orderUrl: string;
  coupon?: string;
  notes?: string;
}

export interface VpsMonitorChange {
  kind: 'restock' | 'sold_out' | 'price_drop' | 'low_stock';
  offer: VpsOfferSnapshot;
  previous?: VpsOfferSnapshot;
  summary: string;
}

export interface VpsSweepResult {
  timestamp: string;
  offers: VpsOfferSnapshot[];
  errors: { provider: string; error: string }[];
}

export interface MonitorStateFile {
  updatedAt: string;
  offers: VpsOfferSnapshot[];
}

const DEFAULT_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const DEFAULT_STATE_PATH = path.resolve(process.cwd(), 'data', 'bf-vps-monitor-state.json');

function stripTags(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseRamGb(text: string): number | null {
  const mbMatch = text.match(/(\d+)\s*MB\s*RAM/i);
  if (mbMatch) {
    return Math.round((Number(mbMatch[1]) / 1024) * 10) / 10;
  }
  const gbMatch = text.match(/(\d+)\s*GB\s*(?:DDR\d+\s*)?(?:Memory|RAM)/i);
  if (gbMatch) {
    return Number(gbMatch[1]);
  }
  const revGbMatch = text.match(/RAM:\s*(\d+)\s*GB/i);
  return revGbMatch ? Number(revGbMatch[1]) : null;
}

function parseVcpu(text: string): number | null {
  const m = text.match(/(\d+)\s*(?:vCPUs?|vCores?|Cores?)(?:\s*@|\s+CPU|\s+High|\b)/i);
  return m ? Number(m[1]) : null;
}

function parseUsdAmount(text: string): number | null {
  const m = text.match(/\$\s*([\d,]+(?:\.\d+)?)/);
  if (!m) return null;
  const val = Number(m[1].replace(/,/g, ''));
  return Number.isFinite(val) ? val : null;
}

function parseBillingCycleDivisor(cycleText: string): { divisor: number; suffix: string } {
  const lower = cycleText.toLowerCase();
  if (lower.includes('annual') || lower.includes('year') || lower.includes('12 month')) {
    return { divisor: 12, suffix: '/yr' };
  }
  if (lower.includes('quarter') || lower.includes('3 month')) {
    return { divisor: 3, suffix: '/qtr' };
  }
  return { divisor: 1, suffix: '/mo' };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function findProductRecursive(node: any, targetSlug: string): any | null {
  if (!node || typeof node !== 'object') return null;
  if (node.slug === targetSlug && node.type === 'vps' && node.addons && node.price) {
    return node;
  }
  for (const val of Object.values(node)) {
    const found = findProductRecursive(val, targetSlug);
    if (found) return found;
  }
  return null;
}

/**
 * Extracts Contabo Cloud VPS Core 4 pricing & regional stock (Singapore / Japan)
 * from the SvelteKit hydration script.
 */
export function parseContaboCore4Html(html: string): VpsOfferSnapshot[] {
  const scripts = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]);
  const targetScript = scripts.find((s) => s.includes('location-singapore-cloud-vps-4'));
  if (!targetScript) return [];

  const iifeStart = targetScript.indexOf('(function(');
  if (iifeStart === -1) return [];

  let depth = 0;
  let end = -1;
  let inStr: string | null = null;
  let escaped = false;

  for (let i = iifeStart; i < targetScript.length; i++) {
    const ch = targetScript[i];
    if (inStr) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === '\\') {
        escaped = true;
        continue;
      }
      if (ch === inStr) {
        inStr = null;
      }
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      inStr = ch;
      continue;
    }
    if (ch === '(') depth++;
    else if (ch === ')') {
      depth--;
      if (depth === 0) {
        end = i + 1;
        break;
      }
    }
  }

  if (end === -1) return [];

  let data: any;
  try {
    data = new Function('return ' + targetScript.slice(iifeStart, end))();
  } catch {
    return [];
  }

  const product =
    Object.values<any>(data?.products || {}).find((p) => p?.slug === 'cloud-vps-core-4' && p?.addons) ??
    findProductRecursive(data, 'cloud-vps-core-4');
  if (!product) return [];

  const addons: any[] = Object.values(product.addons || {});
  const sinAddon = addons.find(
    (a) => a?.title === 'Asia (Singapore)' || a?.groupId === '2221' || a?.slug === 'location-singapore-cloud-vps-4'
  );
  const jpnAddon = addons.find(
    (a) => a?.title === 'Asia (Japan)' || a?.groupId === '2220' || a?.slug === 'location-japan-cloud-vps-4'
  );

  const periods: any[] = Array.isArray(product.periods) ? product.periods : [];
  const p1 = periods.find((p) => p?.length === 1);
  const p12 = periods.find((p) => p?.length === 12);
  const p24 = periods.find((p) => p?.length === 24);

  const baseEur = Number(product.price?.EUR ?? 5.5);
  const baseUsd = Number(product.price?.USD ?? 6.6);
  const setupEur = Number(p1?.setup?.EUR ?? 0);
  const setupUsd = Number(p1?.setup?.USD ?? 0);

  const monthPrice = (base: number, discTotal: any, len: number) =>
    round2(base - (Number(discTotal ?? 0) || 0) / len);

  const eur12 = monthPrice(baseEur, p12?.discount?.EUR, 12);
  const eur24 = monthPrice(baseEur, p24?.discount?.EUR, 24);
  const usd12 = monthPrice(baseUsd, p12?.discount?.USD, 12);
  const usd24 = monthPrice(baseUsd, p24?.discount?.USD, 24);

  const results: VpsOfferSnapshot[] = [];

  if (sinAddon) {
    const feeEur = Number(sinAddon.price?.EUR ?? 2.5);
    const feeUsd = Number(sinAddon.price?.USD ?? 3.1);
    const usd1 = round2(baseUsd + feeUsd);
    const usd12Tot = round2(usd12 + feeUsd);
    const usd24Tot = round2(usd24 + feeUsd);
    const eur1 = round2(baseEur + feeEur);
    const eur12Tot = round2(eur12 + feeEur);
    const eur24Tot = round2(eur24 + feeEur);
    results.push({
      id: 'contabo:core4:sg',
      provider: 'Contabo',
      targetGroup: '4c8g-sg',
      planName: 'Cloud VPS 4 (Core 4) SG',
      location: 'SG',
      vcpu: 4,
      ramGb: 8,
      storage: '100 GB SSD',
      priceDisplay: `$${usd1.toFixed(2)}/mo (12m $${usd12Tot.toFixed(2)}, 24m $${usd24Tot.toFixed(2)}) | €${eur1.toFixed(2)}–€${eur24Tot.toFixed(2)}`,
      monthlyUsdEstimate: usd1,
      inStock: !sinAddon.outOfStock,
      stockQty: sinAddon.outOfStock ? 0 : null,
      orderUrl: 'https://contabo.com/en/vps/cloud-vps-core-4/',
      notes: `incl. SG +€${feeEur.toFixed(2)}/$${feeUsd.toFixed(2)}; 1m setup €${setupEur}/$${setupUsd}`,
    });
  }

  if (jpnAddon) {
    const feeEur = Number(jpnAddon.price?.EUR ?? 2.55);
    const feeUsd = Number(jpnAddon.price?.USD ?? 3.15);
    const usd1 = round2(baseUsd + feeUsd);
    const usd12Tot = round2(usd12 + feeUsd);
    const usd24Tot = round2(usd24 + feeUsd);
    const eur1 = round2(baseEur + feeEur);
    const eur12Tot = round2(eur12 + feeEur);
    const eur24Tot = round2(eur24 + feeEur);
    results.push({
      id: 'contabo:core4:jp',
      provider: 'Contabo',
      targetGroup: '2c2g-jp',
      planName: 'Cloud VPS 4 (Core 4) Tokyo',
      location: 'JP-Tokyo',
      vcpu: 4,
      ramGb: 8,
      storage: '100 GB SSD',
      priceDisplay: `$${usd1.toFixed(2)}/mo (12m $${usd12Tot.toFixed(2)}, 24m $${usd24Tot.toFixed(2)}) | €${eur1.toFixed(2)}–€${eur24Tot.toFixed(2)}`,
      monthlyUsdEstimate: usd1,
      inStock: !jpnAddon.outOfStock,
      stockQty: jpnAddon.outOfStock ? 0 : null,
      orderUrl: 'https://contabo.com/en-us/vps/cloud-vps-core-4/',
      notes: `incl. JPN +€${feeEur.toFixed(2)}/$${feeUsd.toFixed(2)}; 1m setup €${setupEur}/$${setupUsd}`,
    });
  }

  return results;
}

/**
 * Extracts OVHcloud VPS-2 (2027) Singapore offer from the public ASIA catalog JSON.
 */
export function parseOvhCatalogJson(json: any): VpsOfferSnapshot[] {
  const plan = (json?.plans || []).find((x: any) => x?.planCode === 'vps-2027-model2');
  if (!plan) return [];

  const dcConfig = (plan.configurations || []).find((c: any) => c?.name === 'vps_datacenter');
  const dcs: string[] = Array.isArray(dcConfig?.values) ? dcConfig.values : [];
  const hasSgp = dcs.includes('SGP');

  const pickUsd = (mode: string): number | null => {
    const entry = (plan.pricings || []).find(
      (p: any) => p?.mode === mode && Number(p?.price) > 0 && Number(p?.interval) >= 1
    );
    return entry ? round2(Number(entry.price) / 1e8) : null;
  };

  const p1 = pickUsd('default') ?? 10.0;
  const p6 = pickUsd('upfront6');
  const p12 = pickUsd('upfront12');

  const parts = [`$${p1.toFixed(2)}/mo`];
  if (p6 !== null) parts.push(`6m $${p6.toFixed(2)}/mo`);
  if (p12 !== null) parts.push(`12m $${p12.toFixed(2)}/mo`);

  return [
    {
      id: 'ovh:vps2:sg',
      provider: 'OVHcloud',
      targetGroup: '4c8g-sg',
      planName: 'VPS-2 (2027)',
      location: 'SG',
      vcpu: 4,
      ramGb: 8,
      storage: '75 GB NVMe',
      priceDisplay: parts.join(', '),
      monthlyUsdEstimate: p1,
      inStock: hasSgp,
      stockQty: null,
      orderUrl: 'https://www.ovhcloud.com/asia/vps/',
      notes: '1 Gbps (2 TB APAC full-speed), daily backup, zero location fee',
    },
  ];
}

function extractWhmcsSelectOptions(html: string, labelPattern: RegExp): string[] {
  const selects = [
    ...html.matchAll(/<label[^>]*>([\s\S]*?)<\/label>(?:(?!<label\b)[\s\S]){0,700}?<select[^>]*>([\s\S]*?)<\/select>/gi),
  ];
  for (const m of selects) {
    const labelText = stripTags(m[1]);
    if (labelPattern.test(labelText)) {
      return [...m[2].matchAll(/<option[^>]*>([\s\S]*?)<\/option>/gi)].map((o) => stripTags(o[1]));
    }
  }
  return [];
}

/**
 * Extracts OrangeVPS BF26-2/3/4 plans from the WHMCS budget store page plus
 * live cart location options (separating Singapore availability from absent Tokyo).
 */
export function parseOrangeVpsData(
  listHtml: string,
  cartHtmlBySlug: Record<string, string>
): VpsOfferSnapshot[] {
  const specs: Record<string, { vcpu: number; ramGb: number; storage: string; checkSg: boolean; checkJp: boolean }> = {
    'bf26-2': { vcpu: 2, ramGb: 4, storage: '30 GB NVMe', checkSg: false, checkJp: true },
    'bf26-3': { vcpu: 2, ramGb: 6, storage: '40 GB NVMe', checkSg: false, checkJp: true },
    'bf26-4': { vcpu: 4, ramGb: 8, storage: '50 GB NVMe', checkSg: true, checkJp: true },
  };

  const results: VpsOfferSnapshot[] = [];
  const blocks = listHtml.split(/id="product\d+"/);

  for (const block of blocks.slice(1)) {
    const rawName = (block.match(/<span id="product\d+-name">([^<]+)/) || [])[1]?.trim() || '';
    const hrefMatch = block.match(/href="([^"]*\/store\/vps-budget\/(bf26-\d+))"/i);
    const slug = (hrefMatch?.[2] || rawName).toLowerCase();
    const spec = specs[slug];
    if (!spec) continue;

    const plain = stripTags(block);
    const qtyMatch = plain.match(/(\d+)\s*Available/i);
    const isOos = /Out of Stock/i.test(plain) || (qtyMatch ? Number(qtyMatch[1]) <= 0 : false);
    const stockQty = qtyMatch ? Number(qtyMatch[1]) : isOos ? 0 : null;
    const baseAvailable = !isOos && (stockQty === null || stockQty > 0);

    const listUsd = parseUsdAmount((block.match(/class="price">([^<]+)/) || [])[1] || plain) ?? 0;

    const cartHtml = cartHtmlBySlug[slug] || '';
    const cycleOpts = extractWhmcsSelectOptions(cartHtml, /Billing Cycle/i);
    const locOpts = extractWhmcsSelectOptions(cartHtml, /Location/i);
    const fallbackLocs =
      locOpts.length > 0
        ? locOpts
        : [...cartHtml.matchAll(/<option[^>]*>([\s\S]*?)<\/option>/gi)]
            .map((o) => stripTags(o[1]))
            .filter((t) => /Singapore|Tokyo|Japan|Kansas|Los Angeles|Hong Kong/i.test(t));

    const opt1m = cycleOpts.find((o) => /1\s*Month/i.test(o));
    const opt12m = cycleOpts.find((o) => /12\s*Month/i.test(o));
    const defaultAnnualMo: Record<string, number> = { 'bf26-2': 2.99, 'bf26-3': 4.32, 'bf26-4': 5.66 };
    const monthlyBase = (opt1m ? parseUsdAmount(opt1m) : null) ?? listUsd;
    const annualMoBase = (opt12m ? parseUsdAmount(opt12m) : null) ?? defaultAnnualMo[slug] ?? listUsd;

    const sgOpt = fallbackLocs.find((o) => /Singapore/i.test(o));
    const jpOpt = fallbackLocs.find((o) => /Tokyo|Japan/i.test(o));
    const hasCartCheck = cartHtml.length > 0 && fallbackLocs.length > 0;

    const orderUrl = `https://portal.orangevps.com/store/vps-budget/${slug}`;

    if (spec.checkSg) {
      const sgFee = (sgOpt ? parseUsdAmount(sgOpt) : null) ?? 0.5;
      const sgMonthly = round2(monthlyBase + sgFee);
      const sgAnnualBeforeCoupon = round2((annualMoBase + sgFee) * 12);
      const sgAnnualCoupon = round2(sgAnnualBeforeCoupon * 0.9);
      const sgAnnualMo = round2(sgAnnualCoupon / 12);
      const sgInStock = hasCartCheck ? baseAvailable && Boolean(sgOpt) : baseAvailable;

      results.push({
        id: `orangevps:${slug}:sg`,
        provider: 'OrangeVPS',
        targetGroup: '4c8g-sg',
        planName: `${rawName || slug.toUpperCase()} SG`,
        location: 'SG',
        vcpu: spec.vcpu,
        ramGb: spec.ramGb,
        storage: spec.storage,
        priceDisplay: `$${sgMonthly.toFixed(2)}/mo or $${sgAnnualCoupon.toFixed(2)}/yr ($${sgAnnualMo.toFixed(2)}/mo w/ coupon)`,
        monthlyUsdEstimate: sgMonthly,
        inStock: sgInStock,
        stockQty,
        orderUrl,
        coupon: 'BF2026GOODYEAR',
        notes: sgOpt
          ? `incl. +$${sgFee.toFixed(2)}/mo SG fee; strictly no refunds; SG LG: sg-lg.orangevps.com`
          : hasCartCheck
            ? 'Singapore option absent from cart configurator'
            : `cart check skipped/timeout; incl. est +$${sgFee.toFixed(2)}/mo SG fee; strictly no refunds`,
      });
    }

    if (spec.checkJp) {
      const jpFee = (jpOpt ? parseUsdAmount(jpOpt) : null) ?? 0;
      const jpMonthly = round2(monthlyBase + jpFee);
      const jpAnnualMo = round2((annualMoBase + jpFee) * 0.9);
      const jpInStock = baseAvailable && Boolean(jpOpt);

      results.push({
        id: `orangevps:${slug}:jp`,
        provider: 'OrangeVPS',
        targetGroup: '2c2g-jp',
        planName: `${rawName || slug.toUpperCase()} Tokyo`,
        location: 'JP-Tokyo',
        vcpu: spec.vcpu,
        ramGb: spec.ramGb,
        storage: spec.storage,
        priceDisplay:
          opt1m
            ? `$${jpMonthly.toFixed(2)}/mo ($${jpAnnualMo.toFixed(2)}/mo annual w/ coupon)`
            : `$${annualMoBase.toFixed(2)}/mo annual ($${jpAnnualMo.toFixed(2)}/mo w/ coupon)`,
        monthlyUsdEstimate: jpMonthly,
        inStock: jpInStock,
        stockQty: jpOpt ? stockQty : 0,
        orderUrl,
        coupon: 'BF2026GOODYEAR',
        notes: jpOpt
          ? `Tokyo live in cart! Strictly no refunds`
          : `Store lists TY, but Tokyo missing in cart dropdown right now (base qty=${stockQty ?? 'in stock'})`,
      });
    }
  }

  return results;
}

/**
 * Extracts GreenCloudVPS SG (4c/8g+) and Tokyo (2c/2g+) offers from a WHMCS store page.
 */
export function parseGreenCloudStoreHtml(
  html: string,
  storeSlug: 'budget-kvm-sale' | 'premium-kvm-sale' | 'ryzen-kvm-vps' | 'ssd-kvm-vps'
): VpsOfferSnapshot[] {
  const results: VpsOfferSnapshot[] = [];
  const blocks = html.split(/id="product\d+"/);
  const storeUrl = `https://greencloudvps.com/billing/store/${storeSlug}`;

  for (const block of blocks.slice(1)) {
    const name = (block.match(/<span id="product\d+-name">([^<]+)/) || [])[1]?.trim() || '';
    if (!name) continue;

    const plain = stripTags(block);
    const combined = `${name} ${plain}`;
    const isSg = /(?:\bSG\b|KVMSG|EPYCSG|Singapore)/i.test(combined);
    const isJp = /(?:Tokyo|KVMJP|EPYCJP|JPVF|JPSB|\bJP\b)/i.test(combined);
    if (!isSg && !isJp) continue;

    const vcpu = parseVcpu(plain);
    const ramGb = parseRamGb(plain);
    if (vcpu === null || ramGb === null) continue;

    let targetGroup: VpsTargetGroup;
    let location: VpsLocation;
    if (isSg) {
      if (vcpu < 4 || ramGb < 8 || ramGb > 12) continue;
      targetGroup = '4c8g-sg';
      location = 'SG';
    } else {
      if (vcpu < 2 || ramGb < 2 || ramGb > 12) continue;
      targetGroup = '2c2g-jp';
      location = 'JP-Tokyo';
    }

    const qtyMatch = plain.match(/(\d+)\s*Available/i);
    const isOos = /Out of Stock/i.test(plain) || (qtyMatch ? Number(qtyMatch[1]) <= 0 : false);
    const stockQty = qtyMatch ? Number(qtyMatch[1]) : isOos ? 0 : null;
    const inStock = !isOos;

    const priceHtmlMatch = block.match(/class="price">([^<]+)<\/span>\s*(?:<br\s*\/?>\s*([^<\n]+))?/i);
    const rawPriceText = priceHtmlMatch?.[1]?.trim() || '';
    const cycleText = priceHtmlMatch?.[2]?.trim() || plain;
    const usd = parseUsdAmount(rawPriceText) ?? parseUsdAmount(plain);
    const { divisor, suffix } = parseBillingCycleDivisor(cycleText);
    const monthlyUsdEstimate = usd !== null ? round2(usd / divisor) : undefined;
    const priceDisplay =
      usd !== null
        ? divisor > 1
          ? `$${usd.toFixed(2)}${suffix} ($${(usd / divisor).toFixed(2)}/mo)`
          : `$${usd.toFixed(2)}/mo`
        : 'See store';

    const storageMatch = plain.match(/(\d+\s*GB\s*(?:NVMe(?:\s*[\d.]+)?(?:\s*RAID-?10)?(?:\s*SSD)?|SSD(?:\s*RAID-?10)?))/i);
    const storage = storageMatch ? storageMatch[1].replace(/\s+/g, ' ').trim() : 'SSD/NVMe';

    const slugId = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    results.push({
      id: `greencloud:${storeSlug}:${slugId}`,
      provider: 'GreenCloudVPS',
      targetGroup,
      planName: name,
      location,
      vcpu,
      ramGb,
      storage,
      priceDisplay,
      monthlyUsdEstimate,
      inStock,
      stockQty,
      orderUrl: storeUrl,
      notes: storeSlug.includes('sale') ? 'BF/Sale tier (no refund)' : 'Regular tier',
    });
  }

  return results;
}

/**
 * Extracts ExtraVM Lagom-themed WHMCS package cards for Singapore (4c/8g+) or Tokyo (2c/2g+).
 */
export function parseExtraVmStoreHtml(
  html: string,
  location: VpsLocation,
  storeUrl: string
): VpsOfferSnapshot[] {
  const results: VpsOfferSnapshot[] = [];
  const blocks = html.split(/<div class="package" id="product\d+"/);

  for (const block of blocks.slice(1)) {
    const title = (block.match(/<h3 class="package-title">([\s\S]*?)<\/h3>/i) || [])[1]?.trim() || '';
    const priceRaw = stripTags((block.match(/<div class="price-amount">([\s\S]*?)<\/div>/i) || [])[1] || '');
    const cycleRaw = stripTags((block.match(/<div class="price-cycle">([\s\S]*?)<\/div>/i) || [])[1] || 'Monthly');
    const plain = stripTags(block);

    const vcpu = parseVcpu(plain);
    const ramGb = parseRamGb(`${title} ${plain}`);
    if (vcpu === null || ramGb === null) continue;

    let targetGroup: VpsTargetGroup;
    if (location === 'SG') {
      if (vcpu < 4 || ramGb < 8 || ramGb > 12) continue;
      targetGroup = '4c8g-sg';
    } else {
      if (vcpu < 2 || ramGb < 2 || ramGb > 12) continue;
      targetGroup = '2c2g-jp';
    }

    const qtyMatch = plain.match(/(\d+)\s*Available/i);
    const isOos = /Out of Stock/i.test(plain) || (qtyMatch ? Number(qtyMatch[1]) <= 0 : false);
    const stockQty = qtyMatch ? Number(qtyMatch[1]) : isOos ? 0 : null;
    const usd = parseUsdAmount(priceRaw) ?? parseUsdAmount(plain);
    const { divisor, suffix } = parseBillingCycleDivisor(cycleRaw);
    const storageMatch = plain.match(/(\d+\s*GB\s*NVMe(?:\s*SSD)?)/i);
    const planName = stripTags(title) || `${ramGb}GB RAM`;
    const slugId = planName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

    results.push({
      id: `extravm:${location.toLowerCase()}:${slugId}`,
      provider: 'ExtraVM',
      targetGroup,
      planName: `${planName} ${location === 'SG' ? 'SG' : 'Tokyo'}`,
      location,
      vcpu,
      ramGb,
      storage: storageMatch ? storageMatch[1] : 'NVMe SSD',
      priceDisplay: usd !== null ? `$${usd.toFixed(2)}${suffix}` : 'See store',
      monthlyUsdEstimate: usd !== null ? round2(usd / divisor) : undefined,
      inStock: !isOos,
      stockQty,
      orderUrl: storeUrl,
      notes: 'DDoS protected KVM',
    });
  }

  return results;
}

/**
 * Extracts ShockHosting SSD-KVM-8GB Singapore offer and validates SG availability in checkout.
 */
export function parseShockHostingData(listHtml: string, cartHtml8gb: string): VpsOfferSnapshot[] {
  const blocks = listHtml.split(/id="product\d+"/);
  const block8g = blocks.slice(1).find((b) => /SSD-KVM-8GB/i.test(b));
  if (!block8g) return [];

  const plain = stripTags(block8g);
  const qtyMatch = plain.match(/(\d+)\s*Available/i);
  const isOos = /Out of Stock/i.test(plain) || (qtyMatch ? Number(qtyMatch[1]) <= 0 : false);
  const baseUsd = parseUsdAmount((block8g.match(/class="price">([^<]+)/) || [])[1] || plain) ?? 19.99;

  const locOpts = extractWhmcsSelectOptions(cartHtml8gb, /Location/i);
  const cycleOpts = extractWhmcsSelectOptions(cartHtml8gb, /Billing Cycle/i);
  const hasSg = locOpts.length > 0 ? locOpts.some((o) => /Singapore/i.test(o)) : true;
  const opt12m = cycleOpts.find((o) => /12\s*Month/i.test(o));
  const usd12 = (opt12m ? parseUsdAmount(opt12m) : null) ?? 16.99;

  return [
    {
      id: 'shockhosting:ssd-kvm-8gb:sg',
      provider: 'ShockHosting',
      targetGroup: '4c8g-sg',
      planName: 'SSD-KVM-8GB SG',
      location: 'SG',
      vcpu: 4,
      ramGb: 8,
      storage: '120 GB SSD',
      priceDisplay: `$${baseUsd.toFixed(2)}/mo (12m $${usd12.toFixed(2)}/mo)`,
      monthlyUsdEstimate: baseUsd,
      inStock: !isOos && hasSg,
      stockQty: qtyMatch ? Number(qtyMatch[1]) : isOos ? 0 : null,
      orderUrl: 'https://shockhosting.com/portal/store/ssd-virtual-servers/ssd-kvm-8gb',
      notes: 'Singapore select in Location dropdown',
    },
  ];
}

/**
 * Extracts LightNode hourly-billed VPS tiers for Singapore (Premium 4c/8g) or Tokyo (Agency 2c/4g, Premium 4c/8g).
 */
export function parseLightNodeHtml(
  html: string,
  location: VpsLocation,
  url: string
): VpsOfferSnapshot[] {
  const plain = stripTags(html);
  const results: VpsOfferSnapshot[] = [];

  if (location === 'JP-Tokyo') {
    const ag = plain.match(/Agency\s*\$\s*([\d.]+)\s*\/month[\s\S]{0,120}?4\s*GB[\s\S]{0,40}?2\s*vCPU/i);
    if (ag) {
      const price = Number(ag[1]);
      results.push({
        id: 'lightnode:agency:jp',
        provider: 'LightNode',
        targetGroup: '2c2g-jp',
        planName: 'Agency Tokyo',
        location: 'JP-Tokyo',
        vcpu: 2,
        ramGb: 4,
        storage: '50 GB NVMe',
        priceDisplay: `$${price.toFixed(2)}/mo (hourly)`,
        monthlyUsdEstimate: price,
        inStock: true,
        stockQty: null,
        orderUrl: url,
        notes: 'Hourly billing (bridge option)',
      });
    }
  }

  const prem = plain.match(/Premium\s*\$\s*([\d.]+)\s*\/month[\s\S]{0,120}?8\s*GB[\s\S]{0,40}?4\s*vCPU/i);
  if (prem) {
    const price = Number(prem[1]);
    results.push({
      id: `lightnode:premium:${location === 'SG' ? 'sg' : 'jp'}`,
      provider: 'LightNode',
      targetGroup: location === 'SG' ? '4c8g-sg' : '2c2g-jp',
      planName: `Premium ${location === 'SG' ? 'SG' : 'Tokyo'}`,
      location,
      vcpu: 4,
      ramGb: 8,
      storage: '50 GB NVMe',
      priceDisplay: `$${price.toFixed(2)}/mo (hourly)`,
      monthlyUsdEstimate: price,
      inStock: true,
      stockQty: null,
      orderUrl: url,
      notes: 'Hourly billing (bridge option)',
    });
  }

  return results;
}

/**
 * Extracts Vultr Tokyo (`nrt`) 2c/2g and 2c/4g plans from Vultr's public `/v2/plans` API.
 */
export function parseVultrPlansJson(json: any): VpsOfferSnapshot[] {
  const plans: any[] = Array.isArray(json?.plans) ? json.plans : [];
  const targets = ['vc2-2c-2gb', 'vc2-2c-4gb'];
  const results: VpsOfferSnapshot[] = [];

  for (const id of targets) {
    const p = plans.find((x) => x?.id === id);
    if (!p) continue;
    const locations: string[] = Array.isArray(p.locations) ? p.locations : [];
    const hasNrt = locations.includes('nrt');
    const monthly = Number(p.monthly_cost);
    const ramGb = round2(Number(p.ram) / 1024);
    results.push({
      id: `vultr:${id}:jp`,
      provider: 'Vultr',
      targetGroup: '2c2g-jp',
      planName: `${id} Tokyo`,
      location: 'JP-Tokyo',
      vcpu: Number(p.vcpu_count),
      ramGb,
      storage: `${p.disk} GB SSD`,
      priceDisplay: `$${monthly.toFixed(2)}/mo`,
      monthlyUsdEstimate: monthly,
      inStock: hasNrt,
      stockQty: null,
      orderUrl: 'https://www.vultr.com/pricing/',
      notes: 'Tokyo (nrt) regular baseline',
    });
  }

  return results;
}

async function fetchText(url: string, timeoutMs = 12000): Promise<string> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': DEFAULT_UA, 'Accept-Language': 'en-US,en;q=0.9' },
      signal: ac.signal,
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} on ${url}`);
    }
    const text = await res.text();
    if (/Just a moment|cf-browser-verification|Attention Required/i.test(text)) {
      throw new Error(`Blocked by Cloudflare challenge on ${url}`);
    }
    return text;
  } finally {
    clearTimeout(timer);
  }
}

class WhmcsCookieSession {
  private cookies = new Map<string, string>();

  private merge(res: Response) {
    const setCookies =
      typeof (res.headers as any).getSetCookie === 'function'
        ? (res.headers as any).getSetCookie()
        : [res.headers.get('set-cookie')].filter(Boolean);
    for (const raw of setCookies as string[]) {
      const pair = raw.split(';')[0];
      const eq = pair.indexOf('=');
      if (eq > 0) {
        this.cookies.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
      }
    }
  }

  private header(): string {
    return [...this.cookies.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
  }

  async getHtml(url: string, referer?: string, timeoutMs = 12000): Promise<string> {
    let cur = url;
    let ref = referer;
    for (let hop = 0; hop < 5; hop++) {
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), timeoutMs);
      try {
        const res = await fetch(cur, {
          redirect: 'manual',
          headers: {
            'User-Agent': DEFAULT_UA,
            'Accept-Language': 'en-US,en;q=0.9',
            ...(this.cookies.size > 0 ? { Cookie: this.header() } : {}),
            ...(ref ? { Referer: ref } : {}),
          },
          signal: ac.signal,
        });
        this.merge(res);
        const loc = res.headers.get('location');
        if (res.status >= 300 && res.status < 400 && loc) {
          ref = cur;
          cur = loc.startsWith('http') ? loc : new URL(loc, cur).toString();
          continue;
        }
        if (!res.ok) {
          throw new Error(`HTTP ${res.status} on ${cur}`);
        }
        return await res.text();
      } finally {
        clearTimeout(timer);
      }
    }
    throw new Error(`Too many redirects on ${url}`);
  }
}

async function fetchOrangeVpsLive(): Promise<VpsOfferSnapshot[]> {
  const listUrl = 'https://portal.orangevps.com/store/vps-budget';
  const listSession = new WhmcsCookieSession();
  const listPromise = listSession.getHtml(listUrl, undefined, 45000);

  const slugs = ['bf26-2', 'bf26-3', 'bf26-4'];
  const cartPromises = slugs.map(async (slug) => {
    try {
      const s = new WhmcsCookieSession();
      const html = await s.getHtml(`${listUrl}/${slug}`, listUrl, 45000);
      return [slug, html] as const;
    } catch {
      return [slug, ''] as const;
    }
  });

  const [listHtml, cartEntries] = await Promise.all([listPromise, Promise.all(cartPromises)]);
  return parseOrangeVpsData(listHtml, Object.fromEntries(cartEntries));
}

async function fetchShockHostingLive(): Promise<VpsOfferSnapshot[]> {
  const session = new WhmcsCookieSession();
  const listUrl = 'https://shockhosting.com/portal/store/ssd-virtual-servers';
  const listHtml = await session.getHtml(listUrl);
  const cartHtml = await session.getHtml(`${listUrl}/ssd-kvm-8gb`, listUrl).catch(() => '');
  return parseShockHostingData(listHtml, cartHtml);
}

/**
 * Runs a concurrent HTTP sweep across all configured SG (4c/8g) and JP Tokyo (2c/2g+) sources.
 */
export async function runLiveVpsSweep(): Promise<VpsSweepResult> {
  const tasks: { name: string; run: () => Promise<VpsOfferSnapshot[]> }[] = [
    {
      name: 'Contabo',
      run: async () => parseContaboCore4Html(await fetchText('https://contabo.com/en/vps/cloud-vps-core-4/')),
    },
    {
      name: 'OVHcloud',
      run: async () =>
        parseOvhCatalogJson(
          JSON.parse(await fetchText('https://ca.api.ovh.com/1.0/order/catalog/public/vps?ovhSubsidiary=ASIA'))
        ),
    },
    {
      name: 'OrangeVPS',
      run: fetchOrangeVpsLive,
    },
    {
      name: 'GreenCloud (budget-sale)',
      run: async () =>
        parseGreenCloudStoreHtml(
          await fetchText('https://greencloudvps.com/billing/store/budget-kvm-sale'),
          'budget-kvm-sale'
        ),
    },
    {
      name: 'GreenCloud (premium-sale)',
      run: async () =>
        parseGreenCloudStoreHtml(
          await fetchText('https://greencloudvps.com/billing/store/premium-kvm-sale'),
          'premium-kvm-sale'
        ),
    },
    {
      name: 'GreenCloud (ryzen)',
      run: async () =>
        parseGreenCloudStoreHtml(
          await fetchText('https://greencloudvps.com/billing/store/ryzen-kvm-vps'),
          'ryzen-kvm-vps'
        ),
    },
    {
      name: 'GreenCloud (ssd)',
      run: async () =>
        parseGreenCloudStoreHtml(
          await fetchText('https://greencloudvps.com/billing/store/ssd-kvm-vps'),
          'ssd-kvm-vps'
        ),
    },
    {
      name: 'ExtraVM (SG)',
      run: async () =>
        parseExtraVmStoreHtml(
          await fetchText('https://extravm.com/billing/store/kvm-vps-singapore-ddos'),
          'SG',
          'https://extravm.com/billing/store/kvm-vps-singapore-ddos'
        ),
    },
    {
      name: 'ExtraVM (Tokyo)',
      run: async () =>
        parseExtraVmStoreHtml(
          await fetchText('https://extravm.com/billing/store/kvm-nvme-vps-tokyo-japan-ddos-protected'),
          'JP-Tokyo',
          'https://extravm.com/billing/store/kvm-nvme-vps-tokyo-japan-ddos-protected'
        ),
    },
    {
      name: 'ShockHosting',
      run: fetchShockHostingLive,
    },
    {
      name: 'LightNode (SG)',
      run: async () =>
        parseLightNodeHtml(
          await fetchText('https://go.lightnode.com/singapore-vps'),
          'SG',
          'https://go.lightnode.com/singapore-vps'
        ),
    },
    {
      name: 'LightNode (Tokyo)',
      run: async () =>
        parseLightNodeHtml(
          await fetchText('https://go.lightnode.com/japan-vps'),
          'JP-Tokyo',
          'https://go.lightnode.com/japan-vps'
        ),
    },
    {
      name: 'Vultr',
      run: async () => parseVultrPlansJson(JSON.parse(await fetchText('https://api.vultr.com/v2/plans'))),
    },
  ];

  const settled = await Promise.allSettled(tasks.map((t) => t.run()));
  const offers: VpsOfferSnapshot[] = [];
  const errors: { provider: string; error: string }[] = [];

  settled.forEach((res, idx) => {
    if (res.status === 'fulfilled') {
      offers.push(...res.value);
    } else {
      errors.push({
        provider: tasks[idx].name,
        error: res.reason instanceof Error ? res.reason.message : String(res.reason),
      });
    }
  });

  return {
    timestamp: new Date().toISOString(),
    offers,
    errors,
  };
}

/**
 * Compares previous vs current VPS snapshots and detects restocks, price drops, low stock, and sell-outs.
 */
export function diffVpsSnapshots(
  prev: VpsOfferSnapshot[],
  next: VpsOfferSnapshot[]
): VpsMonitorChange[] {
  const prevById = new Map(prev.map((o) => [o.id, o]));
  const changes: VpsMonitorChange[] = [];

  for (const cur of next) {
    const old = prevById.get(cur.id);
    if (!old) continue;

    if (!old.inStock && cur.inStock) {
      const qtyStr = cur.stockQty != null ? ` (${cur.stockQty} left)` : '';
      changes.push({
        kind: 'restock',
        offer: cur,
        previous: old,
        summary: `RESTOCK [${cur.targetGroup}] ${cur.provider} ${cur.planName}${qtyStr} — ${cur.priceDisplay}`,
      });
      continue;
    }

    if (old.inStock && !cur.inStock) {
      changes.push({
        kind: 'sold_out',
        offer: cur,
        previous: old,
        summary: `SOLD OUT [${cur.targetGroup}] ${cur.provider} ${cur.planName}`,
      });
      continue;
    }

    if (
      cur.inStock &&
      typeof old.monthlyUsdEstimate === 'number' &&
      typeof cur.monthlyUsdEstimate === 'number' &&
      old.monthlyUsdEstimate > 0 &&
      cur.monthlyUsdEstimate <= old.monthlyUsdEstimate * 0.95
    ) {
      changes.push({
        kind: 'price_drop',
        offer: cur,
        previous: old,
        summary: `PRICE DROP [${cur.targetGroup}] ${cur.provider} ${cur.planName}: $${old.monthlyUsdEstimate.toFixed(2)} -> $${cur.monthlyUsdEstimate.toFixed(2)}/mo`,
      });
    }

    if (
      cur.inStock &&
      typeof cur.stockQty === 'number' &&
      cur.stockQty > 0 &&
      cur.stockQty <= 3 &&
      (old.stockQty == null || cur.stockQty < old.stockQty)
    ) {
      changes.push({
        kind: 'low_stock',
        offer: cur,
        previous: old,
        summary: `LOW STOCK [${cur.targetGroup}] ${cur.provider} ${cur.planName}: ${cur.stockQty} left`,
      });
    }
  }

  return changes;
}

export function loadMonitorState(filePath = DEFAULT_STATE_PATH): MonitorStateFile | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (Array.isArray(raw?.offers)) {
      return raw as MonitorStateFile;
    }
  } catch {}
  return null;
}

export function saveMonitorState(result: VpsSweepResult, filePath = DEFAULT_STATE_PATH): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const payload: MonitorStateFile = {
    updatedAt: result.timestamp,
    offers: result.offers,
  };
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2));
}

function sortOffers(offers: VpsOfferSnapshot[]): VpsOfferSnapshot[] {
  return [...offers].sort((a, b) => {
    if (a.inStock !== b.inStock) return a.inStock ? -1 : 1;
    const pa = a.monthlyUsdEstimate ?? 9999;
    const pb = b.monthlyUsdEstimate ?? 9999;
    if (pa !== pb) return pa - pb;
    return a.provider.localeCompare(b.provider);
  });
}

function formatOfferLine(o: VpsOfferSnapshot): string {
  const badge = o.inStock
    ? `IN STOCK${o.stockQty != null ? ` (${o.stockQty} left)` : ''}`
    : 'OUT OF STOCK';
  const couponStr = o.coupon ? ` | Coupon: ${o.coupon}` : '';
  const notesStr = o.notes ? ` | ${o.notes}` : '';
  return `[${badge}] ${o.provider} ${o.planName} (${o.vcpu}c/${o.ramGb}g/${o.storage}) — ${o.priceDisplay}${couponStr}${notesStr}\n    Link: ${o.orderUrl}`;
}

export function formatConsoleReport(result: VpsSweepResult): string {
  const sg = sortOffers(result.offers.filter((o) => o.targetGroup === '4c8g-sg'));
  const jp = sortOffers(result.offers.filter((o) => o.targetGroup === '2c2g-jp'));
  const lines: string[] = [
    `=== BF 2026 VPS Monitor Snapshot (${result.timestamp}) ===`,
    '',
    `[Target 1: 4c/8g Singapore] (${sg.filter((o) => o.inStock).length}/${sg.length} in stock)`,
    ...sg.map((o) => `  - ${formatOfferLine(o)}`),
    '',
    `[Target 2: 2c/2g+ JP Tokyo] (${jp.filter((o) => o.inStock).length}/${jp.length} in stock)`,
    ...jp.map((o) => `  - ${formatOfferLine(o)}`),
  ];

  if (result.errors.length > 0) {
    lines.push('', `[Fetch Warnings (${result.errors.length})]`);
    for (const err of result.errors) {
      lines.push(`  ! ${err.provider}: ${err.error}`);
    }
  }
  return lines.join('\n');
}

function compactLine(o: VpsOfferSnapshot): string {
  const qty = o.stockQty != null ? ` (${o.stockQty})` : '';
  const price =
    o.monthlyUsdEstimate !== undefined ? `$${o.monthlyUsdEstimate.toFixed(2)}/mo` : o.priceDisplay.split(' ')[0];
  const cpn = o.coupon ? ` \`${o.coupon}\`` : '';
  return `• **${o.provider} ${o.planName}** (${o.vcpu}c/${o.ramGb}g/${o.storage}) ${price}${qty}${cpn} → ${o.orderUrl}`;
}

/**
 * Formats a concise Discord-safe digest (< 1950 chars) with clickable links for both targets.
 */
export function formatDiscordDigest(result: VpsSweepResult): string {
  const sgAll = sortOffers(result.offers.filter((o) => o.targetGroup === '4c8g-sg'));
  const jpAll = sortOffers(result.offers.filter((o) => o.targetGroup === '2c2g-jp'));

  const sgIn = sgAll.filter((o) => o.inStock);
  const jpIn = jpAll.filter((o) => o.inStock);
  const oosAll = [...sgAll.filter((o) => !o.inStock), ...jpAll.filter((o) => !o.inStock)];

  const lines: string[] = [
    '📡 **BF 2026 VPS Monitor — Live Links & Stock**',
    '',
    '**1) 4c/8g SG (In Stock):**',
    ...(sgIn.length > 0 ? sgIn.slice(0, 5).map(compactLine) : ['• None in stock right now']),
    '',
    '**2) 2c/2g+ JP Tokyo (In Stock):**',
    ...(jpIn.length > 0 ? jpIn.slice(0, 5).map(compactLine) : ['• None in stock right now']),
  ];

  if (oosAll.length > 0) {
    lines.push('', '**Watchlist (OOS flash targets):**');
    const seenUrls = new Set<string>();
    const uniqueWatch: VpsOfferSnapshot[] = [];
    for (const w of oosAll) {
      if (seenUrls.has(w.orderUrl)) continue;
      seenUrls.add(w.orderUrl);
      uniqueWatch.push(w);
      if (uniqueWatch.length >= 6) break;
    }
    for (const w of uniqueWatch) {
      lines.push(`• [OOS] ${w.provider} ${w.planName} → ${w.orderUrl}`);
    }
  }

  let out = lines.join('\n');
  if (out.length > 1950) {
    out = out.slice(0, 1935) + '\n…(trimmed)';
  }
  return out;
}

export function formatDiscordChangeAlert(changes: VpsMonitorChange[]): string {
  const actionable = changes.filter((c) => c.kind !== 'sold_out');
  const list = actionable.length > 0 ? actionable : changes;
  const lines = ['🔔 **BF 2026 VPS Stock/Price Alert**', ''];
  for (const c of list.slice(0, 8)) {
    const cpn = c.offer.coupon ? ` | Coupon: \`${c.offer.coupon}\`` : '';
    lines.push(`• **${c.summary}**${cpn}\n  Order: ${c.offer.orderUrl}`);
  }
  let out = lines.join('\n');
  if (out.length > 1950) {
    out = out.slice(0, 1935) + '\n…';
  }
  return out;
}

/**
 * Dispatches VPS monitor messages to configured notification channels (Discord DM, webhook, Telegram)
 * without triggering GBF emergency CAPTCHA formatting.
 */
export async function dispatchVpsAlert(
  message: string,
  dedupeKey?: string,
  force = true
): Promise<boolean> {
  if (process.env.NODE_ENV === 'test' || process.env.GBF_TEST_MODE === '1') {
    return false;
  }

  const jobs: Promise<boolean>[] = [];

  if (discordDmRelay.isConfigured()) {
    jobs.push(
      discordDmRelay
        .sendMessage(message, undefined, undefined, dedupeKey, force)
        .then((r) => Boolean(r?.id && r.id !== 'deduped'))
        .catch((err: any) => {
          console.error('[BF-VPS-Monitor] Discord DM error:', err?.message || err);
          return false;
        })
    );
  }

  if (config.DISCORD_WEBHOOK_URL) {
    jobs.push(
      fetch(config.DISCORD_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: message.slice(0, 1980) }),
      })
        .then((res) => res.ok)
        .catch(() => false)
    );
  }

  if (config.TELEGRAM_BOT_TOKEN && config.TELEGRAM_CHAT_ID) {
    jobs.push(
      fetch(`https://api.telegram.org/bot${config.TELEGRAM_BOT_TOKEN}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: config.TELEGRAM_CHAT_ID,
          text: message.slice(0, 4000),
          disable_web_page_preview: true,
        }),
      })
        .then((res) => res.ok)
        .catch(() => false)
    );
  }

  if (jobs.length === 0) return false;
  const outcomes = await Promise.all(jobs);
  return outcomes.some(Boolean);
}
