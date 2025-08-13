// lib/convert-api/docx-to-pdf/document-helper.ts
import axios from "axios";
import http from "http";
import https from "https";
import PizZip from "pizzip";
import Docxtemplater from "docxtemplater";
import ImageModule from "docxtemplater-image-module-free";
import { imageSize as sizeOf } from "image-size";
import sharp from "sharp";

/**
 * Tối ưu pha "map" ảnh:
 * - Keep-Alive + maxSockets cao
 * - Prefetch ảnh song song (giới hạn concurrency)
 * - Cache theo URL (kể cả in-flight)
 * - Inline resize/re-encode bằng sharp (giảm map & convert)
 *
 * ENV (tuỳ chọn):
 *   IMG_HTTP_TIMEOUT_MS=60000
 *   IMG_MAX_SOCKETS=256
 *   IMG_CACHE_MAX_ENTRIES=2000
 *   IMG_CACHE_TTL_MS=600000
 *   IMG_PREFETCH=true|false
 *   IMG_PREFETCH_CONCURRENCY=16
 *   IMG_INLINE_RESIZE=true|false
 *   IMG_RESIZE_MAX_W=1800
 *   IMG_RESIZE_MAX_H=1800
 *   IMG_RESIZE_QUALITY=78
 *   IMG_MIN_BYTES_TO_TOUCH=200000
 *   IMG_CONVERT_PNG_PHOTOS=true|false
 *   IMG_PREFER_WEBP=false|true
 */

const HTTP_TIMEOUT_MS = Number(process.env.IMG_HTTP_TIMEOUT_MS || 60000);
const MAX_SOCKETS = Number(process.env.IMG_MAX_SOCKETS || 256);
const CACHE_MAX = Number(process.env.IMG_CACHE_MAX_ENTRIES || 2000);
const CACHE_TTL = Number(process.env.IMG_CACHE_TTL_MS || 10 * 60 * 1000);
const PREFETCH_ENABLED = (process.env.IMG_PREFETCH ?? "true") !== "false";
const PREFETCH_CONCURRENCY = Math.max(1, Number(process.env.IMG_PREFETCH_CONCURRENCY || 16));

const INLINE_RESIZE = (process.env.IMG_INLINE_RESIZE ?? "true") !== "false";
const MAX_W = Number(process.env.IMG_RESIZE_MAX_W || 1800);
const MAX_H = Number(process.env.IMG_RESIZE_MAX_H || 1800);
const QUALITY = Number(process.env.IMG_RESIZE_QUALITY || 78);
const MIN_BYTES = Number(process.env.IMG_MIN_BYTES_TO_TOUCH || 200_000);
const CONVERT_PNG_PHOTOS = (process.env.IMG_CONVERT_PNG_PHOTOS ?? "true") !== "false";
const PREFER_WEBP = (process.env.IMG_PREFER_WEBP ?? "false") === "true";

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

// ---- Cache URL (TTL) + hợp nhất in-flight ----
type CacheEntry = { expiresAt: number; data?: Buffer; promise?: Promise<Buffer> };
const imageCache = new Map<string, CacheEntry>();

function touchLRU(key: string) {
  if (!imageCache.has(key)) return;
  const val = imageCache.get(key)!;
  imageCache.delete(key);
  imageCache.set(key, val);
}
function evictIfNeeded() {
  while (imageCache.size > CACHE_MAX) {
    const firstKey = imageCache.keys().next().value as string | undefined;
    if (firstKey) imageCache.delete(firstKey); else break;
  }
}

export async function getHttpData(url: string, token = ""): Promise<Buffer> {
  if (!url || typeof url !== "string") throw new Error("Invalid image URL");
  const now = Date.now();
  const cache = imageCache.get(url);
  if (cache) {
    if (cache.expiresAt > now) {
      if (cache.data) { touchLRU(url); return cache.data; }
      if (cache.promise) return cache.promise;
    } else {
      imageCache.delete(url);
    }
  }

  const headers = token ? { Authorization: `Zoho-oauthtoken ${token}` } : undefined;
  const p = httpClient.get(url, { headers }).then(r => Buffer.from(r.data as ArrayBuffer));
  imageCache.set(url, { expiresAt: now + CACHE_TTL, promise: p });
  evictIfNeeded();

  try {
    const buf = await p;
    imageCache.set(url, { expiresAt: Date.now() + CACHE_TTL, data: buf });
    touchLRU(url);
    return buf;
  } catch (e) {
    imageCache.delete(url);
    throw e;
  }
}

