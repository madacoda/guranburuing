// src/services/discord/process-runner.service.ts
import { spawn, ChildProcess } from 'child_process';
import path from 'path';

export interface CommandPreset {
  key: string;
  script: string;
  description: string;
  defaultArgs?: string[];
}

export const COMMAND_WHITELIST: Record<string, CommandPreset> = {
  'daily': {
    key: 'daily',
    script: 'src/cli/run-daily-routine.ts',
    description: 'Chained Universal Pro Skips + Daily Raid Hosting Suite with Self-Healing Retry'
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
  'daily:skips': {
    key: 'daily:skips',
    script: 'src/cli/run-daily.ts',
    description: 'Universal Pro Skips only (Favorites, Hard+, Omega, Halo)'
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
    defaultArgs: ['gb-akasha'],
    description: 'Akasha HL Blue Chest Gold Bar Farm (1.43M min honor rotation)'
  },
  'gb-go': {
    key: 'gb-go',
    script: 'src/cli/run-workflow.ts',
    defaultArgs: ['gb-go'],
    description: 'Grand Order HL Blue Chest Gold Bar Farm (1.58M min honor rotation)'
  },
  'gb-farm': {
    key: 'gb-farm',
    script: 'src/cli/run-workflow.ts',
    defaultArgs: ['gb-farm'],
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
}

export interface ProcessStartResult {
  success: boolean;
  message: string;
  pid?: number;
  job?: ActiveJob;
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
 * zero arbitrary shell code execution (strict whitelist only), and real-time output streaming.
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
   */
  public async startCommand(commandKey: string, customArgs: string[] = []): Promise<ProcessStartResult> {
    // 1. Concurrency Check: CDP port 9222 is exclusive
    if (this.activeJob) {
      const uptimeSec = Math.floor((Date.now() - this.activeJob.startedAt.getTime()) / 1000);
      const uptimeStr = `${Math.floor(uptimeSec / 60)}m ${uptimeSec % 60}s`;
      return {
        success: false,
        message: `⚠️ **Process Concurrency Lock**: Job \`${this.activeJob.key}\` (PID ${this.activeJob.pid}) is currently running (${uptimeStr}). Send \`/stop\` or \`/halt\` first before launching a new job.`
      };
    }

    // 2. Whitelist Verification: Strictly reject unmapped commands
    const normalizedKey = commandKey.toLowerCase().trim();
    const preset = COMMAND_WHITELIST[normalizedKey];
    if (!preset) {
      const available = Object.keys(COMMAND_WHITELIST).map(k => `\`${k}\``).join(', ');
      return {
        success: false,
        message: `❌ **Unknown Command**: \`${commandKey}\` is not in the authorized command whitelist.\n\nAvailable presets: ${available}`
      };
    }

    // 3. Assemble and sanitize execution parameters
    // Only allow alphanumeric / dash / underscore arguments to prevent shell injection
    const sanitizedCustomArgs = customArgs.filter(arg => /^[a-zA-Z0-9_\-.:=]+$/.test(arg));
    const finalArgs = [preset.script, ...(preset.defaultArgs || []), ...sanitizedCustomArgs];

    try {
      const startedAt = new Date();
      const outputBuffer: string[] = [];

      console.log(`[ProcessRunner] 🚀 Spawning process: bun ${finalArgs.join(' ')}`);

      const child = spawn('bun', finalArgs, {
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

      const appendOutput = (data: Buffer | string) => {
        const text = data.toString('utf8');
        const lines = text.split(/\r?\n/).filter(l => l.trim().length > 0);
        for (const line of lines) {
          outputBuffer.push(line);
          if (outputBuffer.length > this.maxBufferSize) {
            outputBuffer.shift();
          }
        }
      };

      child.stdout?.on('data', appendOutput);
      child.stderr?.on('data', appendOutput);

      child.on('close', (code) => {
        const durationMs = Date.now() - startedAt.getTime();
        console.log(`[ProcessRunner] 🏁 Job \`${preset.key}\` (PID ${child.pid}) exited with code ${code} in ${(durationMs / 1000).toFixed(1)}s.`);
        
        const finishedJob = this.activeJob;
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

      return {
        success: true,
        message: `🚀 **Job Launched**: \`${preset.key}\` (PID: \`${child.pid}\`)\n• **Description**: ${preset.description}\n• **Command**: \`bun ${finalArgs.join(' ')}\``,
        pid: child.pid,
        job: activeJob
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
    console.log(`[ProcessRunner] 🛑 Terminating job \`${key}\` (PID ${pid})...`);

    try {
      // 1. Send SIGINT (graceful shutdown)
      child.kill('SIGINT');

      // 2. Wait up to 4 seconds for process to exit
      const exited = await Promise.race([
        new Promise<boolean>(resolve => child.on('close', () => resolve(true))),
        new Promise<boolean>(resolve => setTimeout(() => resolve(false), 4000))
      ]);

      if (!exited) {
        console.log(`[ProcessRunner] ⚠️ SIGINT timed out for PID ${pid}. Sending SIGKILL...`);
        child.kill('SIGKILL');
      }

      this.activeJob = null;
      return {
        success: true,
        message: `🛑 **Process Halted**: Job \`${key}\` (PID \`${pid}\`) has been successfully terminated.`
      };
    } catch (err: any) {
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
}

export const processRunnerService = new ProcessRunnerService();
