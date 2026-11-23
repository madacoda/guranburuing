// src/services/telemetry/captcha-relay-storage.service.ts
import fs from 'node:fs';
import path from 'node:path';

export interface CaptchaCapturedImage {
  label: string;
  buffer: Buffer;
  filename?: string;
  width?: number;
  height?: number;
  src?: string;
}

export interface SavedCaptchaImageInfo {
  label: string;
  filename: string;
  artifactPath: string;
  scratchPath: string;
  bytes: number;
  width?: number;
  height?: number;
  src?: string;
}

export interface CaptchaRelayRecord {
  id: string;
  code: string;
  rawMessage: string;
  messageId?: string;
  promptMessageId?: string;
  verified?: boolean | null;
  timestampIso: string;
  timestampJst: string;
  gbfDay: string;
  accountId?: string;
  playerName?: string;
  questName?: string;
  raidId?: string;
  runNumber?: number;
  attempt?: number;
  maxAttempts?: number;
  metadataPath: string;
  scratchMetadataPath: string;
  images: SavedCaptchaImageInfo[];
}

export interface SaveCaptchaRelayParams {
  code: string;
  rawMessage?: string;
  messageId?: string;
  promptMessageId?: string;
  verified?: boolean | null;
  images: CaptchaCapturedImage[];
  initialCapturePath?: string;
  accountId?: string;
  playerName?: string;
  questName?: string;
  raidId?: string;
  runNumber?: number;
  attempt?: number;
  maxAttempts?: number;
  customTimestamp?: Date;
}

export interface CaptchaRelayStorageDirs {
  artifactsDir?: string;
  scratchDir?: string;
  logsDir?: string;
}

/**
 * Persists every `/gbf <code>` reply from Discord alongside all associated images
 * (full viewport, isolated puzzle image, modal crop, tile images, and any attachments).
 */
export class CaptchaRelayStorageService {
  private artifactsDir: string;
  private scratchDir: string;
  private logsDir: string;
  private ledgerPath: string;
  private jsonlPath: string;
  private summaryMarkdownPath: string;

  constructor(dirs?: CaptchaRelayStorageDirs) {
    this.artifactsDir = path.resolve(
      process.cwd(),
      dirs?.artifactsDir || 'artifacts/captures/captcha'
    );
    this.scratchDir = path.resolve(
      process.cwd(),
      dirs?.scratchDir || 'scratch/captures/captcha'
    );
    this.logsDir = path.resolve(
      process.cwd(),
      dirs?.logsDir || 'logs/captcha-relays'
    );
    this.ledgerPath = path.resolve(this.logsDir, 'captcha-relay-ledger.json');
    this.jsonlPath = path.resolve(this.logsDir, 'captcha-relays.jsonl');
    this.summaryMarkdownPath = path.resolve(this.logsDir, 'README.md');
  }

  private ensureDirs(): void {
    for (const dir of [this.artifactsDir, this.scratchDir, this.logsDir]) {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    }
  }

  /**
   * Formats a date into a clean JST timestamp string.
   */
  public static formatJstTimestamp(date: Date = new Date()): string {
    return date.toLocaleString('ja-JP', {
      timeZone: 'Asia/Tokyo',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    }) + ' JST';
  }

