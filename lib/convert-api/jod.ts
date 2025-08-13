// lib/convert-api/jod.ts
import FormData from "form-data";
import axios, { AxiosError } from "axios";
import fs from "fs";
import fsp from "fs/promises";
import os from "os";
import path from "path";
import { pipeline } from "stream/promises";

function normalizeBase(input: string | undefined) {
  let u = (input || "").trim();
  if (!u) throw new Error("JOD_URL is empty");
  if (!/^https?:\/\//i.test(u)) u = "http://" + u;      // tự thêm scheme
  // cố gắng thêm :8080 nếu thiếu port và là nội bộ railway
  try {
    const parsed = new URL(u);
    if (!parsed.port && parsed.hostname.endsWith(".railway.internal")) {
      parsed.port = "8080";
      u = parsed.toString().replace(/\/+$/,"");
    }
  } catch { /* để nguyên, axios sẽ báo lỗi nếu sai */ }
  return u.replace(/\/+$/,"");
}

/**
 * Thử nhiều endpoint:
 *  - /conversion?format=pdf  (kontextwork-converter)
 *  - /convert?format=pdf     (jodconverter-examples)
 */
const BASE = normalizeBase(process.env.JOD_URL);
const TIMEOUT = Number(process.env.JOD_TIMEOUT_MS || 120000);
const endpoints = [
  process.env.JOD_ENDPOINT?.replace(/\/+$/,"") || "",
  "/conversion",
  "/convert",
].filter(Boolean);

async function writeStreamToFile(readable: NodeJS.ReadableStream, outPath: string) {
  await pipeline(readable, fs.createWriteStream(outPath));
}
function briefError(e: unknown) {
  const ax = e as AxiosError<any>;
  const status = ax.response?.status;
  const data = typeof ax.response?.data === "string" ? ax.response?.data.slice(0, 300) : ax.message;
  return `status=${status ?? "?"} ${data ?? ""}`.trim();
}

export async function convertViaJodPath(inputPath: string) {
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
      return { pdfPath: out, workDir: tmp, jodMs: Number(res.headers["x-parse-time"] || 0), endpoint: url };
    } catch (e) {
      lastErr = e;
    }
  }

  throw new Error(`JODConverter REST failed. Tried: ${tried.join(" ; ")} | ${briefError(lastErr)}`);
}
