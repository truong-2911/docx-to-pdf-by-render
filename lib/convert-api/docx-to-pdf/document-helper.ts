// lib/convert-api/docx-to-pdf/document-helper.ts
import axios from "axios";
import http from "http";
import https from "https";
import crypto from "crypto";
import path from "path";
import os from "os";
import fsp from "fs/promises";
import fs from "fs";

import PizZip from "pizzip";
import Docxtemplater from "docxtemplater";
import ImageModule from "docxtemplater-image-module-free";
import { imageSize as sizeOf } from "image-size";
import sharp from "sharp";

/**
 * Map optimizer v2 + per-host concurrency:
 * - Keep-Alive + maxSockets cao
 * - Prefetch = fetch + transform (resize/re-encode)
 * - Memory + Disk cache (TTL) tái sử dụng giữa requests
 * - Per-host concurrency limit (tránh 429 trên Zoho)
 *
 * ENV:
 *   IMG_HTTP_TIMEOUT_MS=15000
 *   IMG_MAX_SOCKETS=40
 *   IMG_PREFETCH=true|false
 *   IMG_PREFETCH_CONCURRENCY=10       # tổng số tác vụ đồng thời
 *   IMG_HOST_CONCURRENCY=10           # đồng thời tối đa mỗi host
 *   IMG_INLINE_RESIZE=true|false
 *   IMG_RESIZE_MAX_W=1800
 *   IMG_RESIZE_MAX_H=1800
 *   IMG_RESIZE_QUALITY=78
 *   IMG_MIN_BYTES_TO_TOUCH=200000
 *   IMG_CONVERT_PNG_PHOTOS=true|false
 *   IMG_PREFER_WEBP=false|true
 *   IMG_DISK_CACHE_DIR=/tmp/img-cache
 *   IMG_DISK_CACHE_TTL_MS=600000
 *   IMG_CACHE_MAX_ENTRIES=2000
 */

const HTTP_TIMEOUT_MS = Number(process.env.IMG_HTTP_TIMEOUT_MS || 15000);
const MAX_SOCKETS = Number(process.env.IMG_MAX_SOCKETS || 40);

const PREFETCH_ENABLED = (process.env.IMG_PREFETCH ?? "true") !== "false";
const PREFETCH_CONCURRENCY = Math.max(1, Number(process.env.IMG_PREFETCH_CONCURRENCY || 10));
const HOST_CONCURRENCY = Math.max(1, Number(process.env.IMG_HOST_CONCURRENCY || 10));

const INLINE_RESIZE = (process.env.IMG_INLINE_RESIZE ?? "true") !== "false";
const MAX_W = Number(process.env.IMG_RESIZE_MAX_W || 1800);
const MAX_H = Number(process.env.IMG_RESIZE_MAX_H || 1800);
const QUALITY = Number(process.env.IMG_RESIZE_QUALITY || 78);
const MIN_BYTES = Number(process.env.IMG_MIN_BYTES_TO_TOUCH || 200_000);
const CONVERT_PNG_PHOTOS = (process.env.IMG_CONVERT_PNG_PHOTOS ?? "true") !== "false";
const PREFER_WEBP = (process.env.IMG_PREFER_WEBP ?? "false") === "true";

const DISK_CACHE_DIR = process.env.IMG_DISK_CACHE_DIR || path.join(os.tmpdir(), "img-cache");
const DISK_CACHE_TTL = Number(process.env.IMG_DISK_CACHE_TTL_MS || 10 * 60 * 1000);
const CACHE_MAX = Number(process.env.IMG_CACHE_MAX_ENTRIES || 2000);

const httpAgent = new http.Agent({ keepAlive: true, maxSockets: MAX_SOCKETS });
const httpsAgent = new https.Agent({ keepAlive: true, maxSockets: MAX_SOCKETS });

const httpClient = axios.create({
  httpAgent,
  httpsAgent,
  timeout: HTTP_TIMEOUT_MS,
  responseType: "arraybuffer",
  maxBodyLength: Infinity,
  maxContentLength: Infinity,
  validateStatus: (s) => s >= 200 && s < 300,
});

// ---- helpers (hash, paths)
function sha1(s: string) { return crypto.createHash("sha1").update(s).digest("hex"); }
function cachePath(url: string) { return path.join(DISK_CACHE_DIR, `${sha1(url)}.bin`); }
async function ensureDir(p: string) { try { await fsp.mkdir(p, { recursive: true }); } catch {} }

