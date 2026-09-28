// src/types/account.types.ts

export type LoginService = 'mobage' | 'dmm' | 'gree' | 'manual';

export interface AccountCredentials {
  email?: string;
  password?: string;
}

export interface VerifiedPlayerProfile {
  name: string;
  rank: string;
  id: string;
}

export interface AccountConfig {
  id: string;
  name: string;
  enabled: boolean;
  service: LoginService;
  cdpPort: number;
  profileDir: string;
  credentials?: AccountCredentials;
  proxy?: string | null;
}

export interface SwarmWorkerProgress {
  accountId: string;
  accountName: string;
  runsCompleted: number;
  meatGained: number;
  lastClearTimeSec: number;
  status: 'STARTING' | 'AUTHENTICATING' | 'FARMING' | 'COMPLETED' | 'ERROR' | 'PAUSED';
  message?: string;
}

export interface SwarmSummary {
  totalAccounts: number;
  totalRunsCompleted: number;
  totalMeatGained: number;
  totalDurationMs: number;
  accountSummaries: Record<string, {
    name: string;
    runs: number;
    meat: number;
    averageSec: number;
    logPath: string;
  }>;
}
