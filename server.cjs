// server.cjs
try {
  const { startKeepAlive } = require("./lib/keep-alive.cjs");
  if (typeof startKeepAlive === "function") startKeepAlive();
} catch (e) {
  console.warn("[keep-alive] disabled:", e && e.message);
}

// Chạy server Next.js đã build ở chế độ standalone
require("./.next/standalone/server.js");
