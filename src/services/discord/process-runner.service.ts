import { spawn, ChildProcess } from 'child_process';
import path from 'path';
import fs from 'fs';
import { CdpConnectionManager } from '../../cdp-connection.js';

export interface CommandPreset {
  key: string;
  script: string;
  description: string;
  defaultArgs?: string[];
}

export const COMMAND_WHITELIST: Record<string, CommandPreset> = {
  'daily': {
    key: 'daily',
    script: 'src/cli/run-daily.ts',
    description: 'Universal Pro Skips only (Favorites, Hard+, Omega, Halo, Gacha, Skyscope, Casino)'
  },
  'daily:skips': {
    key: 'daily:skips',
    script: 'src/cli/run-daily.ts',
    description: 'Universal Pro Skips only (Favorites, Hard+, Omega, Halo, Gacha, Skyscope, Casino)'
  },
  'daily:routine': {
    key: 'daily:routine',
    script: 'src/cli/run-daily-routine.ts',
    description: 'Chained Daily Reset Routine (Pro Skips -> Hosted Raids)'
  },
  'daily:host': {
    key: 'daily:host',
    script: 'src/cli/run-daily-host.ts',
    description: 'Daily Raid Hosting Suite (HL, Magna 3, Six Dragons)'
  },
  'daily:hostgb': {
    key: 'daily:hostgb',
    script: 'src/cli/run-daily-host.ts',
    defaultArgs: ['hl'],
    description: 'Daily Gold Bar Raids Hosting only (PBHL, Akasha, GOHL, Lindwurm)'
  },
  'daily:host:gb': {
    key: 'daily:host:gb',
    script: 'src/cli/run-daily-host.ts',
    defaultArgs: ['hl'],
    description: 'Daily Gold Bar Raids Hosting only (PBHL, Akasha, GOHL, Lindwurm)'
  },
  'hostgb': {
    key: 'hostgb',
    script: 'src/cli/run-daily-host.ts',
    defaultArgs: ['hl'],
    description: 'Daily Gold Bar Raids Hosting only (PBHL, Akasha, GOHL, Lindwurm)'
  },
  'gb-pbhl': {
    key: 'gb-pbhl',
    script: 'src/cli/run-workflow.ts',
    defaultArgs: ['acc1', 'gb-pbhl'],
    description: 'Proto Bahamut HL Blue Chest Gold Bar Farm (1.5M min honor rotation)'
  },
  'gb-akasha': {
    key: 'gb-akasha',
    script: 'src/cli/run-workflow.ts',
    defaultArgs: ['acc1', 'gb-akasha'],
    description: 'Akasha HL Blue Chest Gold Bar Farm (1.43M min honor rotation)'
  },
  'gb-go': {
    key: 'gb-go',
    script: 'src/cli/run-workflow.ts',
    defaultArgs: ['acc1', 'gb-go'],
    description: 'Grand Order HL Blue Chest Gold Bar Farm (1.58M min honor rotation)'
  },
  'gb-farm': {
    key: 'gb-farm',
    script: 'src/cli/run-workflow.ts',
    defaultArgs: ['acc1', 'gb-farm'],
    description: 'Tri-Raid Blue Chest Gold Bar Rotation (PBHL -> Akasha -> GOHL)'
  },
  'leech:colossus': {
    key: 'leech:colossus',
    script: 'src/cli/run-leech.ts',
    defaultArgs: ['colossus-ira'],
    description: 'Colossus Ira Fast Leech (1-turn fast damage, immediate exit to next raid)'
  },
  'leech:tiamat': {
    key: 'leech:tiamat',
    script: 'src/cli/run-leech.ts',
    defaultArgs: ['tiamat-aura'],
    description: 'Tiamat Aura Fast Leech (1-turn fast damage, immediate exit to next raid)'
  },
  'farm': {
    key: 'farm',
    script: 'src/cli/run-farm.ts',
    defaultArgs: ['leviathan-mare'],
    description: 'Adaptive Raid Farm (Leviathan Mare: high player density, lowest HP, continuous damage)'
  },
  'farm:leviathan': {
    key: 'farm:leviathan',
    script: 'src/cli/run-farm.ts',
    defaultArgs: ['leviathan-mare'],
    description: 'Leviathan Mare Adaptive Damage Farm (most joined raid, lowest HP, fast reruns)'
  },
  'farm:levi': {
    key: 'farm:levi',
    script: 'src/cli/run-farm.ts',
    defaultArgs: ['leviathan-mare'],
    description: 'Leviathan Mare Adaptive Damage Farm (most joined raid, lowest HP, fast reruns)'
  },
  'farm:celeste': {
    key: 'farm:celeste',
    script: 'src/cli/run-farm.ts',
    defaultArgs: ['celeste-ater'],
    description: 'Celeste Ater Adaptive Damage Farm (most joined raid, lowest HP, fast reruns)'
  },
  'farm:colossus': {
    key: 'farm:colossus',
    script: 'src/cli/run-farm.ts',
    defaultArgs: ['colossus-ira'],
    description: 'Colossus Ira Adaptive Damage Farm (most joined raid, lowest HP, fast reruns)'
  },
  'farm:tiamat': {
    key: 'farm:tiamat',
    script: 'src/cli/run-farm.ts',
    defaultArgs: ['tiamat-aura'],
    description: 'Tiamat Aura Adaptive Damage Farm (most joined raid, lowest HP, fast reruns)'
  },
  'farm:yggdrasil': {
    key: 'farm:yggdrasil',
    script: 'src/cli/run-farm.ts',
    defaultArgs: ['yggdrasil-arbos'],
    description: 'Yggdrasil Arbos Adaptive Damage Farm (most joined raid, lowest HP, fast reruns)'
  },
  'farm:luminiera': {
    key: 'farm:luminiera',
    script: 'src/cli/run-farm.ts',
    defaultArgs: ['luminiera-credo'],
    description: 'Luminiera Credo Adaptive Damage Farm (most joined raid, lowest HP, fast reruns)'
  },
  'leech:leviathan': {
    key: 'leech:leviathan',
    script: 'src/cli/run-leech.ts',
    defaultArgs: ['leviathan-mare'],
    description: 'Leviathan Mare Fast Leech (1-turn fast damage, immediate exit to next raid)'
  },
  'leech:yggdrasil': {
    key: 'leech:yggdrasil',
    script: 'src/cli/run-leech.ts',
    defaultArgs: ['yggdrasil-arbos'],
    description: 'Yggdrasil Arbos Fast Leech (1-turn fast damage, immediate exit to next raid)'
  },
  'leech:luminiera': {
    key: 'leech:luminiera',
    script: 'src/cli/run-leech.ts',
    defaultArgs: ['luminiera-credo'],
    description: 'Luminiera Credo Fast Leech (1-turn fast damage, immediate exit to next raid)'
  },
  'leech:celeste': {
    key: 'leech:celeste',
    script: 'src/cli/run-leech.ts',
    defaultArgs: ['celeste-ater'],
    description: 'Celeste Ater Fast Leech (1-turn fast damage, immediate exit to next raid)'
  },
  'leech:faahl': {
    key: 'leech:faahl',
    script: 'src/cli/run-leech.ts',
    defaultArgs: ['faahl'],
    description: 'Dark Rapture Hard (Lucilius) Fast Leech'
  },
  'leech:belial': {
    key: 'leech:belial',
    script: 'src/cli/run-leech.ts',
    defaultArgs: ['belial'],
    description: 'The Fallen Angel of Cunning (Belial) Fast Leech'
  },
  'leech:bubz': {
    key: 'leech:bubz',
    script: 'src/cli/run-leech.ts',
    defaultArgs: ['bubz'],
    description: 'Long Live the King (Beelzebub) Fast Leech'
  },
  'leech:lindwurm': {
    key: 'leech:lindwurm',
    script: 'src/cli/run-leech.ts',
    defaultArgs: ['lindwurm'],
    description: 'Empyreal Ascension (Lindwurm HL) Fast Leech'
  },
  'leech:wilnas': {
    key: 'leech:wilnas',
    script: 'src/cli/run-leech.ts',
    defaultArgs: ['wilnas'],
    description: 'Wilnas Impossible Fast Leech'
  },
  'leech:fediel': {
    key: 'leech:fediel',
    script: 'src/cli/run-leech.ts',
    defaultArgs: ['fediel'],
    description: 'Fediel Impossible Fast Leech'
  },
  'faahl': {
    key: 'faahl',
    script: 'src/cli/run-workflow.ts',
    defaultArgs: ['acc1', 'raid-dark-rapture-hard'],
    description: 'Dark Rapture Hard (Lucilius) Workflow'
  },
  'belial': {
    key: 'belial',
    script: 'src/cli/run-workflow.ts',
    defaultArgs: ['acc1', 'raid-the-fallen-angel-of-cunning'],
    description: 'The Fallen Angel of Cunning (Belial) Workflow'
  },
  'bubz': {
    key: 'bubz',
    script: 'src/cli/run-workflow.ts',
    defaultArgs: ['acc1', 'raid-long-live-the-king'],
    description: 'Long Live the King (Beelzebub) Workflow'
  },
  'lindwurm': {
    key: 'lindwurm',
    script: 'src/cli/run-workflow.ts',
    defaultArgs: ['acc1', 'raid-empyreal-ascension'],
    description: 'Empyreal Ascension (Lindwurm HL) Workflow'
  },
  'empyreal': {
    key: 'empyreal',
    script: 'src/cli/run-workflow.ts',
    defaultArgs: ['acc1', 'raid-empyreal-ascension'],
    description: 'Empyreal Ascension (Lindwurm HL) Workflow'
  },
  'wilnas': {
    key: 'wilnas',
    script: 'src/cli/run-workflow.ts',
    defaultArgs: ['acc1', 'raid-wilnas'],
    description: 'Wilnas Impossible Raid Workflow'
  },
  'fediel': {
    key: 'fediel',
    script: 'src/cli/run-workflow.ts',
    defaultArgs: ['acc1', 'raid-fediel'],
    description: 'Fediel Impossible Raid Workflow'
  },
  'siete': {
    key: 'siete',
    script: 'src/cli/run-workflow.ts',
    defaultArgs: ['acc1', 'raid-seofon'],
    description: 'Seofon (Impossible) / Siete HL 4M Honors Blue Chest Workflow'
  },
  'seofon': {
    key: 'seofon',
    script: 'src/cli/run-workflow.ts',
    defaultArgs: ['acc1', 'raid-seofon'],
    description: 'Seofon (Impossible) / Siete HL 4M Honors Blue Chest Workflow'
  },
  'raid-seofon': {
    key: 'raid-seofon',
    script: 'src/cli/run-workflow.ts',
    defaultArgs: ['acc1', 'raid-seofon'],
    description: 'Seofon (Impossible) / Siete HL 4M Honors Blue Chest Workflow'
  },
  'siete:check': {
    key: 'siete:check',
    script: 'src/cli/run-siete-check.ts',
    description: 'Seofon (Impossible) Party & Grid Readiness Auditor'
  },
  'siete:setup': {
    key: 'siete:setup',
    script: 'src/cli/run-siete-setup.ts',
    description: 'Seofon (Impossible) Party & Grid Auto-Assembler'
  },
  'agastia': {
    key: 'agastia',
    script: 'src/cli/run-workflow.ts',
    defaultArgs: ['acc1', 'raid-agastia'],
    description: 'Agastia (Impossible) / Agastia HL 4M Honors Blue Chest Workflow'
  },
  'raid-agastia': {
    key: 'raid-agastia',
    script: 'src/cli/run-workflow.ts',
    defaultArgs: ['acc1', 'raid-agastia'],
    description: 'Agastia (Impossible) / Agastia HL 4M Honors Blue Chest Workflow'
  },
  'theworld': {
    key: 'theworld',
    script: 'src/cli/run-workflow.ts',
    defaultArgs: ['acc1', 'raid-the-world'],
    description: 'The World (Impossible) Raid Workflow'
  },
  'leech:siete': {
    key: 'leech:siete',
    script: 'src/cli/run-leech.ts',
    defaultArgs: ['seofon'],
    description: 'Seofon (Impossible) Fast Assist'
  },
  'leech:seofon': {
    key: 'leech:seofon',
    script: 'src/cli/run-leech.ts',
    defaultArgs: ['seofon'],
    description: 'Seofon (Impossible) Fast Assist'
  },
  'leech:agastia': {
    key: 'leech:agastia',
    script: 'src/cli/run-leech.ts',
    defaultArgs: ['agastia'],
    description: 'Agastia (Impossible) Fast Assist'
  },
  'db:3star': {
    key: 'db:3star',
    script: 'src/cli/run-workflow.ts',
    defaultArgs: ['acc1', 'dread-barrage-3star-otk'],
    description: 'Dread Barrage 3-Star OTK (Lvl 90 Corpus Volans, 66M HP)'
  },
  'db3': {
    key: 'db3',
    script: 'src/cli/run-workflow.ts',
    defaultArgs: ['acc1', 'dread-barrage-3star-otk'],
    description: 'Dread Barrage 3-Star OTK (Lvl 90 Corpus Volans, 66M HP)'
  },
  'db:1star': {
    key: 'db:1star',
    script: 'src/cli/run-workflow.ts',
    defaultArgs: ['acc1', 'dread-barrage-1star-otk'],
    description: 'Dread Barrage 1-Star OTK (Lvl 60 Lacerta Currens, 9M HP)'
  },
  'db:2star': {
    key: 'db:2star',
    script: 'src/cli/run-workflow.ts',
    defaultArgs: ['acc1', 'dread-barrage-2star-otk'],
    description: 'Dread Barrage 2-Star OTK (Lvl 75 Ferrum Agile, 21.5M HP)'
  },
  'db:4star': {
    key: 'db:4star',
    script: 'src/cli/run-workflow.ts',
    defaultArgs: ['acc1', 'dread-barrage-4star-fa'],
    description: 'Dread Barrage 4-Star Full Auto (Lvl 95)'
  },
  'db:5star': {
    key: 'db:5star',
    script: 'src/cli/run-workflow.ts',
    defaultArgs: ['acc1', 'dread-barrage-5star-fa'],
    description: 'Dread Barrage 5-Star Full Auto (Lvl 100)'
  },
  'workflow': {
    key: 'workflow',
    script: 'src/cli/run-workflow.ts',
    defaultArgs: ['acc1'],
    description: 'Run arbitrary workflow template (e.g. /gbf workflow raid-wilnas)'
  },
  'leech': {
    key: 'leech',
    script: 'src/cli/run-leech.ts',
    description: 'Run arbitrary raid leech (e.g. /gbf leech colossus-ira)'
  },
  'goldbar': {
    key: 'goldbar',
    script: 'src/cli/report-gold-bars.ts',
    description: 'Gold Bar Drops and Battle Log Audit Summary'
  },
  'fate': {
    key: 'fate',
    script: 'src/cli/run-fate.ts',
    defaultArgs: ['acc1', '10'],
    description: 'Autonomous Fate Episode Skip (10 episodes)'
  },
  'slime': {
    key: 'slime',
    script: 'src/cli/run-workflow.ts',
    defaultArgs: ['acc1', 'shiny-slime-search'],
    description: 'Shiny Slime Search (Very Hard) Fast EXP/RP Farm'
  },
  'shiny-slime': {
    key: 'shiny-slime',
    script: 'src/cli/run-workflow.ts',
    defaultArgs: ['acc1', 'shiny-slime-search'],
    description: 'Shiny Slime Search (Very Hard) Fast EXP/RP Farm'
  },
  'shiny-slime-search': {
    key: 'shiny-slime-search',
    script: 'src/cli/run-workflow.ts',
    defaultArgs: ['acc1', 'shiny-slime-search'],
    description: 'Shiny Slime Search (Very Hard) Fast EXP/RP Farm'
  },
  'farm:human': {
    key: 'farm:human',
    script: 'src/cli/run-human-cadence.ts',
    description: 'Human Behavioral Cadence Farming (GB Priority + Leeching + Rest Gaps + Supply Audits)'
  },
  'inventory': {
    key: 'inventory',
    script: 'src/cli/run-inventory-audit.ts',
    description: 'In-Game Inventory & Supply Audit (#item Gold Bars, Pots, Berries, Moons)'
  }
};

