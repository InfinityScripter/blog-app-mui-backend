import type {
  DiskMetrics,
  SwapMetrics,
  MemoryMetrics,
  SystemMetrics,
  DatabaseMetrics,
} from '@/src/types/system-metrics';

import os from 'os';
import { promises as fs } from 'fs';
import { dbQuery } from '@/src/lib/db';

// Live server metrics for the admin dashboard. Collection is best-effort:
// each block degrades to null instead of failing the whole request, so the
// endpoint stays useful when a source is unavailable (macOS dev machine
// without /proc, pg-mem in tests without pg_database_size, …). The payload
// shape lives in src/types/system-metrics.ts.

const DISK_MOUNT = '/';
const CPU_SAMPLE_MIN_AGE_MS = 500;
const CPU_SAMPLE_DELAY_MS = 250;

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function percentOf(used: number, total: number): number {
  return total > 0 ? round1((used / total) * 100) : 0;
}

// --- CPU ---------------------------------------------------------------
// os.cpus() exposes cumulative per-core times; usage % is computed from the
// delta between two samples. The last sample is cached at module level, so a
// polling client gets the average over its own poll interval without an
// artificial delay; only the very first request sleeps CPU_SAMPLE_DELAY_MS.

interface CpuSample {
  idleMs: number;
  totalMs: number;
  at: number;
}

let lastCpuSample: CpuSample | null = null;

function takeCpuSample(): CpuSample {
  const totals = os.cpus().reduce(
    (acc, cpu) => ({
      idleMs: acc.idleMs + cpu.times.idle,
      totalMs:
        acc.totalMs +
        cpu.times.user +
        cpu.times.nice +
        cpu.times.sys +
        cpu.times.idle +
        cpu.times.irq,
    }),
    { idleMs: 0, totalMs: 0 }
  );
  return { ...totals, at: Date.now() };
}

async function measureCpuUsagePercent(): Promise<number | null> {
  let previous = lastCpuSample;
  if (!previous || Date.now() - previous.at < CPU_SAMPLE_MIN_AGE_MS) {
    previous = takeCpuSample();
    await new Promise((resolve) => {
      setTimeout(resolve, CPU_SAMPLE_DELAY_MS);
    });
  }
  const current = takeCpuSample();
  lastCpuSample = current;
  const totalDelta = current.totalMs - previous.totalMs;
  const idleDelta = current.idleMs - previous.idleMs;
  if (totalDelta <= 0) return null;
  const usage = 100 * (1 - idleDelta / totalDelta);
  return round1(Math.min(100, Math.max(0, usage)));
}

// --- Memory ------------------------------------------------------------
// On Linux, MemAvailable from /proc/meminfo is the honest "free" number
// (os.freemem() returns MemFree, which ignores reclaimable page cache).

interface MeminfoValues {
  availableBytes: number | null;
  swapTotalBytes: number | null;
  swapFreeBytes: number | null;
}

async function readProcMeminfo(): Promise<MeminfoValues | null> {
  try {
    const text = await fs.readFile('/proc/meminfo', 'utf8');
    const readKb = (key: string): number | null => {
      const match = text.match(new RegExp(`^${key}:\\s+(\\d+) kB`, 'm'));
      return match ? Number(match[1]) * 1024 : null;
    };
    return {
      availableBytes: readKb('MemAvailable'),
      swapTotalBytes: readKb('SwapTotal'),
      swapFreeBytes: readKb('SwapFree'),
    };
  } catch {
    return null;
  }
}

function buildSwap(meminfo: MeminfoValues | null): SwapMetrics | null {
  if (!meminfo) return null;
  const { swapTotalBytes, swapFreeBytes } = meminfo;
  if (swapTotalBytes === null || swapFreeBytes === null || swapTotalBytes <= 0) {
    return null;
  }
  const usedBytes = swapTotalBytes - swapFreeBytes;
  return {
    totalBytes: swapTotalBytes,
    usedBytes,
    usedPercent: percentOf(usedBytes, swapTotalBytes),
  };
}

async function collectMemory(): Promise<MemoryMetrics> {
  const totalBytes = os.totalmem();
  const meminfo = await readProcMeminfo();
  const availableBytes = meminfo?.availableBytes ?? os.freemem();
  const usedBytes = totalBytes - availableBytes;
  return {
    totalBytes,
    usedBytes,
    availableBytes,
    usedPercent: percentOf(usedBytes, totalBytes),
    swap: buildSwap(meminfo),
  };
}

// --- Disk --------------------------------------------------------------
// usedPercent follows the df convention: used / (used + available), which
// accounts for the space reserved for root.

async function collectDisk(): Promise<DiskMetrics | null> {
  try {
    const stat = await fs.statfs(DISK_MOUNT);
    const totalBytes = stat.blocks * stat.bsize;
    const availableBytes = stat.bavail * stat.bsize;
    const usedBytes = (stat.blocks - stat.bfree) * stat.bsize;
    const inodesUsedPercent =
      stat.files > 0 ? percentOf(stat.files - stat.ffree, stat.files) : null;
    return {
      mount: DISK_MOUNT,
      totalBytes,
      usedBytes,
      availableBytes,
      usedPercent: percentOf(usedBytes, usedBytes + availableBytes),
      inodesUsedPercent,
    };
  } catch {
    return null;
  }
}

// --- Host / database ----------------------------------------------------

async function readDistroName(): Promise<string | null> {
  try {
    const text = await fs.readFile('/etc/os-release', 'utf8');
    const match = text.match(/^PRETTY_NAME="?([^"\n]+)"?$/m);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

async function collectDatabase(): Promise<DatabaseMetrics> {
  const sizeBytes = await dbQuery<{ size: string }>(
    'SELECT pg_database_size(current_database()) AS size'
  )
    .then((result) => (result.rows.length ? Number(result.rows[0].size) : null))
    .catch(() => null);
  const activeConnections = await dbQuery<{ count: string }>(
    'SELECT count(*) AS count FROM pg_stat_activity WHERE datname = current_database()'
  )
    .then((result) => (result.rows.length ? Number(result.rows[0].count) : null))
    .catch(() => null);
  return { sizeBytes, activeConnections };
}

// --- Aggregate ----------------------------------------------------------

export async function collectSystemMetrics(): Promise<SystemMetrics> {
  const [usagePercent, memory, disk, distro, database] = await Promise.all([
    measureCpuUsagePercent(),
    collectMemory(),
    collectDisk(),
    readDistroName(),
    collectDatabase(),
  ]);
  const processMemory = process.memoryUsage();
  return {
    host: {
      hostname: os.hostname(),
      platform: os.platform(),
      kernel: os.release(),
      distro,
      uptimeSeconds: Math.round(os.uptime()),
      timestamp: new Date().toISOString(),
    },
    cpu: {
      cores: os.cpus().length,
      loadAvg: os.loadavg().map(round1),
      usagePercent,
    },
    memory,
    disk,
    process: {
      pid: process.pid,
      nodeVersion: process.version,
      uptimeSeconds: Math.round(process.uptime()),
      rssBytes: processMemory.rss,
      heapUsedBytes: processMemory.heapUsed,
      heapTotalBytes: processMemory.heapTotal,
    },
    database,
  };
}
