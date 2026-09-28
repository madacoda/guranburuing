// src/core/artifact-manager.ts
import fs from 'fs';
import path from 'path';

export interface CaptureOptions {
  /** Sub-folder or namespace, e.g. 'pbhl', 'captcha', 'errors', 'debug-frames' */
  namespace?: string;
  /** Descriptive filename prefix, e.g. 'turn-3-boss-state' */
  label: string;
  /** Custom root directory override. Default is 'scratch/captures' */
  baseDir?: string;
  /** Max files to retain in this namespace before pruning oldest. Default 50 */
  maxRetention?: number;
}

export class ArtifactManager {
  private static readonly DEFAULT_BASE_DIR = path.resolve(process.cwd(), 'scratch/captures');
  private static readonly DEFAULT_MAX_RETENTION = 50;

  /**
   * Resolves and creates a safe destination path for an image or diagnostic capture.
   * Enforces directory isolation and prevents loose dumps into root or logs folders.
   */
  public static getCapturePath(options: CaptureOptions): string {
    const baseDir = options.baseDir || this.DEFAULT_BASE_DIR;
    const namespace = options.namespace ? options.namespace.replace(/[^a-zA-Z0-9_-]/g, '_') : 'general';
    const targetDir = path.join(baseDir, namespace);

    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const sanitizedLabel = options.label.replace(/[^a-zA-Z0-9_-]/g, '_');
    const filename = `${timestamp}_${sanitizedLabel}.png`;

    return path.join(targetDir, filename);
  }

  /**
   * Captures a screenshot from a Puppeteer/CDP Page, saves it to an organized directory,
   * and automatically enforces retention quotas to prevent disk exhaustion.
   */
  public static async captureScreenshot(
    page: any,
    options: CaptureOptions
  ): Promise<string> {
    const filePath = this.getCapturePath(options);

    await page.screenshot({
      path: filePath,
      type: 'png'
    });

    this.pruneOldCaptures(path.dirname(filePath), options.maxRetention || this.DEFAULT_MAX_RETENTION);

    return filePath;
  }

  /**
   * Prunes oldest files in a target capture directory if file count exceeds maxRetention.
   */
  public static pruneOldCaptures(directoryPath: string, maxRetention: number): void {
    try {
      if (!fs.existsSync(directoryPath)) return;

      const files = fs.readdirSync(directoryPath)
        .filter(f => f.endsWith('.png') || f.endsWith('.jpg') || f.endsWith('.webp'))
        .map(f => {
          const fullPath = path.join(directoryPath, f);
          const stat = fs.statSync(fullPath);
          return { fullPath, mtimeMs: stat.mtimeMs };
        })
        .sort((a, b) => a.mtimeMs - b.mtimeMs);

      if (files.length > maxRetention) {
        const toDeleteCount = files.length - maxRetention;
        for (let i = 0; i < toDeleteCount; i++) {
          try {
            fs.unlinkSync(files[i].fullPath);
          } catch {
            // Non-critical cleanup failure
          }
        }
      }
    } catch (err: any) {
      console.warn(`[ArtifactManager] Failed to prune captures in ${directoryPath}: ${err.message}`);
    }
  }
}
