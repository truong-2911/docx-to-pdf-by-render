// lib/keep-alive.cjs
function startKeepAlive() {
  try {
    const cron = require("node-cron");
    const task = cron.schedule("*/5 * * * *", () => {
      console.log("[keep-alive] ping (cron)", new Date().toISOString());
    });
    task.start();
    return task;
  } catch {
    const intervalMs = 5 * 60 * 1000;
    setInterval(() => {
      console.log("[keep-alive] ping (interval)", new Date().toISOString());
    }, intervalMs);
    return null;
  }
}

module.exports = { startKeepAlive }; // <-- named export
