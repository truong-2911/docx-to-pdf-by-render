import FormData from "form-data";
import axios, { AxiosError } from "axios";
import fs from "fs";
import fsp from "fs/promises";
import os from "os";
import path from "path";
import { pipeline } from "stream/promises";

/**
 * JODConverter REST client — thử nhiều endpoint:
 * - /conversion?format=pdf (kontextwork-converter)
 * - /convert?format=pdf    (jodconverter-examples)
 *
 * ENV:
 *   JOD_URL
 *   JOD_TIMEOUT_MS
 *   JOD_ENDPOINT (tuỳ chọn)
 */
const BASE = (process.env.JOD_URL || "http://127.0.0.1:8080").replace(/\/+$/,"");
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
