// Gọi keep-alive (tuỳ chọn)
const { startKeepAlive } = require('./lib/keep-alive.cjs');
startKeepAlive();

// Chạy server đã build sẵn
require('./.next/standalone/server.js');
