// utils/concurrency.ts
// Semaphore FIFO giới hạn số request xử lý đồng thời trong process.
// Không timeout; request thừa sẽ chờ tới lượt.

let inFlight = 0;
const waiters: Array<() => void> = [];
const LIMIT = Math.max(1, Number(process.env.MAX_INFLIGHT || 6));

function logQueue(where: string) {
  // Chỉ log khi có hàng đợi để tránh spam
  if (waiters.length > 0) {
    console.log(`[queue:${where}] inFlight=${inFlight}/${LIMIT} | queued=${waiters.length}`);
  }
}

export async function acquire(where = "api") {
  if (inFlight < LIMIT) {
    inFlight++;
    return;
  }
  await new Promise<void>((resolve) => {
    waiters.push(resolve);
  });
  inFlight++;
  logQueue(where);
}

export function release(where = "api") {
  inFlight = Math.max(0, inFlight - 1);
  const next = waiters.shift();
  if (next) {
    // nhả tiếp theo ở tick sau để giữ thứ tự FIFO ổn định
    setImmediate(next);
  }
  logQueue(where);
}

// Optional: cho phép đọc trạng thái (nếu cần debug)
export function snapshot() {
  return { inFlight, limit: LIMIT, queued: waiters.length };
}
