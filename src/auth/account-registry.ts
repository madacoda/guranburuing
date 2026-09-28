// src/auth/account-registry.ts
import fs from 'fs';
import path from 'path';
import { z } from 'zod';
import { AccountConfig } from '../types/account.types.js';

const AccountConfigSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  enabled: z.boolean().default(true),
  service: z.enum(['mobage', 'dmm', 'gree', 'manual']).default('mobage'),
  cdpPort: z.number().int().min(1024).max(65535).default(9222),
  profileDir: z.string().min(1),
  credentials: z.object({
    email: z.string().optional().default(''),
    password: z.string().optional().default('')
  }).optional(),
  proxy: z.string().nullable().optional()
});

const AccountsListSchema = z.array(AccountConfigSchema);

export class AccountRegistry {
  private static configPath = path.resolve(process.cwd(), 'accounts.config.json');

  public static loadAccounts(): AccountConfig[] {
    if (!fs.existsSync(this.configPath)) {
      const defaultAccounts: AccountConfig[] = [
        {
          id: 'main',
          name: 'Main Account',
          enabled: true,
          service: 'mobage',
          cdpPort: 9222,
          profileDir: path.resolve(process.env.USERPROFILE || process.env.HOME || '.', '.gbf-iron-profile'),
          credentials: { email: '', password: '' },
          proxy: null
        }
      ];
      this.saveAccounts(defaultAccounts);
      return defaultAccounts;
    }

    try {
      const raw = fs.readFileSync(this.configPath, 'utf-8');
      const parsed = JSON.parse(raw);
      return AccountsListSchema.parse(parsed) as AccountConfig[];
    } catch (err: any) {
      console.warn('[AccountRegistry] Notice loading accounts.config.json:', err.message);
      return [];
    }
  }

  public static getAccountById(id: string): AccountConfig | undefined {
    const accounts = this.loadAccounts();
    return accounts.find(a => a.id.toLowerCase() === id.toLowerCase());
  }

  public static getEnabledAccounts(): AccountConfig[] {
    const accounts = this.loadAccounts();
    return accounts.filter(a => a.enabled);
  }

  public static saveAccounts(accounts: AccountConfig[]): void {
    try {
      fs.writeFileSync(this.configPath, JSON.stringify(accounts, null, 2), 'utf-8');
    } catch (err: any) {
      console.error('[AccountRegistry] Failed to save accounts.config.json:', err.message);
    }
  }
}
