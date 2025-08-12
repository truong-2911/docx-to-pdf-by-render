// lib/keep-alive.cjs
const intervalMs = 5 * 60 * 1000; // 5 minutes
setInterval(() => {
  console.log("[keep-alive] ping", new Date().toISOString());
}, intervalMs);
module.exports = {}; // keep a value exported if server requires it
