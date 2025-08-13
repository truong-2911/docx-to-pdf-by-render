// lib/convert-api/jod.ts
import FormData from "form-data";
import axios, { AxiosError } from "axios";
import fs from "fs";
import fsp from "fs/promises";
import os from "os";
import path from "path";
import { pipeline } from "stream/promises";

function normalizeBase(input?: string): string | null {
  let u = (input || "").trim();
  if (!u) return null;
  if (!/^https?:\/\//i.test(u)) u = "http://" + u; // tự thêm scheme
  try {
    const p = new URL(u);
    if (!p.port && p.hostname.endsWith(".railway.internal")) {
      p.port = "8080"; // JOD mặc định 8080
      u = p.toString();
    }
  } catch {
    // để nguyên; axios sẽ báo lỗi "Invalid URL" nếu sai
  }
  return u.replace(/\/+$/, "");
}

function getBase(): string | null {
  return normalizeBase(process.env.JOD_URL);
}

function getEndpoints(): string[] {
  const list = [process.env.JOD_ENDPOINT || "", "/conversion", "/convert"];
  return list.filter(Boolean).map((s) => s.replace(/\/+$/, ""));
}

function getTimeout(): number {
  return Number(process.env.JOD_TIMEOUT_MS || 120000);
}

async function writeStreamToFile(
  readable: NodeJS.ReadableStream,
  outPath: string
) {
  await pipeline(readable, fs.createWriteStream(outPath));
}

function briefError(e: unknown) {
  const ax = e as AxiosError<any>;
  const status = ax.response?.status;
  const data =
    typeof ax.response?.data === "string"
      ? ax.response?.data.slice(0, 300)
      : ax.message;
  return `status=${status ?? "?"} ${data ?? ""}`.trim();
}

/**
 * Convert bằng đường dẫn file — GIỮ NGUYÊN logic cũ của bạn.
 */
export async function convertViaJodPath(inputPath: string) {
  const BASE = getBase(); // <-- chỉ đọc ENV khi được gọi
  if (!BASE) throw new Error("JOD_URL is empty");

  const endpoints = getEndpoints();
  const TIMEOUT = getTimeout();

  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "jod-"));
  const out = path.join(tmp, "out.pdf");
  const form = new FormData();
  form.append("file", fs.createReadStream(inputPath));

  const tried: string[] = [];
  let lastErr: unknown;

  for (const basePath of endpoints) {
    const url = `${BASE}${basePath}?format=pdf`;
    tried.push(url);
    try {
      const res = await axios.post(url, form, {
        responseType: "stream",
        headers: form.getHeaders(),
        timeout: TIMEOUT,
        maxBodyLength: Infinity,
        maxContentLength: Infinity,
        validateStatus: (s) => s >= 200 && s < 300,
      });
      await writeStreamToFile(res.data as any, out);
      return {
        pdfPath: out,
        workDir: tmp,
        jodMs: Number(res.headers["x-parse-time"] || 0),
        endpoint: url,
      };
    } catch (e) {
      lastErr = e;
    }
  }

  throw new Error(
    `JODConverter REST failed. Tried: ${tried.join(" ; ")} | ${briefError(
      lastErr
    )}`
  );
}

/**
 * Convert từ BINARY (Buffer/Uint8Array) → trả về PDF bytes.
 * Dùng rất tiện cho /api/warmup (ép JOD/LO chạy 1 job nhỏ).
 */
export async function jodConvertBytes(
  filename: string,
  bytes: Buffer | Uint8Array,
  toFormat: string = "pdf",
  signal?: AbortSignal
): Promise<Uint8Array> {
  const BASE = getBase();
  if (!BASE) throw new Error("JOD_URL is empty");

  const endpoints = getEndpoints();
  const TIMEOUT = getTimeout();

  const form = new FormData();
  form.append("file", Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes), {
    filename,
    // để JOD auto detect cũng ổn; có thể set contentType nếu muốn:
    // contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  });

  const tried: string[] = [];
  let lastErr: unknown;

  for (const basePath of endpoints) {
    const url = `${BASE}${basePath}?format=${encodeURIComponent(toFormat)}`;
    tried.push(url);
    try {
      const res = await axios.post(url, form, {
        responseType: "arraybuffer",
        headers: form.getHeaders(),
        timeout: TIMEOUT,
        maxBodyLength: Infinity,
        maxContentLength: Infinity,
        validateStatus: (s) => s >= 200 && s < 300,
        signal,
      });
      return new Uint8Array(res.data as ArrayBuffer);
    } catch (e) {
      lastErr = e;
    }
  }

  throw new Error(
    `JODConverter REST failed. Tried: ${tried.join(" ; ")} | ${briefError(
      lastErr
    )}`
  );
}

/**
 * Tiện ích: nhận DOCX buffer, convert sang PDF bytes.
 * (Bọc lại jodConvertBytes cho gọn)
 */
export async function convertViaJodBuffer(inputDocx: Buffer): Promise<{
  pdfBytes: Uint8Array;
}> {
  const pdfBytes = await jodConvertBytes("input.docx", inputDocx, "pdf");
  return { pdfBytes };
}
