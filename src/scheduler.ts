// Built-in scheduler for always-on hosting (Railway). Off unless RUN_SCHEDULER=true.
export async function startScheduler() {
  if (process.env.RUN_SCHEDULER !== "true") return;
  const everyMs = Number(process.env.SCAN_EVERY_MIN ?? 5) * 60_000;
  const { runScan } = await import("./lib/pipeline");
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    const t = Date.now();
    try {
      // No 60s serverless limit here: give each scan up to 4 minutes.
      const r = await runScan(Date.now() + Math.min(everyMs - 30_000, 240_000));
      console.log(`[scan] ${JSON.stringify(r)} in ${Math.round((Date.now() - t) / 1000)}s`);
    } catch (e) {
      console.error("[scan] failed", e);
      try { const { push } = await import("./lib/notify"); await push("Offer Desk scan failing", String((e as Error)?.message ?? e).slice(0, 300), { priority: 4, tags: "warning" }); } catch {}
    } finally { running = false; }
  };
  setTimeout(tick, 15_000);            // first scan shortly after boot
  setInterval(tick, everyMs);
  console.log(`[scheduler] scanning every ${everyMs / 60_000} min`);
}