export interface ActiveJob {
  key: string;
  script: string;
  args: string[];
  pid: number;
  startedAt: Date;
  process: ChildProcess;
  outputBuffer: string[];
  stoppedByOperator?: boolean;
  preemptedBy?: string;
}

export interface ProcessStartResult {
  success: boolean;
  message: string;
  pid?: number;
  job?: ActiveJob;
  preemptedJob?: {
    key: string;
    pid: number;
    uptimeFormatted: string;
  };
}

export interface ProcessStatusResult {
  isBusy: boolean;
  job?: {
    key: string;
    script: string;
    args: string[];
    pid: number;
    startedAt: string;
    uptimeFormatted: string;
    lastOutputLines: string[];
  };
}

/**
 * Hardened Process Runner Service for Discord Remote Controller.
 * Enforces a strict single-process concurrency lock on CDP port 9222,
 * zero arbitrary shell code execution (strict whitelist only), real-time output streaming,
 * and automatic preemptive task switching (hot task replacement).
 */
export class ProcessRunnerService {
  private activeJob: ActiveJob | null = null;
  private readonly maxBufferSize = 50;
  private onJobExitCallbacks: ((job: ActiveJob, exitCode: number | null, durationMs: number) => void)[] = [];

  /**
   * Subscribes a callback to receive job completion notifications.
   */
  public onJobExit(cb: (job: ActiveJob, exitCode: number | null, durationMs: number) => void): void {
    this.onJobExitCallbacks.push(cb);
  }

