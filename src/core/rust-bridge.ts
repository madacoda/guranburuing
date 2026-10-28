// src/core/rust-bridge.ts
import fs from 'node:fs';
import path from 'node:path';

export const RUST_FLAG_GOLD_BAR = 1 << 0;
export const RUST_FLAG_BLUE_CHEST = 1 << 1;
export const RUST_FLAG_CAPTCHA = 1 << 2;
export const RUST_FLAG_BATTLE_FINISH = 1 << 3;

export interface RustPayloadFlags {
  rawMask: number;
  hasGoldBar: boolean;
  hasBlueChest: boolean;
  hasCaptcha: boolean;
  isBattleFinished: boolean;
}

export interface RustCombatMetrics {
  turnDamage: number;
  userPoint: number | null;
  turn: number | null;
  bossHp: number | null;
  bossMaxHp: number | null;
  flags: RustPayloadFlags;
}

export interface RustVelocityMetrics {
  observations: number;
  elapsedSec: number;
  hpBurnPerSec: number;
  playerJoinRate: number;
  estimatedTtdSec: number | null;
  isStalled: boolean;
}

export interface BezierStep {
  x: number;
  y: number;
  delayMs: number;
}

export interface RustDslFastToken {
  opcode: number;
  arg1: number;
  arg2: number;
  arg3: number;
  arg4: number;
}

// Pre-allocated static buffers for zero-allocation FFI data exchange
const xyBuf = new Float64Array(2);
const bezierBuf = new Float64Array(48); // Up to 16 steps * 3 (x, y, delayMs)
const metricsBuf = new Float64Array(6);
const dslTokenBuf = new Int32Array(5);
const catalogOutBuf = new Uint32Array(3);
const scratchBytes = new Uint8Array(512 * 1024); // 512 KB reusable zero-alloc UTF-8 buffer
const dstScratchBytes = new Uint8Array(4096);
const dpapiOutBuf = new Uint8Array(4096);
const textEncoder = new TextEncoder();

interface NativeSymbols {
  gbf_core_version: () => number;
  gbf_sample_gaussian: (mean: number, stdDev: number) => number;
  gbf_log_normal_delay: (medianMs: number, shape: number, speedProfile: number, isProduction: number) => number;
  gbf_inter_run_delay: (speedProfile: number, isProduction: number) => number;
  gbf_evaluate_cubic_bezier: (
    p0x: number,
    p0y: number,
    p1x: number,
    p1y: number,
    p2x: number,
    p2y: number,
    p3x: number,
    p3y: number,
    t: number,
    outXyPtr: number
  ) => void;
  gbf_sample_target_coord: (bx: number, by: number, bw: number, bh: number, outXyPtr: number) => void;
  gbf_compute_bezier_trajectory: (
    startX: number,
    startY: number,
    targetX: number,
    targetY: number,
    speedProfile: number,
    outBufPtr: number,
    outCap: number
  ) => number;
  gbf_scan_payload_flags: (ptr: number, len: number) => number;
  gbf_extract_combat_metrics: (ptr: number, len: number, outMetricsPtr: number) => number;
  gbf_raid_velocity_record: (
    idPtr: number,
    idLen: number,
    hpPct: number,
    players: number,
    nowMs: number,
    ttlMs: number,
    outMetricsPtr: number
  ) => void;
  gbf_raid_velocity_get: (
    idPtr: number,
    idLen: number,
    nowMs: number,
    ttlMs: number,
    outMetricsPtr: number
  ) => number;
  gbf_raid_velocity_clear: () => void;
  gbf_raid_velocity_size: () => number;
  gbf_next_daily_reset_utc_ms: (refUtcMs: number, targetHourJst: number, bufferSeconds: number) => number;
  gbf_server_day_ymd: (utcMs: number) => number;
  gbf_parse_dsl_line: (ptr: number, len: number, outIntsPtr: number) => number;
  gbf_catalog_load: (ptr: number, len: number) => number;
  gbf_catalog_lookup_raid: (ptr: number, len: number, outIntsPtr: number) => number;
  gbf_catalog_optimal_element: (ptr: number, len: number) => number;
  gbf_catalog_counts: (outIntsPtr: number) => void;
  gbf_probe_cdp_port: (port: number, timeoutMs: number) => number;
  gbf_clean_profile_locks: (ptr: number, len: number) => number;
  gbf_copy_locked_file: (srcPtr: number, srcLen: number, dstPtr: number, dstLen: number) => number;
  gbf_dpapi_unprotect: (inPtr: number, inLen: number, outPtr: number, outCap: number) => number;
  gbf_patch_chrome_preferences: (ptr: number, len: number) => number;
  gbf_put_port_on_standby: (port: number, preserveVerification: number) => number;
  gbf_hash_frame_bytes: (ptr: number, len: number) => bigint;
}

