// lib/convert-api/jod.ts
import FormData from "form-data";
import axios from "axios";
import fs from "fs";
import fsp from "fs/promises";
import os from "os";
import path from "path";
import { pipeline } from "stream/promises";

/**
 * JODConverter REST client — convert DOCX -> PDF qua service ấm sẵn
 *
 * ENV:
 *   JOD_URL         (vd: http://127.0.0.1:8080)
 *   JOD_TIMEOUT_MS  (vd: 120000)
 */
const BASE = (process.env.JOD_URL || "http://127.0.0.1:8080").replace(/\/+$/,"");
const TIMEOUT = Number(process.env.JOD_TIMEOUT_MS || 120000);

export async function convertViaJodPath(inputPath: string) {
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "jod-"));
  const out = path.join(tmp, "out.pdf");

  const form = new FormData();
  form.append("file", fs.createReadStream(inputPath));

  const url = `${BASE}/convert?format=pdf`;
  const res = await axios.post(url, form, {
    responseType: "stream",
    headers: form.getHeaders(),
    timeout: TIMEOUT,
    maxBodyLength: Infinity,
    maxContentLength: Infinity,
    validateStatus: (s) => s >= 200 && s < 300,
  });

  await pipeline(res.data, fs.createWriteStream(out));

  // Một số image JOD trả header x-parse-time; nếu không có thì 0
  const jodMs = Number(res.headers["x-parse-time"] || 0);
  return { pdfPath: out, workDir: tmp, jodMs };
}
