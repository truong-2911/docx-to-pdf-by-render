// lib/metrics.ts
import { performance } from "node:perf_hooks";

type Ctx = {
  label: string;
  t0: number;
  cpu0: NodeJS.CpuUsage;
  mem0: NodeJS.MemoryUsage;
  ru0: NodeJS.ResourceUsage;
  sampler?: NodeJS.Timeout;
  peak: { rss: number; heapUsed: number };
};

export function beginRequestMetrics(label: string): Ctx {
  const ctx: Ctx = {
    label,
    t0: performance.now(),
    cpu0: process.cpuUsage(),
    mem0: process.memoryUsage(),
    ru0: process.resourceUsage?.() ?? ({} as any),
    peak: { rss: 0, heapUsed: 0 },
  };

  // lấy peak RAM trong suốt vòng đời request
  ctx.sampler = setInterval(() => {
    const m = process.memoryUsage();
    if (m.rss > ctx.peak.rss) ctx.peak.rss = m.rss;
    if (m.heapUsed > ctx.peak.heapUsed) ctx.peak.heapUsed = m.heapUsed;
  }, 250);

  return ctx;
}

export function endRequestMetrics(
  ctx: Ctx,
  extra: Record<string, unknown> = {}
) {
  if (ctx.sampler) clearInterval(ctx.sampler);

  const t1 = performance.now();
  const cpu1 = process.cpuUsage();
  const mem1 = process.memoryUsage();

  const dUserMicros = cpu1.user - ctx.cpu0.user;
  const dSysMicros = cpu1.system - ctx.cpu0.system;
  const cpuSeconds = (dUserMicros + dSysMicros) / 1_000_000;
  const vcpuMinutes = cpuSeconds / 60;

  const out = {
    ts: new Date().toISOString(),
    label: ctx.label,
    wall_ms: Math.round(t1 - ctx.t0),

    cpu_user_ms: Math.round(dUserMicros / 1000),
    cpu_sys_ms: Math.round(dSysMicros / 1000),
    vcpu_minutes: +vcpuMinutes.toFixed(6),

    ram_end: {
      rss: mem1.rss,
      heapUsed: mem1.heapUsed,
      heapTotal: mem1.heapTotal,
      external: mem1.external,
      arrayBuffers: mem1.arrayBuffers,
    },
    ram_peak: ctx.peak, // peak trong suốt request

    ...extra,
  };

  // một dòng JSON dễ parse
  // eslint-disable-next-line no-console
  console.log("[req-metrics]", JSON.stringify(out));
  return out;
}

// tiện ích format bytes -> MB
export const mb = (b: number) => +(b / 1024 / 1024).toFixed(2);