// ---- memory cache (transformed)
type Entry = { expiresAt: number; data?: Buffer; promise?: Promise<Buffer> };
const memCache = new Map<string, Entry>();
function touchLRU(key: string) { if (!memCache.has(key)) return; const v = memCache.get(key)!; memCache.delete(key); memCache.set(key, v); }
function evictIfNeeded() { while (memCache.size > CACHE_MAX) { const k = memCache.keys().next().value as string | undefined; if (k) memCache.delete(k); else break; } }

// ---- disk cache with TTL
async function readDiskCache(url: string): Promise<Buffer | null> {
  const p = cachePath(url);
  try { const st = await fsp.stat(p); if (Date.now() - st.mtimeMs > DISK_CACHE_TTL) return null; return await fsp.readFile(p); }
  catch { return null; }
}
async function writeDiskCache(url: string, buf: Buffer) {
  await ensureDir(DISK_CACHE_DIR);
  try { await fsp.writeFile(cachePath(url), buf); } catch {}
}

// ---- sharp transform
async function transformImageIfNeeded(input: Buffer): Promise<Buffer> {
  if (!INLINE_RESIZE || !input || input.length < MIN_BYTES) return input;
  let meta; try { meta = await sharp(input, { failOn: "none" }).metadata(); } catch { return input; }
  if (!meta?.width || !meta?.height) return input;
  if (!["jpeg","jpg","webp","png","tiff"].includes(String(meta.format))) return input;

  let pipe = sharp(input, { failOn: "none" });
  if (meta.width > MAX_W || meta.height > MAX_H)
    pipe = pipe.resize({ width: MAX_W, height: MAX_H, fit: "inside", withoutEnlargement: true });

  let target = String(meta.format);
  if (CONVERT_PNG_PHOTOS && target === "png" && meta.hasAlpha !== true)
    target = PREFER_WEBP ? "webp" : "jpeg";

  if (target === "jpeg" || target === "jpg") pipe = pipe.jpeg({ quality: QUALITY, mozjpeg: true });
  else if (target === "webp")               pipe = pipe.webp({ quality: QUALITY });
  else if (target === "png")                pipe = pipe.png({ compressionLevel: 9 });
  else if (target === "tiff")              { target = "jpeg"; pipe = pipe.jpeg({ quality: QUALITY, mozjpeg: true }); }

  const out = await pipe.toBuffer();
  return out.length <= input.length * 0.97 ? out : input;
}

// ---- network fetch
async function fetchRaw(url: string, token = ""): Promise<Buffer> {
  const headers = token ? { Authorization: `Zoho-oauthtoken ${token}` } : undefined;
  const res = await httpClient.get(url, { headers });
  return Buffer.from(res.data as ArrayBuffer);
}

// ---- transformed getter (mem -> disk -> network+transform), coalesce in-flight
export async function getTransformed(url: string, token = ""): Promise<Buffer> {
  const now = Date.now();
  const ent = memCache.get(url);
  if (ent && ent.expiresAt > now) {
    if (ent.data) { touchLRU(url); return ent.data; }
    if (ent.promise) return ent.promise;
  } else if (ent) memCache.delete(url);

  const disk = await readDiskCache(url);
  if (disk) {
    memCache.set(url, { expiresAt: now + DISK_CACHE_TTL, data: disk });
    touchLRU(url); evictIfNeeded();
    return disk;
  }

  const p = (async () => {
    const raw = await fetchRaw(url, token);
    const t = await transformImageIfNeeded(raw);
    await writeDiskCache(url, t);
    return t;
  })();

  memCache.set(url, { expiresAt: now + DISK_CACHE_TTL, promise: p });
  evictIfNeeded();

  try {
    const buf = await p;
    memCache.set(url, { expiresAt: Date.now() + DISK_CACHE_TTL, data: buf });
    touchLRU(url);
    return buf;
  } catch (e) {
    memCache.delete(url);
    throw e;
  }
}

