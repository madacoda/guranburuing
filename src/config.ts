// src/config.ts
import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const ConfigSchema = z.object({
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
  HEADLESS: z.preprocess((val) => val === undefined ? false : (val === 'true' || val === true || val === '1'), z.boolean()).default(false),
  SPEED_PROFILE: z.enum(['stealth', 'fast', 'turbo']).default('fast'),
  COMBAT_AUTO_REFRESH: z.preprocess((val) => val === undefined ? true : (val === 'true' || val === true || val === '1'), z.boolean()).default(true),
  AUTO_LAUNCH_CHROME: z.preprocess((val) => val === undefined ? true : (val === 'true' || val === true || val === '1'), z.boolean()).default(true),
  EXECUTION_MODE: z.enum(['dom', 'hybrid']).default('hybrid'),
});

export type AppConfig = z.infer<typeof ConfigSchema>;

export const config: AppConfig = ConfigSchema.parse({
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
});
