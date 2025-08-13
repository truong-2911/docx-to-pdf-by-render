export function mb(bytes: number) {
  return (bytes / 1024 / 1024).toFixed(2);
}
export function beginRequestMetrics(label: string) {
  return { label, t0: Date.now(), cpu0: process.cpuUsage() };
}
export function endRequestMetrics(ctx: any, extra: Record<string, any> = {}) {
  const wall = Date.now() - ctx.t0;
  const cpu = process.cpuUsage(ctx.cpu0);
  const vcpu_minutes = ((cpu.user + cpu.system) / 1000) / 60000;
  const mem = process.memoryUsage();
  const payload = {
    ts: new Date().toISOString(),
    label: ctx.label,
    wall_ms: wall,
    cpu_user_ms: Math.round(cpu.user / 1000),
    cpu_sys_ms: Math.round(cpu.system / 1000),
    vcpu_minutes,
    ram_end: {
      rss: mem.rss, heapUsed: mem.heapUsed, heapTotal: mem.heapTotal,
      external: (mem as any).external, arrayBuffers: (mem as any).arrayBuffers ?? 0
    },
    ...extra,
  };
  console.log("[req-metrics]", JSON.stringify(payload));
}