// ---- Thu thập link ảnh trong JSON ----
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

// ---- Prefetch song song ----
async function prefetchImages(urls: string[], token = ""): Promise<void> {
  if (!urls.length) return;
  let i = 0;
  const worker = async () => {
    while (i < urls.length) {
      const idx = i++;
      const u = urls[idx];
      try { await getHttpData(u, token); } catch {}
    }
  };
  const N = Math.min(PREFETCH_CONCURRENCY, urls.length);
  await Promise.all(Array.from({ length: N }, worker));
}

// ---- Inline resize/re-encode ----
async function maybeTransformImage(input: Buffer): Promise<Buffer> {
  if (!INLINE_RESIZE) return input;
  if (!input || input.length < MIN_BYTES) return input;

  let meta;
  try { meta = await sharp(input, { failOn: "none" }).metadata(); }
  catch { return input; }
  if (!meta?.width || !meta?.height) return input;

  const isPhotoFormat = ["jpeg","jpg","webp","png","tiff"].includes(String(meta.format));
  if (!isPhotoFormat) return input;

  let pipeline = sharp(input, { failOn: "none" });

  if (meta.width > MAX_W || meta.height > MAX_H) {
    pipeline = pipeline.resize({ width: MAX_W, height: MAX_H, fit: "inside", withoutEnlargement: true });
  }

  let target = String(meta.format);
  if (CONVERT_PNG_PHOTOS && target === "png" && meta.hasAlpha !== true) {
    target = PREFER_WEBP ? "webp" : "jpeg";
  }

  if (target === "jpeg" || target === "jpg") pipeline = pipeline.jpeg({ quality: QUALITY, mozjpeg: true });
  else if (target === "webp")              pipeline = pipeline.webp({ quality: QUALITY });
  else if (target === "png")               pipeline = pipeline.png({ compressionLevel: 9 });
  else if (target === "tiff")             { target = "jpeg"; pipeline = pipeline.jpeg({ quality: QUALITY, mozjpeg: true }); }

  const out = await pipeline.toBuffer();
  if (out.length <= input.length * 0.97) return out;
  return input;
}

// ---- Loại bỏ HTML trong string (như cũ) ----
export function replaceHtmlTags(obj: any) {
  const hasHtml = (s: string) => /<[^>]*>/.test(s);
  const htmlToText = (s: string) => s
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]*>/g, "");
  const walk = (o: any) => {
    if (Array.isArray(o)) for (let i = 0; i < o.length; i++) {
      const v = o[i];
      if (typeof v === "string") { if (hasHtml(v)) o[i] = htmlToText(v); }
      else if (v && typeof v === "object") walk(v);
    }
    else if (o && typeof o === "object") {
      for (const k of Object.keys(o)) {
        const v = o[k];
        if (typeof v === "string") { if (hasHtml(v)) o[k] = htmlToText(v); }
        else if (v && typeof v === "object") walk(v);
      }
    }
  };
  walk(obj);
  return obj;
}

// ---- Render vào DOCX template ----
export async function populateDataOnDocx({
  json, file, token = "",
}: { json: any; file: Buffer; token?: string; }): Promise<Buffer> {
  if (PREFETCH_ENABLED) {
    const allLinks = collectImageLinks(json);
    if (allLinks.length) {
      const t0 = Date.now();
      await prefetchImages(allLinks, token);
      const dt = Date.now() - t0;
      console.log(`[map-prefetch] urls=${allLinks.length} concurrency=${PREFETCH_CONCURRENCY} took=${dt}ms`);
    }
  }

  const opts: any = {
    centered: false,
    fileType: "docx",
    getImage: async (tagObj: any) => {
      const url = tagObj?.link || tagObj?.url || tagObj;
      if (typeof url !== "string") throw new Error("Invalid image tag: missing link");
      const buf = await getHttpData(url, token);
      return maybeTransformImage(buf);
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
