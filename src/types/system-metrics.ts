// Shape of the admin "system metrics" payload. Collected best-effort in
// src/services/system-metrics.ts — every block degrades to null instead of
// failing the whole request.

export interface CpuMetrics {
  cores: number;
  loadAvg: number[];
  usagePercent: number | null;
}

export interface SwapMetrics {
  totalBytes: number;
  usedBytes: number;
  usedPercent: number;
}

export interface MemoryMetrics {
  totalBytes: number;
  usedBytes: number;
  availableBytes: number;
  usedPercent: number;
  swap: SwapMetrics | null;
}

export interface DiskMetrics {
  mount: string;
  totalBytes: number;
  usedBytes: number;
  availableBytes: number;
  usedPercent: number;
  inodesUsedPercent: number | null;
}

export interface HostMetrics {
  hostname: string;
  platform: string;
  kernel: string;
  distro: string | null;
  uptimeSeconds: number;
  timestamp: string;
}

export interface ProcessMetrics {
  pid: number;
  nodeVersion: string;
  uptimeSeconds: number;
  rssBytes: number;
  heapUsedBytes: number;
  heapTotalBytes: number;
}

export interface DatabaseMetrics {
  sizeBytes: number | null;
  activeConnections: number | null;
}

export interface SystemMetrics {
  host: HostMetrics;
  cpu: CpuMetrics;
  memory: MemoryMetrics;
  disk: DiskMetrics | null;
  process: ProcessMetrics;
  database: DatabaseMetrics;
}