  /**
   * Returns canonical GBF Server Day (YYYY-MM-DD, 05:00 JST reset).
   */
  public static getGbfDay(date: Date = new Date()): string {
    const jstTime = new Date(date.toLocaleString('en-US', { timeZone: 'Asia/Tokyo' }));
    jstTime.setHours(jstTime.getHours() - 5);
    const y = jstTime.getFullYear();
    const m = String(jstTime.getMonth() + 1).padStart(2, '0');
    const d = String(jstTime.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  /**
   * Sanitizes a `/gbf <code>` value for safe cross-platform filenames while preserving alphanumeric & Japanese characters.
   */
  public static sanitizeCodeForFilename(code: string): string {
    const cleaned = code
      .trim()
      .replace(/\s+/g, '-')
      .replace(/[^a-zA-Z0-9\u3040-\u30ff\uFF00-\uFFEF_-]/g, '_');
    return cleaned || 'unknown';
  }

  /**
   * Sanitizes an image label (e.g. 'viewport', 'puzzle', 'modal', 'tile-1') for filenames.
   */
  public static sanitizeLabel(label: string, index: number): string {
    const cleaned = (label || `image-${index + 1}`)
      .trim()
      .replace(/\.png$/i, '')
      .replace(/[^a-zA-Z0-9_-]/g, '_');
    return cleaned || `image-${index + 1}`;
  }

  /**
   * Deduplicates image buffers by label and non-empty content so all distinct images are saved cleanly.
   */
  public static normalizeImages(images: CaptchaCapturedImage[]): CaptchaCapturedImage[] {
    const result: CaptchaCapturedImage[] = [];
    const usedLabels = new Set<string>();

    for (let i = 0; i < images.length; i++) {
      const img = images[i];
      if (!img || !Buffer.isBuffer(img.buffer) || img.buffer.length === 0) {
        continue;
      }

      let baseLabel = CaptchaRelayStorageService.sanitizeLabel(img.label || img.filename || `image-${i + 1}`, i);
      let finalLabel = baseLabel;
      let suffix = 2;
      while (usedLabels.has(finalLabel)) {
        // If identical buffer was already added under this exact label, skip duplicate
        const existing = result.find(r => r.label === baseLabel);
        if (existing && existing.buffer.equals(img.buffer)) {
          finalLabel = '';
          break;
        }
        finalLabel = `${baseLabel}-${suffix++}`;
      }

      if (!finalLabel) continue;
      usedLabels.add(finalLabel);
      result.push({
        ...img,
        label: finalLabel
      });
    }

    return result;
  }

  /**
   * Saves a `/gbf <code>` relay reply along with all associated CAPTCHA images and metadata.
   */
  public saveRelayRecord(params: SaveCaptchaRelayParams): CaptchaRelayRecord {
    this.ensureDirs();

    const date = params.customTimestamp || new Date();
    const timestampIso = date.toISOString();
    const timestampJst = CaptchaRelayStorageService.formatJstTimestamp(date);
    const gbfDay = CaptchaRelayStorageService.getGbfDay(date);

    const timeSlug = timestampIso.replace(/[:.]/g, '-').slice(0, 19);
    const safeCode = CaptchaRelayStorageService.sanitizeCodeForFilename(params.code);
    const uniqueSuffix = params.messageId
      ? params.messageId.slice(-6)
      : String(date.getTime()).slice(-6);
    const basePrefix = `${timeSlug}_code-${safeCode}_${uniqueSuffix}`;
    const recordId = `captcha-${date.getTime()}-${safeCode}-${uniqueSuffix}`;

    const normalizedImages = CaptchaRelayStorageService.normalizeImages(params.images || []);
    const savedImages: SavedCaptchaImageInfo[] = [];

    for (let i = 0; i < normalizedImages.length; i++) {
      const img = normalizedImages[i];
      const filename = `${basePrefix}_${img.label}.png`;
      const artifactPath = path.join(this.artifactsDir, filename);
      const scratchPath = path.join(this.scratchDir, filename);

      fs.writeFileSync(artifactPath, img.buffer);
      fs.writeFileSync(scratchPath, img.buffer);

      savedImages.push({
        label: img.label,
        filename,
        artifactPath,
        scratchPath,
        bytes: img.buffer.length,
        width: img.width,
        height: img.height,
        src: img.src
      });
    }

    // Remove unlabeled temporary viewport capture if it was superseded by the code-labeled captures
    if (
      params.initialCapturePath &&
      savedImages.length > 0 &&
      fs.existsSync(params.initialCapturePath) &&
      !savedImages.some(s => s.scratchPath === params.initialCapturePath || s.artifactPath === params.initialCapturePath)
    ) {
      try {
        fs.unlinkSync(params.initialCapturePath);
      } catch {}
    }

    const metadataFilename = `${basePrefix}.json`;
    const codeTextFilename = `${basePrefix}.txt`;
    const metadataPath = path.join(this.artifactsDir, metadataFilename);
    const scratchMetadataPath = path.join(this.scratchDir, metadataFilename);

    const record: CaptchaRelayRecord = {
      id: recordId,
      code: params.code.trim(),
      rawMessage: (params.rawMessage || `/gbf ${params.code.trim()}`).trim(),
      messageId: params.messageId,
      promptMessageId: params.promptMessageId,
      verified: params.verified ?? null,
      timestampIso,
      timestampJst,
      gbfDay,
      accountId: params.accountId,
      playerName: params.playerName,
      questName: params.questName,
      raidId: params.raidId,
      runNumber: params.runNumber,
      attempt: params.attempt,
      maxAttempts: params.maxAttempts,
      metadataPath,
      scratchMetadataPath,
      images: savedImages
    };

    const serializedRecord = JSON.stringify(record, null, 2);
    fs.writeFileSync(metadataPath, serializedRecord, 'utf-8');
    fs.writeFileSync(scratchMetadataPath, serializedRecord, 'utf-8');
    fs.writeFileSync(path.join(this.artifactsDir, codeTextFilename), record.code + '\n', 'utf-8');
    fs.writeFileSync(path.join(this.scratchDir, codeTextFilename), record.code + '\n', 'utf-8');

    // Update master ledger & jsonl
    const ledger = this.getRecords();
    ledger.push(record);
    fs.writeFileSync(this.ledgerPath, JSON.stringify(ledger, null, 2), 'utf-8');
    fs.appendFileSync(this.jsonlPath, JSON.stringify(record) + '\n', 'utf-8');
    this.generateSummaryMarkdown(ledger);

    console.log(
      `[CaptchaRelayStorage] 💾 Saved Discord /gbf code "${record.code}" with ${savedImages.length} image(s) -> ${this.artifactsDir} (${basePrefix})`
    );

    return record;
  }

  /**
   * Updates the verification result (`verified: true | false`) for a saved relay record.
   */
  public updateVerificationStatus(recordId: string, verified: boolean): CaptchaRelayRecord | null {
    this.ensureDirs();
    const ledger = this.getRecords();
    const idx = ledger.findIndex(r => r.id === recordId);
    if (idx === -1) return null;

    ledger[idx].verified = verified;
    const updated = ledger[idx];

    fs.writeFileSync(this.ledgerPath, JSON.stringify(ledger, null, 2), 'utf-8');
    const serialized = JSON.stringify(updated, null, 2);
    try {
      if (updated.metadataPath) fs.writeFileSync(updated.metadataPath, serialized, 'utf-8');
      if (updated.scratchMetadataPath) fs.writeFileSync(updated.scratchMetadataPath, serialized, 'utf-8');
    } catch {}

    this.generateSummaryMarkdown(ledger);
    return updated;
  }

  /**
   * Loads all saved `/gbf <code>` relay records from the master ledger.
   */
  public getRecords(): CaptchaRelayRecord[] {
    try {
      if (fs.existsSync(this.ledgerPath)) {
        const raw = fs.readFileSync(this.ledgerPath, 'utf-8');
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch (err: any) {
      console.warn(`[CaptchaRelayStorage] Warning reading ledger: ${err.message}`);
    }
    return [];
  }

  /**
   * Generates a human-readable Markdown index of all saved Discord `/gbf <code>` relays and images.
   */
  public generateSummaryMarkdown(records?: CaptchaRelayRecord[]): void {
    const all = records || this.getRecords();
    const sorted = [...all].sort((a, b) => b.timestampIso.localeCompare(a.timestampIso));

    let md = `# 🔐 Granblue Fantasy - Discord \`/gbf <code>\` CAPTCHA Relay Archive\n\n`;
    md += `> - **Total Relays Saved:** \`${all.length}\`\n`;
    md += `> - **Verified / Solved:** \`${all.filter(r => r.verified === true).length}\`\n`;
    md += `> - **Artifacts Directory:** \`${this.artifactsDir}\`\n`;
    md += `> - **Scratch Directory:** \`${this.scratchDir}\`\n\n`;

    md += `| # | Timestamp (JST) | Code | Raw Command | Status | Player / Account | Quest / Raid | Saved Images |\n`;
    md += `| :---: | :--- | :---: | :--- | :---: | :--- | :--- | :--- |\n`;

    sorted.forEach((r, idx) => {
      const statusStr = r.verified === true ? '✅ Verified' : r.verified === false ? '❌ Failed' : '📩 Relayed';
      const playerStr = r.playerName
        ? `${r.playerName}${r.accountId ? ` (${r.accountId})` : ''}`
        : (r.accountId || '-');
      const questStr = r.questName
        ? `${r.questName}${r.raidId ? ` (#${r.raidId})` : ''}`
        : (r.raidId || '-');
      const imgLinks = r.images.length > 0
        ? r.images.map(img => `[${img.label}](${img.artifactPath})`).join(', ')
        : 'None';

      md += `| ${idx + 1} | ${r.timestampJst} | \`${r.code}\` | \`${r.rawMessage}\` | ${statusStr} | ${playerStr} | ${questStr} | ${imgLinks} |\n`;
    });

    try {
      fs.writeFileSync(this.summaryMarkdownPath, md, 'utf-8');
    } catch {}
  }
}

export const captchaRelayStorage = new CaptchaRelayStorageService();
