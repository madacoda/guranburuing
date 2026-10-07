// src/domain/gold-bar/gold-bar.catalog.ts
import { GoldBarRaidDefinition, GoldBarRaidId } from './gold-bar.types.js';

export const GOLD_BAR_RAID_CATALOG: Record<GoldBarRaidId, GoldBarRaidDefinition> = {
  pbhl: {
    id: 'pbhl',
    name: 'Proto Bahamut HL',
    shortName: 'PBHL',
    questId: '301061',
    chapterId: '30106',
    finderSlot: 4,
    defaultTargetScore: 1480000,
    defaultLogPath: 'logs/gb-pbhl.md',
    supporterPriorities: ['Hades 250', 'Bahamut 250', 'Hades', 'Bahamut', 'Lucifer', 'Kaguya'],
    sweetSpotMinHp: 70,
    sweetSpotMaxPlayers: 3,
    sweetSpotBackupMinHp: 50,
    sweetSpotBackupMaxPlayers: 4
  },
  akasha: {
    id: 'akasha',
    name: 'Omen of the Broken Skies',
    shortName: 'Akasha',
    questId: '303251',
    chapterId: '30325',
    finderSlot: 3,
    defaultTargetScore: 1560000,
    defaultLogPath: 'logs/gb-akasha.md',
    supporterPriorities: ['Hades 250', 'Bahamut 250', 'Hades', 'Bahamut', 'Lucifer', 'Kaguya'],
    sweetSpotMinHp: 70,
    sweetSpotMaxPlayers: 3,
    sweetSpotBackupMinHp: 50,
    sweetSpotBackupMaxPlayers: 4
  },
  go: {
    id: 'go',
    name: "The Peacemaker's Wings (Impossible)",
    shortName: 'GO HL',
    questId: '305161',
    chapterId: '30516',
    finderSlot: 2,
    defaultTargetScore: 1480000,
    defaultLogPath: 'logs/gb-go.md',
    supporterPriorities: ['Hades 250', 'Bahamut 250', 'Hades', 'Bahamut', 'Lucifer', 'Kaguya'],
    sweetSpotMinHp: 70,
    sweetSpotMaxPlayers: 3,
    sweetSpotBackupMinHp: 50,
    sweetSpotBackupMaxPlayers: 4
  }
};
