const { startKeepAlive } = require('./lib/keep-alive.cjs');
startKeepAlive();

const { createServer } = require('http');
const next = require('next');

const port = process.env.PORT || 3000;
const app = next({ dev: false });
const handle = app.getRequestHandler();

app.prepare().then(() => {
  createServer((req, res) => handle(req, res)).listen(port, () => {
    console.log(`🚀 Server listening on port ${port}`);
  });
});