  /**
   * Checks if a process is currently executing.
   */
  public isBusy(): boolean {
    return this.activeJob !== null;
  }

  /**
   * Returns current active job or null.
   */
  public getActiveJob(): ActiveJob | null {
    return this.activeJob;
  }

  /**
   * Starts a whitelisted command preset.
   * If another automation job is already running on exclusive CDP port 9222,
   * automatically halts and preempts the existing job first before launching the new job.
   */
  public async startCommand(commandKey: string, customArgs: string[] = []): Promise<ProcessStartResult> {
    // 1. Whitelist Verification: Strictly validate preset before touching any active process
    const normalizedKey = commandKey.toLowerCase().trim();
    let preset = COMMAND_WHITELIST[normalizedKey];

    // If not in static whitelist, check if it's an existing template in templates/ (including raid- / farm- / leech- prefixed templates)
    if (!preset && /^[a-zA-Z0-9_\-.:]+$/.test(normalizedKey)) {
      const cleanName = normalizedKey.replace(/\.json$/i, '');
      const candidateBases = [
        cleanName,
        `raid-${cleanName}`,
        `farm-${cleanName}`,
        `leech-${cleanName}`,
        `arcarum-${cleanName}`
      ];
      for (const candidate of candidateBases) {
        const templatePath = path.resolve(process.cwd(), 'templates', `${candidate}.json`);
        if (fs.existsSync(templatePath)) {
          if (candidate.startsWith('leech-')) {
            preset = {
              key: candidate,
              script: 'src/cli/run-leech.ts',
              defaultArgs: [candidate],
              description: `Auto-resolved leech workflow (${candidate})`
            };
          } else if (candidate.startsWith('farm-')) {
            preset = {
              key: candidate,
              script: 'src/cli/run-farm.ts',
              defaultArgs: [candidate],
              description: `Auto-resolved farm workflow (${candidate})`
            };
          } else {
            preset = {
              key: candidate,
              script: 'src/cli/run-workflow.ts',
              defaultArgs: ['acc1', candidate],
              description: `Auto-resolved template workflow (${candidate})`
            };
          }
          break;
        }
      }
    }

    if (!preset) {
      const available = Object.keys(COMMAND_WHITELIST).map(k => `\`${k}\``).join(', ');
      return {
        success: false,
        message: `❌ **Unknown Command**: \`${commandKey}\` is not in the authorized command whitelist.\n\nAvailable presets: ${available}\n\nType \`/gbf help\` to view all commands.`
      };
    }

    // 2. Preemptive Task Switching: Gracefully terminate running job to free CDP port 9222
    let preemptedInfo: { key: string; pid: number; uptimeFormatted: string } | null = null;

    if (this.activeJob) {
      const prevJob = this.activeJob;
      const uptimeSec = Math.floor((Date.now() - prevJob.startedAt.getTime()) / 1000);
      const uptimeStr = `${Math.floor(uptimeSec / 60)}m ${uptimeSec % 60}s`;

      preemptedInfo = {
        key: prevJob.key,
        pid: prevJob.pid,
        uptimeFormatted: uptimeStr
      };

      console.log(`[ProcessRunner] 🔄 Preempting running job \`${prevJob.key}\` (PID ${prevJob.pid}, uptime ${uptimeStr}) to start \`${preset.key}\`...`);
      prevJob.preemptedBy = preset.key;
      prevJob.stoppedByOperator = true;

      await this.stopActiveProcess();
      // Grace period to ensure OS socket release on port 9222
      await new Promise(r => setTimeout(r, 400));
    }

    // 3. Assemble and sanitize execution parameters
    // Only allow alphanumeric / dash / underscore arguments to prevent shell injection
    const sanitizedCustomArgs = customArgs.filter(arg => /^[a-zA-Z0-9_\-.:=]+$/.test(arg));
    const finalArgs = [preset.script, ...(preset.defaultArgs || []), ...sanitizedCustomArgs];

    try {
      const startedAt = new Date();
      const outputBuffer: string[] = [];

      const daemonBin = path.resolve(
        process.cwd(),
        'target',
        'release',
        process.platform === 'win32' ? 'gbf-daemon.exe' : 'gbf-daemon'
      );
      const hasRustDaemon = fs.existsSync(daemonBin);

      // Layer 3 OS CPU Governor hook on Linux
      if (process.platform === 'linux' && hasRustDaemon) {
        try {
          const gov = spawn(daemonBin, ['--govern-cpu', '9222', '38'], {
            cwd: process.cwd(),
            stdio: 'ignore',
            detached: true
          });
          gov.unref();
        } catch {}
      }

      const useNativeRustCdp =
        hasRustDaemon &&
        preset.script === 'src/cli/run-workflow.ts' &&
        (process.env.USE_RUST_CDP_ENGINE === 'true' || sanitizedCustomArgs.includes('--native'));

      const spawnBin = useNativeRustCdp ? daemonBin : 'bun';
      const spawnArgs = useNativeRustCdp
        ? ['--run-native', ...(preset.defaultArgs || []), ...sanitizedCustomArgs.filter(a => a !== '--native')]
        : finalArgs;

      console.log(`[ProcessRunner] 🚀 Spawning process: ${useNativeRustCdp ? 'gbf-daemon' : 'bun'} ${spawnArgs.join(' ')}`);

      const child = spawn(spawnBin, spawnArgs, {
        cwd: process.cwd(),
        env: { ...process.env, FORCE_COLOR: '0' },
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe']
      });

      if (!child.pid) {
        throw new Error('Failed to obtain process PID upon spawn.');
      }

      const activeJob: ActiveJob = {
        key: preset.key,
        script: preset.script,
        args: finalArgs,
        pid: child.pid,
        startedAt,
        process: child,
        outputBuffer
      };

      this.activeJob = activeJob;

      const logDir = path.resolve(process.cwd(), 'logs');
      if (!fs.existsSync(logDir)) {
        try { fs.mkdirSync(logDir, { recursive: true }); } catch {}
      }
      const logFile = path.join(logDir, 'automation.log');

      const appendOutput = (data: Buffer | string) => {
        const text = data.toString('utf8');
        const lines = text.split(/\r?\n/).filter(l => l.trim().length > 0);
        for (const line of lines) {
          outputBuffer.push(line);
          if (outputBuffer.length > this.maxBufferSize) {
            outputBuffer.shift();
          }
          try {
            const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 19);
            fs.appendFileSync(logFile, `[${timestamp}] [${preset.key}] ${line}\n`, 'utf8');
          } catch {}
        }
      };

      child.stdout?.on('data', appendOutput);
      child.stderr?.on('data', appendOutput);

      child.on('close', (code) => {
        const durationMs = Date.now() - startedAt.getTime();
        console.log(`[ProcessRunner] 🏁 Job \`${preset.key}\` (PID ${child.pid}) exited with code ${code} in ${(durationMs / 1000).toFixed(1)}s.`);
        
        const finishedJob = this.activeJob || activeJob;
        if (activeJob.stoppedByOperator && finishedJob) {
          finishedJob.stoppedByOperator = true;
        }
        if (activeJob.preemptedBy && finishedJob) {
          finishedJob.preemptedBy = activeJob.preemptedBy;
        }
        this.activeJob = null;

        if (finishedJob) {
          for (const cb of this.onJobExitCallbacks) {
            try {
              cb(finishedJob, code, durationMs);
            } catch (err: any) {
              console.warn(`[ProcessRunner] Exit callback error: ${err.message}`);
            }
          }
        }
      });

      child.on('error', (err) => {
        console.error(`[ProcessRunner] ❌ Child process error:`, err.message);
        appendOutput(`[Process Error]: ${err.message}`);
      });

      let launchMessage = `🚀 **Job Launched**: \`${preset.key}\` (PID: \`${child.pid}\`)\n• **Description**: ${preset.description}\n• **Command**: \`bun ${finalArgs.join(' ')}\``;
      if (preemptedInfo) {
        launchMessage = `🔄 **Task Switched**: Terminated \`${preemptedInfo.key}\` (PID \`${preemptedInfo.pid}\`, ran for \`${preemptedInfo.uptimeFormatted}\`).\n\n` + launchMessage;
      }

      return {
        success: true,
        message: launchMessage,
        pid: child.pid,
        job: activeJob,
        preemptedJob: preemptedInfo || undefined
      };

    } catch (err: any) {
      this.activeJob = null;
      return {
        success: false,
        message: `❌ **Failed to Spawn**: ${err.message}`
      };
    }
  }

  /**
   * Gracefully terminates the currently running job.
   */
  public async stopActiveProcess(): Promise<{ success: boolean; message: string }> {
    if (!this.activeJob) {
      return {
        success: true,
        message: 'ℹ️ No active automation job is currently running.'
      };
    }

    const { key, pid, process: child } = this.activeJob;
    this.activeJob.stoppedByOperator = true;
    console.log(`[ProcessRunner] 🛑 Terminating job \`${key}\` (PID ${pid})...`);

    try {
      if (child.exitCode === null && !child.killed) {
        // 1. Send SIGINT (graceful shutdown)
        child.kill('SIGINT');

        // 2. Wait up to 4 seconds for process to exit
        const exited = await Promise.race([
          new Promise<boolean>(resolve => child.once('close', () => resolve(true))),
          new Promise<boolean>(resolve => setTimeout(() => resolve(false), 4000))
        ]);

        if (!exited && child.exitCode === null) {
          console.log(`[ProcessRunner] ⚠️ SIGINT timed out for PID ${pid}. Sending SIGKILL...`);
          child.kill('SIGKILL');
          await new Promise(r => setTimeout(r, 500));
        }
      }

      // If this was a real OS child process, ensure the GBF browser tab is closed into 0%-CPU standby (about:blank)
      if ((child as any).spawnfile) {
        await CdpConnectionManager.putPortOnStandby().catch(() => false);
      }

      this.activeJob = null;
      return {
        success: true,
        message: `🛑 **Process Halted**: Job \`${key}\` (PID \`${pid}\`) has been successfully terminated. Browser placed in standby mode (\`about:blank\`).`
      };
    } catch (err: any) {
      this.activeJob = null;
      return {
        success: false,
        message: `⚠️ Error terminating process PID \`${pid}\`: ${err.message}`
      };
    }
  }

  /**
   * Retrieves active job status and diagnostic metrics.
   */
  public getStatus(): ProcessStatusResult {
    if (!this.activeJob) {
      return { isBusy: false };
    }

    const uptimeSec = Math.floor((Date.now() - this.activeJob.startedAt.getTime()) / 1000);
    const uptimeFormatted = `${Math.floor(uptimeSec / 60)}m ${uptimeSec % 60}s`;

    return {
      isBusy: true,
      job: {
        key: this.activeJob.key,
        script: this.activeJob.script,
        args: this.activeJob.args,
        pid: this.activeJob.pid,
        startedAt: this.activeJob.startedAt.toISOString(),
        uptimeFormatted,
        lastOutputLines: this.activeJob.outputBuffer.slice(-6)
      }
    };
  }

  /**
   * Retrieves recent log lines from memory or disk.
   */
  public getRecentLogs(maxLines = 15): string[] {
    if (this.activeJob && this.activeJob.outputBuffer.length > 0) {
      return this.activeJob.outputBuffer.slice(-maxLines);
    }

    const logFile = path.resolve(process.cwd(), 'logs', 'automation.log');
    if (fs.existsSync(logFile)) {
      try {
        const content = fs.readFileSync(logFile, 'utf8');
        const lines = content.split(/\r?\n/).filter(l => l.trim().length > 0);
        return lines.slice(-maxLines);
      } catch {}
    }

    return ['_No recent automation logs found._'];
  }
}

export const processRunnerService = new ProcessRunnerService();
