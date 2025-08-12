// lib/keep-alive.ts
import cron from "node-cron";
import fetch from "node-fetch";

export function startKeepAlive() {
  const url = process.env.APP_URL; // ví dụ: https://your-service.up.railway.app/api/health

  if (!url) {
    console.warn("[KEEP-ALIVE] APP_URL is not set, skipping keep-alive job.");
    return;
  }

  // chạy mỗi 10 phút
  cron.schedule("*/10 * * * *", async () => {
    try {
      const res = await fetch(url);
      console.log(`[KEEP-ALIVE] ${new Date().toISOString()} - Status: ${res.status}`);
    } catch (e) {
      console.error(`[KEEP-ALIVE] ${new Date().toISOString()} - FAIL: ${e.message}`);
    }
  });

  console.log("[KEEP-ALIVE] Cron job started. Ping every 10 minutes.");
}
