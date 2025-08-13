// server.cjs

// Load env từ .env.local (rồi .env) ở runtime
try {
  require("dotenv").config({ path: ".env.local" });
  require("dotenv").config(); // fallback .env
  console.log("[env] loaded .env.local (and .env fallback)");
  if (!process.env.JOD_URL) console.warn("[env] JOD_URL is empty");
} catch (e) {
  console.warn("[env] dotenv load failed:", e && e.message);
}

// Keep-alive (như bạn đang dùng)
try {
  const { startKeepAlive } = require("./lib/keep-alive.cjs");
  if (typeof startKeepAlive === "function") startKeepAlive();
} catch (e) {
  console.warn("[keep-alive] disabled:", e && e.message);
}

// Start Next standalone
require("./.next/standalone/server.js");