// ---- gather links
function collectImageLinks(obj: any): string[] {
  const links = new Set<string>();
  const walk = (o: any) => {
    if (!o) return;
    if (Array.isArray(o)) { for (const v of o) walk(v); return; }
    if (typeof o === "object") {
      if (typeof o.link === "string" && /^https?:\/\//i.test(o.link)) links.add(o.link);
      for (const k of Object.keys(o)) walk(o[k]);
    }
  };
  walk(obj);
  return Array.from(links);
}
function hostOf(u: string) { try { return new URL(u).host; } catch { return "unknown"; } }

// ---- prefetch with per-host concurrency
async function prefetchTransformed(urls: string[], token = ""): Promise<void> {
  if (!urls.length) return;

  const queue = urls.slice();
  let globalActive = 0;
  const byHostActive = new Map<string, number>();

  const tryStart = async (): Promise<void> => {
    if (globalActive >= PREFETCH_CONCURRENCY) return;

    // tìm next url mà host còn slot
    let pickedIdx = -1;
    for (let i = 0; i < queue.length; i++) {
      const h = hostOf(queue[i]);
      const used = byHostActive.get(h) || 0;
      if (used < HOST_CONCURRENCY) { pickedIdx = i; break; }
    }
    if (pickedIdx === -1) return; // chờ slot host

    const url = queue.splice(pickedIdx, 1)[0];
    const h = hostOf(url);

    globalActive++;
    byHostActive.set(h, (byHostActive.get(h) || 0) + 1);

    // chạy fetch
    getTransformed(url, token).catch(() => {}).finally(() => {
      globalActive--;
      byHostActive.set(h, Math.max(0, (byHostActive.get(h) || 1) - 1));
      // tiếp tục lấy job khác
      void tryStart();
    });

    // Nếu còn slot global -> khởi chạy thêm
    if (globalActive < PREFETCH_CONCURRENCY && queue.length) {
      await tryStart();
    }
  };

  const t0 = Date.now();
  // mồi các slot ban đầu
  const starters = Math.min(PREFETCH_CONCURRENCY, queue.length);
  const kicks = Array.from({ length: starters }, () => tryStart());
  await Promise.all(kicks);

  // chờ hết hàng đợi
  while (queue.length || globalActive > 0) {
    await new Promise(r => setTimeout(r, 10));
  }
  const dt = Date.now() - t0;
  console.log(`[map-prefetch] urls=${urls.length} conc=${PREFETCH_CONCURRENCY} hostConc=${HOST_CONCURRENCY} took=${dt}ms`);
}

// ---- strip HTML (giữ nguyên)
export function replaceHtmlTags(obj: any) {
  const hasHtml = (s: string) => /<[^>]*>/.test(s);
  const htmlToText = (s: string) => s.replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]*>/g, "");
  const walk = (o: any) => {
    if (Array.isArray(o)) for (let i = 0; i < o.length; i++) {
      const v = o[i]; if (typeof v === "string") { if (hasHtml(v)) o[i] = htmlToText(v); }
      else if (v && typeof v === "object") walk(v);
    } else if (o && typeof o === "object") {
      for (const k of Object.keys(o)) {
        const v = o[k]; if (typeof v === "string") { if (hasHtml(v)) o[k] = htmlToText(v); }
        else if (v && typeof v === "object") walk(v);
      }
    }
  };
  walk(obj);
  return obj;
}

// ---- render DOCX
export async function populateDataOnDocx({ json, file, token = "" }: { json: any; file: Buffer; token?: string; }): Promise<Buffer> {
  if (PREFETCH_ENABLED) {
    const all = collectImageLinks(json);
    if (all.length) await prefetchTransformed(all, token);
  }

  const opts: any = {
    centered: false,
    fileType: "docx",
    getImage: async (tagObj: any) => {
      const url = tagObj?.link || tagObj?.url || tagObj;
      if (typeof url !== "string") throw new Error("Invalid image tag: missing link");
      return getTransformed(url, token); // lấy ảnh đã transform từ cache
    },
    getSize: (img: Buffer, tagObj: any) => {
      const meta = sizeOf(img);
      const width = Number(meta?.width || 1);
      const height = Number(meta?.height || 1);
      const maxW = Math.min(Number(tagObj?.maxWidth || width), width);
      const newW = Math.max(1, maxW);
      const newH = Math.round((height / width) * newW);
      return [newW, newH];
    },
  };

  const imageModule = new ImageModule(opts);
  const zip = new PizZip(file);
  const doc = new Docxtemplater(zip, { modules: [imageModule], paragraphLoop: true, linebreaks: true });
  await doc.renderAsync(json);
  return doc.getZip().generate({ type: "nodebuffer", compression: "DEFLATE" });
}