let symbols: NativeSymbols | null = null;
let ffiPtrFn: ((buf: TypedArrayOrBuffer) => number) | null = null;
let loadedLibPath: string | null = null;

type TypedArrayOrBuffer = Uint8Array | Float64Array | Int32Array | ArrayBufferView;

function resolveNativeLibraryPath(): string | null {
  if (process.env.GBF_DISABLE_RUST === 'true' || process.env.GBF_DISABLE_RUST === '1') {
    return null;
  }

  const platform = process.platform;
  const libFileName =
    platform === 'win32'
      ? 'gbf_core.dll'
      : platform === 'darwin'
        ? 'libgbf_core.dylib'
        : 'libgbf_core.so';

  const candidates = [
    process.env.GBF_RUST_LIB_PATH,
    path.resolve(process.cwd(), 'target', 'release', libFileName),
    path.resolve(process.cwd(), 'crates', 'gbf-core', 'target', 'release', libFileName),
    path.resolve(process.cwd(), 'target', 'debug', libFileName)
  ].filter((p): p is string => Boolean(p));

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

function initRustBridge(): void {
  if (symbols !== null) return;
  const isBun = typeof (process.versions as any)?.bun !== 'undefined';
  if (!isBun) return;

  const libPath = resolveNativeLibraryPath();
  if (!libPath) return;

  try {
    // Dynamic synchronous require of bun:ffi so Node.js/tsx never fails on module parse
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const bunFfi = require('bun:ffi');
    const { dlopen, FFIType, ptr } = bunFfi;

    const lib = dlopen(libPath, {
      gbf_core_version: {
        args: [],
        returns: FFIType.u32
      },
      gbf_sample_gaussian: {
        args: [FFIType.f64, FFIType.f64],
        returns: FFIType.f64
      },
      gbf_log_normal_delay: {
        args: [FFIType.f64, FFIType.f64, FFIType.u8, FFIType.u8],
        returns: FFIType.u32
      },
      gbf_inter_run_delay: {
        args: [FFIType.u8, FFIType.u8],
        returns: FFIType.u32
      },
      gbf_evaluate_cubic_bezier: {
        args: [
          FFIType.f64,
          FFIType.f64,
          FFIType.f64,
          FFIType.f64,
          FFIType.f64,
          FFIType.f64,
          FFIType.f64,
          FFIType.f64,
          FFIType.f64,
          FFIType.ptr
        ],
        returns: FFIType.void
      },
      gbf_sample_target_coord: {
        args: [FFIType.f64, FFIType.f64, FFIType.f64, FFIType.f64, FFIType.ptr],
        returns: FFIType.void
      },
      gbf_compute_bezier_trajectory: {
        args: [
          FFIType.f64,
          FFIType.f64,
          FFIType.f64,
          FFIType.f64,
          FFIType.u8,
          FFIType.ptr,
          FFIType.usize
        ],
        returns: FFIType.u32
      },
      gbf_scan_payload_flags: {
        args: [FFIType.ptr, FFIType.usize],
        returns: FFIType.u32
      },
      gbf_extract_combat_metrics: {
        args: [FFIType.ptr, FFIType.usize, FFIType.ptr],
        returns: FFIType.u32
      },
      gbf_raid_velocity_record: {
        args: [
          FFIType.ptr,
          FFIType.usize,
          FFIType.f64,
          FFIType.i32,
          FFIType.f64,
          FFIType.f64,
          FFIType.ptr
        ],
        returns: FFIType.void
      },
      gbf_raid_velocity_get: {
        args: [FFIType.ptr, FFIType.usize, FFIType.f64, FFIType.f64, FFIType.ptr],
        returns: FFIType.u32
      },
      gbf_raid_velocity_clear: {
        args: [],
        returns: FFIType.void
      },
      gbf_raid_velocity_size: {
        args: [],
        returns: FFIType.u32
      },
      gbf_next_daily_reset_utc_ms: {
        args: [FFIType.f64, FFIType.u32, FFIType.u32],
        returns: FFIType.f64
      },
      gbf_server_day_ymd: {
        args: [FFIType.f64],
        returns: FFIType.u32
      },
      gbf_parse_dsl_line: {
        args: [FFIType.ptr, FFIType.usize, FFIType.ptr],
        returns: FFIType.i32
      },
      gbf_catalog_load: {
        args: [FFIType.ptr, FFIType.usize],
        returns: FFIType.u32
      },
      gbf_catalog_lookup_raid: {
        args: [FFIType.ptr, FFIType.usize, FFIType.ptr],
        returns: FFIType.u32
      },
      gbf_catalog_optimal_element: {
        args: [FFIType.ptr, FFIType.usize],
        returns: FFIType.u32
      },
      gbf_catalog_counts: {
        args: [FFIType.ptr],
        returns: FFIType.void
      },
      gbf_probe_cdp_port: {
        args: [FFIType.u16, FFIType.u32],
        returns: FFIType.u32
      },
      gbf_clean_profile_locks: {
        args: [FFIType.ptr, FFIType.usize],
        returns: FFIType.u32
      },
      gbf_copy_locked_file: {
        args: [FFIType.ptr, FFIType.usize, FFIType.ptr, FFIType.usize],
        returns: FFIType.u32
      },
      gbf_dpapi_unprotect: {
        args: [FFIType.ptr, FFIType.usize, FFIType.ptr, FFIType.usize],
        returns: FFIType.u32
      },
      gbf_patch_chrome_preferences: {
        args: [FFIType.ptr, FFIType.usize],
        returns: FFIType.u32
      },
      gbf_put_port_on_standby: {
        args: [FFIType.u16, FFIType.u8],
        returns: FFIType.i32
      },
      gbf_hash_frame_bytes: {
        args: [FFIType.ptr, FFIType.usize],
        returns: FFIType.u64
      }
    });

    if (lib?.symbols?.gbf_core_version() === 100) {
      symbols = lib.symbols as unknown as NativeSymbols;
      ffiPtrFn = ptr;
      loadedLibPath = libPath;
    }
  } catch {
    symbols = null;
    ffiPtrFn = null;
    loadedLibPath = null;
  }
}

// Initialize eagerly on import
initRustBridge();

function encodeToBytes(input: string | Uint8Array): { buf: Uint8Array; len: number } {
  if (input instanceof Uint8Array) {
    return { buf: input, len: input.byteLength };
  }
  // If string cannot possibly exceed scratchBytes (UTF-8 max 3 bytes per BMP code unit)
  if (input.length * 3 <= scratchBytes.byteLength) {
    const { written } = textEncoder.encodeInto(input, scratchBytes);
    return { buf: scratchBytes, len: written };
  }
  const encoded = textEncoder.encode(input);
  return { buf: encoded, len: encoded.byteLength };
}

export function decodePayloadFlags(mask: number): RustPayloadFlags {
  return {
    rawMask: mask,
    hasGoldBar: (mask & RUST_FLAG_GOLD_BAR) !== 0,
    hasBlueChest: (mask & RUST_FLAG_BLUE_CHEST) !== 0,
    hasCaptcha: (mask & RUST_FLAG_CAPTCHA) !== 0,
    isBattleFinished: (mask & RUST_FLAG_BATTLE_FINISH) !== 0
  };
}

export function speedProfileToCode(profile: 'stealth' | 'fast' | 'turbo'): number {
  if (profile === 'turbo') return 2;
  if (profile === 'fast') return 1;
  return 0;
}

export const rustBridge = {
  isActive(): boolean {
    return symbols !== null && ffiPtrFn !== null;
  },

  getLibraryPath(): string | null {
    return loadedLibPath;
  },

  getVersion(): number {
    return symbols ? symbols.gbf_core_version() : 0;
  },

  sampleGaussian(mean = 0, stdDev = 1): number | null {
    if (!symbols) return null;
    return symbols.gbf_sample_gaussian(mean, stdDev);
  },

  sampleLogNormalDelay(
    medianMs: number,
    shape: number,
    speedProfile: 'stealth' | 'fast' | 'turbo',
    isProduction: boolean
  ): number | null {
    if (!symbols) return null;
    return symbols.gbf_log_normal_delay(
      medianMs,
      shape,
      speedProfileToCode(speedProfile),
      isProduction ? 1 : 0
    );
  },

  sampleInterRunDelay(
    speedProfile: 'stealth' | 'fast' | 'turbo',
    isProduction: boolean
  ): number | null {
    if (!symbols) return null;
    return symbols.gbf_inter_run_delay(speedProfileToCode(speedProfile), isProduction ? 1 : 0);
  },

  evaluateCubicBezier(
    p0: { x: number; y: number },
    p1: { x: number; y: number },
    p2: { x: number; y: number },
    p3: { x: number; y: number },
    t: number
  ): { x: number; y: number } | null {
    if (!symbols || !ffiPtrFn) return null;
    symbols.gbf_evaluate_cubic_bezier(
      p0.x,
      p0.y,
      p1.x,
      p1.y,
      p2.x,
      p2.y,
      p3.x,
      p3.y,
      t,
      ffiPtrFn(xyBuf)
    );
    return { x: xyBuf[0], y: xyBuf[1] };
  },

  sampleTargetCoordinate(box: {
    x: number;
    y: number;
    width: number;
    height: number;
  }): { x: number; y: number } | null {
    if (!symbols || !ffiPtrFn) return null;
    symbols.gbf_sample_target_coord(box.x, box.y, box.width, box.height, ffiPtrFn(xyBuf));
    return { x: xyBuf[0], y: xyBuf[1] };
  },

  computeBezierTrajectory(
    start: { x: number; y: number },
    target: { x: number; y: number },
    speedProfile: 'stealth' | 'fast' | 'turbo'
  ): BezierStep[] | null {
    if (!symbols || !ffiPtrFn) return null;
    const count = symbols.gbf_compute_bezier_trajectory(
      start.x,
      start.y,
      target.x,
      target.y,
      speedProfileToCode(speedProfile),
      ffiPtrFn(bezierBuf),
      bezierBuf.length
    );
    const steps: BezierStep[] = new Array(count);
    for (let i = 0; i < count; i++) {
      const base = i * 3;
      steps[i] = {
        x: bezierBuf[base],
        y: bezierBuf[base + 1],
        delayMs: bezierBuf[base + 2]
      };
    }
    return steps;
  },

  scanPayloadFlags(payload: string | Uint8Array): RustPayloadFlags | null {
    if (!symbols || !ffiPtrFn) return null;
    const { buf, len } = encodeToBytes(payload);
    if (len === 0) return decodePayloadFlags(0);
    const mask = symbols.gbf_scan_payload_flags(ffiPtrFn(buf), len);
    return decodePayloadFlags(mask);
  },

  extractCombatMetrics(payload: string | Uint8Array): RustCombatMetrics | null {
    if (!symbols || !ffiPtrFn) return null;
    const { buf, len } = encodeToBytes(payload);
    if (len === 0) return null;
    const ok = symbols.gbf_extract_combat_metrics(ffiPtrFn(buf), len, ffiPtrFn(metricsBuf));
    if (!ok) return null;
    return {
      turnDamage: metricsBuf[0],
      userPoint: metricsBuf[1] >= 0 ? metricsBuf[1] : null,
      turn: metricsBuf[2] >= 0 ? metricsBuf[2] : null,
      bossHp: metricsBuf[3] >= 0 ? metricsBuf[3] : null,
      bossMaxHp: metricsBuf[4] >= 0 ? metricsBuf[4] : null,
      flags: decodePayloadFlags(metricsBuf[5])
    };
  },

  recordRaidVelocity(
    raidId: string,
    hpPct: number,
    players: number,
    nowMs = Date.now(),
    ttlMs = 180000
  ): RustVelocityMetrics | null {
    if (!symbols || !ffiPtrFn) return null;
    const { buf, len } = encodeToBytes(raidId);
    if (len === 0) {
      return {
        observations: 1,
        elapsedSec: 0,
        hpBurnPerSec: 0,
        playerJoinRate: 0,
        estimatedTtdSec: null,
        isStalled: false
      };
    }
    symbols.gbf_raid_velocity_record(
      ffiPtrFn(buf),
      len,
      hpPct,
      players,
      nowMs,
      ttlMs,
      ffiPtrFn(metricsBuf)
    );
    return {
      observations: metricsBuf[0],
      elapsedSec: metricsBuf[1],
      hpBurnPerSec: metricsBuf[2],
      playerJoinRate: metricsBuf[3],
      estimatedTtdSec: metricsBuf[4] >= 0 ? metricsBuf[4] : null,
      isStalled: metricsBuf[5] > 0.5
    };
  },

  getRaidVelocity(
    raidId: string,
    nowMs = Date.now(),
    ttlMs = 180000
  ): RustVelocityMetrics | undefined | null {
    if (!symbols || !ffiPtrFn) return null;
    const { buf, len } = encodeToBytes(raidId);
    if (len === 0) return undefined;
    const found = symbols.gbf_raid_velocity_get(
      ffiPtrFn(buf),
      len,
      nowMs,
      ttlMs,
      ffiPtrFn(metricsBuf)
    );
    if (!found) return undefined;
    return {
      observations: metricsBuf[0],
      elapsedSec: metricsBuf[1],
      hpBurnPerSec: metricsBuf[2],
      playerJoinRate: metricsBuf[3],
      estimatedTtdSec: metricsBuf[4] >= 0 ? metricsBuf[4] : null,
      isStalled: metricsBuf[5] > 0.5
    };
  },

  clearRaidVelocity(): void {
    if (symbols) symbols.gbf_raid_velocity_clear();
  },

  getRaidVelocitySize(): number | null {
    if (!symbols) return null;
    return symbols.gbf_raid_velocity_size();
  },

  getNextDailyResetUtcMs(
    referenceUtcMs = Date.now(),
    targetHourJst = 21,
    bufferSeconds = 15
  ): number | null {
    if (!symbols) return null;
    return symbols.gbf_next_daily_reset_utc_ms(referenceUtcMs, targetHourJst, bufferSeconds);
  },

  getGbfServerDayYmd(utcMs = Date.now()): string | null {
    if (!symbols) return null;
    const ymd = symbols.gbf_server_day_ymd(utcMs);
    const y = Math.floor(ymd / 10000);
    const m = Math.floor((ymd % 10000) / 100);
    const d = ymd % 100;
    return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  },

  parseDslLineFast(line: string): RustDslFastToken | null {
    if (!symbols || !ffiPtrFn) return null;
    const { buf, len } = encodeToBytes(line);
    if (len === 0) {
      return { opcode: 0, arg1: 0, arg2: 0, arg3: 0, arg4: 0 };
    }
    symbols.gbf_parse_dsl_line(ffiPtrFn(buf), len, ffiPtrFn(dslTokenBuf));
    return {
      opcode: dslTokenBuf[0],
      arg1: dslTokenBuf[1],
      arg2: dslTokenBuf[2],
      arg3: dslTokenBuf[3],
      arg4: dslTokenBuf[4]
    };
  },

  tokenizeDslLine(line: string): RustDslFastToken | null {
    return this.parseDslLineFast(line);
  },

  loadCatalog(dataDir: string): number | null {
    if (!symbols || !ffiPtrFn) return null;
    const { buf, len } = encodeToBytes(dataDir);
    if (len === 0) return 0;
    return symbols.gbf_catalog_load(ffiPtrFn(buf), len);
  },

  lookupRaidInCatalog(query: string): { questId: number; blueChestHonors: number } | null {
    if (!symbols || !ffiPtrFn) return null;
    const { buf, len } = encodeToBytes(query);
    if (len === 0) return { questId: 0, blueChestHonors: 0 };
    symbols.gbf_catalog_lookup_raid(ffiPtrFn(buf), len, ffiPtrFn(catalogOutBuf));
    return {
      questId: catalogOutBuf[0],
      blueChestHonors: catalogOutBuf[1]
    };
  },

  lookupRaid(query: string): { questId: number; blueChestHonors: number } | null {
    return this.lookupRaidInCatalog(query);
  },

  lookupOptimalElementCode(bossElement: string): number | null {
    if (!symbols || !ffiPtrFn) return null;
    const { buf, len } = encodeToBytes(bossElement);
    if (len === 0) return 6;
    return symbols.gbf_catalog_optimal_element(ffiPtrFn(buf), len);
  },

  getCatalogCounts(): { raids: number; omens: number; selectors: number } | null {
    if (!symbols || !ffiPtrFn) return null;
    symbols.gbf_catalog_counts(ffiPtrFn(catalogOutBuf));
    return {
      raids: catalogOutBuf[0],
      omens: catalogOutBuf[1],
      selectors: catalogOutBuf[2]
    };
  },

  probeCdpPort(port: number, timeoutMs = 150): boolean | null {
    if (!symbols) return null;
    return symbols.gbf_probe_cdp_port(port, timeoutMs) !== 0;
  },

  cleanProfileLocks(profileDir: string): number | null {
    if (!symbols || !ffiPtrFn) return null;
    const { buf, len } = encodeToBytes(profileDir);
    if (len === 0) return 0;
    return symbols.gbf_clean_profile_locks(ffiPtrFn(buf), len);
  },

  copyLockedFile(srcPath: string, dstPath: string): boolean | null {
    if (!symbols || !ffiPtrFn) return null;
    const srcEncoded = encodeToBytes(srcPath);
    if (srcEncoded.len === 0) return false;
    const { written: dstLen } = textEncoder.encodeInto(dstPath, dstScratchBytes);
    if (dstLen === 0) return false;
    return (
      symbols.gbf_copy_locked_file(
        ffiPtrFn(srcEncoded.buf),
        srcEncoded.len,
        ffiPtrFn(dstScratchBytes),
        dstLen
      ) !== 0
    );
  },

  dpapiUnprotect(encryptedBytes: Uint8Array): Buffer | null {
    if (!symbols || !ffiPtrFn || encryptedBytes.byteLength === 0) return null;
    const outLen = symbols.gbf_dpapi_unprotect(
      ffiPtrFn(encryptedBytes),
      encryptedBytes.byteLength,
      ffiPtrFn(dpapiOutBuf),
      dpapiOutBuf.byteLength
    );
    if (outLen === 0) return null;
    return Buffer.from(dpapiOutBuf.subarray(0, outLen));
  },

  patchChromePreferences(profileDir: string): boolean | null {
    if (!symbols || !ffiPtrFn) return null;
    const { buf, len } = encodeToBytes(profileDir);
    if (len === 0) return false;
    return symbols.gbf_patch_chrome_preferences(ffiPtrFn(buf), len) !== 0;
  },

  putPortOnStandby(port: number, preserveVerification = false): number | null {
    if (!symbols) return null;
    return symbols.gbf_put_port_on_standby(port, preserveVerification ? 1 : 0);
  },

  hashFrameBytes(input: string | Uint8Array): bigint {
    const { buf, len } = encodeToBytes(input);
    if (len === 0) return 0n;
    if (symbols && ffiPtrFn) {
      return symbols.gbf_hash_frame_bytes(ffiPtrFn(buf), len);
    }
    // Pure TypeScript strided 64-bit FNV-1a fallback
    let hash = 0xcbf29ce484222325n ^ BigInt(len);
    const prime = 0x100000001b3n;
    const mask = 0xffffffffffffffffn;
    hash = (hash * prime) & mask;
    const stride = Math.max(1, Math.floor(len / 256));
    for (let i = 0; i < len; i += stride) {
      hash = ((hash ^ BigInt(buf[i])) * prime) & mask;
    }
    return hash;
  }
};
