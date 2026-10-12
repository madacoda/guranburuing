// src/config.ts
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { z } from 'zod';

// Detect initial environment before cascading secondary .env files
const rawEnv = (process.env.APP_ENV || process.env.NODE_ENV || '').toLowerCase();
const isExplicitProd = rawEnv === 'production' || rawEnv === 'prod';
const isExplicitLocal = rawEnv === 'local' || rawEnv === 'development' || rawEnv === 'dev';
const isLinuxServer = process.platform === 'linux' && !process.env.DISPLAY;
const initialAppEnv: 'production' | 'local' | 'test' = process.env.NODE_ENV === 'test'
  ? 'test'
  : (isExplicitProd || (!isExplicitLocal && isLinuxServer) ? 'production' : 'local');

// 1. Load primary .env
dotenv.config();

// 2. Cascade load .env.local or .env.production if present
const envFile = initialAppEnv === 'production' ? '.env.production' : '.env.local';
const envPath = path.resolve(process.cwd(), envFile);
if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath, override: true });
}

const isProdEnv = (process.env.APP_ENV || initialAppEnv) === 'production';

const ConfigSchema = z.object({
  APP_ENV: z.enum(['local', 'production', 'test']).default(initialAppEnv),
  PORT: z.coerce.number().default(3000),
  HOST: z.string().default('0.0.0.0'),
  AUTH_TOKEN: z.string().min(16, 'AUTH_TOKEN must be at least 16 characters for security.').default('change_me_to_at_least_16_chars_super_secret'),
  CDP_PORT: z.coerce.number().default(9222),
  TELEGRAM_BOT_TOKEN: z.preprocess((val) => (val === '' ? undefined : val), z.string().optional()),
  TELEGRAM_CHAT_ID: z.preprocess((val) => (val === '' ? undefined : val), z.string().optional()),
  DISCORD_WEBHOOK_URL: z.preprocess((val) => (val === '' ? undefined : val), z.string().url().optional()),
  DISCORD_BOT_TOKEN: z.preprocess((val) => (val === '' ? undefined : val), z.string().optional()),
  DISCORD_USER_ID: z.preprocess((val) => (val === '' ? undefined : val), z.string().optional()),
  DISCORD_CLIENT_ID: z.preprocess((val) => (val === '' ? undefined : val), z.string().optional()).default('1554396837127921714'),
  DISCORD_PRESENCE_ENABLED: z.preprocess((val) => val === undefined ? true : (val === 'true' || val === true || val === '1'), z.boolean()).default(true),
  DISCORD_PRESENCE_MODE: z.preprocess((val) => (val === '' ? undefined : val), z.enum(['gbf', 'work', 'trade']).default('gbf')),
  DISCORD_PRESENCE_PROJECT: z.preprocess((val) => (val === '' ? undefined : val), z.string().default('Every Hero')),
  DRY_STREAK_MODE: z.enum(['blue_chest', 'min_honor', 'all_battles']).default('blue_chest'),
  HEADLESS: z.preprocess((val) => {
    if (val === undefined) return isProdEnv;
    return val === 'true' || val === true || val === '1';
  }, z.boolean()).default(isProdEnv),
  SPEED_PROFILE: z.enum(['stealth', 'fast', 'turbo']).default(isProdEnv ? 'turbo' : 'fast'),
  COMBAT_AUTO_REFRESH: z.preprocess((val) => val === undefined ? true : (val === 'true' || val === true || val === '1'), z.boolean()).default(true),
  AUTO_LAUNCH_CHROME: z.preprocess((val) => val === undefined ? true : (val === 'true' || val === true || val === '1'), z.boolean()).default(true),
  EXECUTION_MODE: z.enum(['dom', 'hybrid']).default(isProdEnv ? 'dom' : 'hybrid'),
  TICKER_FPS: z.coerce.number().default(60),
  AUTO_MUTE_GAME: z.preprocess((val) => val === undefined ? isProdEnv : (val === 'true' || val === true || val === '1'), z.boolean()).default(isProdEnv),
  VIEWPORT_WIDTH: z.coerce.number().default(isProdEnv ? 360 : 480),
  VIEWPORT_HEIGHT: z.coerce.number().default(isProdEnv ? 720 : 960),
  V8_MAX_OLD_SPACE: z.coerce.number().default(isProdEnv ? 1024 : 2048),
  DISK_CACHE_SIZE: z.coerce.number().default(isProdEnv ? 536870912 : 104857600),
});

export type BaseAppConfig = z.infer<typeof ConfigSchema>;

export interface AppConfig extends BaseAppConfig {
  isProduction: boolean;
  isLocal: boolean;
  isTest: boolean;
}

const rawParsed = ConfigSchema.parse({
  APP_ENV: process.env.APP_ENV,
  PORT: process.env.PORT,
  HOST: process.env.HOST,
  AUTH_TOKEN: process.env.AUTH_TOKEN,
  CDP_PORT: process.env.CDP_PORT,
  TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN,
  TELEGRAM_CHAT_ID: process.env.TELEGRAM_CHAT_ID,
  DISCORD_WEBHOOK_URL: process.env.DISCORD_WEBHOOK_URL,
  DISCORD_BOT_TOKEN: process.env.DISCORD_BOT_TOKEN,
  DISCORD_USER_ID: process.env.DISCORD_USER_ID,
  DISCORD_CLIENT_ID: process.env.DISCORD_CLIENT_ID,
  DISCORD_PRESENCE_ENABLED: process.env.DISCORD_PRESENCE_ENABLED,
  DISCORD_PRESENCE_MODE: process.env.DISCORD_PRESENCE_MODE,
  DISCORD_PRESENCE_PROJECT: process.env.DISCORD_PRESENCE_PROJECT,
  DRY_STREAK_MODE: process.env.DRY_STREAK_MODE,
  HEADLESS: process.env.HEADLESS,
  SPEED_PROFILE: process.env.SPEED_PROFILE,
  COMBAT_AUTO_REFRESH: process.env.COMBAT_AUTO_REFRESH,
  AUTO_LAUNCH_CHROME: process.env.AUTO_LAUNCH_CHROME,
  EXECUTION_MODE: process.env.EXECUTION_MODE,
  TICKER_FPS: process.env.TICKER_FPS,
  AUTO_MUTE_GAME: process.env.AUTO_MUTE_GAME,
  VIEWPORT_WIDTH: process.env.VIEWPORT_WIDTH,
  VIEWPORT_HEIGHT: process.env.VIEWPORT_HEIGHT,
  V8_MAX_OLD_SPACE: process.env.V8_MAX_OLD_SPACE,
  DISK_CACHE_SIZE: process.env.DISK_CACHE_SIZE,
});

export const config: AppConfig = {
  ...rawParsed,
  get isProduction(): boolean {
    return this.APP_ENV === 'production';
  },
  get isLocal(): boolean {
    return this.APP_ENV === 'local';
  },
  get isTest(): boolean {
    return this.APP_ENV === 'test';
  },
};
