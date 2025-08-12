// lib/keep-alive.cjs
const cron = require("node-cron");

// Runs every 5 minutes — adjust as needed.
const task = cron.schedule("*/5 * * * *", () => {
  console.log("[keep-alive] ping", new Date().toISOString());
});

// If you want to control it elsewhere, you can export the task
module.exports = task;
