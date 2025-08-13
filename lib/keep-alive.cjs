// lib/keep-alive.cjs
// Giữ server "thức": vừa log heartbeat định kỳ, vừa tự gọi /api/health nội bộ.
// Có thể bật/tắt qua biến môi trường:
//   KEEP_ALIVE_ENABLED=true|false (mặc định true)
//   KEEP_ALIVE_INTERVAL_MS=5000
//   KEEP_ALIVE_PATH=/api/health

function startKeepAlive() {
  const enabled = (process.env.KEEP_ALIVE_ENABLED ?? "true") !== "false";
  if (!enabled) {
    console.warn("[keep-alive] disabled by env KEEP_ALIVE_ENABLED=false");
    return null;
  }

  const port = Number(process.env.PORT || 3000);
  // 3 minutes 
  const intervalMs = Math.max(1000, Number(process.env.KEEP_ALIVE_INTERVAL_MS || 180000));
  const path = process.env.KEEP_ALIVE_PATH || "/api/health";

  // 1) Cron/interval log (như trước)
  try {
    const cron = require("node-cron");
    const task = cron.schedule("*/5 * * * *", () => {
      console.log("[keep-alive] ping (cron)", new Date().toISOString());
    });
    task.start();
  } catch {
    // bỏ qua nếu không có node-cron
  }

  // 2) Nội bộ tự gọi /api/health mỗi intervalMs
  const http = require("http");
  let inFlight = false;

  const tick = () => {
    if (inFlight) return; // tránh chồng request nếu lần trước chưa xong
    inFlight = true;

    const req = http.request(
      { hostname: "127.0.0.1", port, path, method: "GET", timeout: Math.min(4000, intervalMs - 100) },
      (res) => {
        res.resume(); // không đọc body
        console.log("[keep-alive:int]", new Date().toISOString(), `status=${res.statusCode}`);
        inFlight = false;
      }
    );

    req.on("timeout", () => {
      req.destroy(new Error("timeout"));
    });

    req.on("error", (err) => {
      console.warn("[keep-alive:int:error]", err && err.message);
      inFlight = false;
    });

    req.end();
  };

  const timer = setInterval(tick, intervalMs);
  // chạy ngay 1 lần khi server khởi động
  setTimeout(tick, 2000);

  console.log(
    `[keep-alive] enabled; interval=${intervalMs}ms; path=${path}; port=${port}`
  );
  return { stop: () => clearInterval(timer) };
}

module.exports = { startKeepAlive };
