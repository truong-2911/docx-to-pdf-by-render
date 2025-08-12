// server.js
import { startKeepAlive } from "./lib/utils/keep-alive.js";

// Bắt đầu cron keep-alive
startKeepAlive();

// Load Next.js
import { createServer } from "http";
import next from "next";

const port = process.env.PORT || 3000;
const app = next({ dev: false });
const handle = app.getRequestHandler();

app.prepare().then(() => {
  createServer((req, res) => {
    handle(req, res);
  }).listen(port, () => {
    console.log(`🚀 Server listening on port ${port}`);
  });
});
