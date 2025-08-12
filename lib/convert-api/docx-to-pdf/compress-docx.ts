// lib/convert-api/docx-to-pdf/compress-docx.ts
import AdmZip from "adm-zip";
import sharp from "sharp";

// tiết kiệm RAM
if (typeof (sharp as any).cache === "function")
  sharp.cache({ items: 10, memory: 50 });
if (typeof (sharp as any).concurrency === "function") sharp.concurrency(1);

type Opts = {
  maxWidth?: number;
  maxHeight?: number;
  quality?: number;
  convertPngPhotos?: boolean;
  preferWebP?: boolean;
  minBytesToTouch?: number;
  thresholdBytes?: number; // new: skip nếu DOCX nhỏ hơn ngưỡng
};

export async function compressDocxBuffer(
  inputBuffer: Buffer,
  {
    maxWidth = 1900,
    maxHeight = 1900,
    quality = 78,
    convertPngPhotos = true,
    preferWebP = false,
    minBytesToTouch = 100 * 1024,
    thresholdBytes = Number(process.env.COMPRESS_THRESHOLD_MB || 15) *
      1024 *
      1024,
  }: Opts = {}
) {
  // BỎ NÉN nếu file nhỏ hơn ngưỡng
  if (thresholdBytes > 0 && inputBuffer.length <= thresholdBytes) {
    return { buffer: inputBuffer, changed: 0 };
  }

  const zip = new AdmZip(inputBuffer);
  const entries = zip.getEntries();
  let changed = 0;

  for (const e of entries) {
    if (!e.entryName.startsWith("word/media/") || e.isDirectory) continue;
    const orig = e.getData();
    if (!orig || orig.length < minBytesToTouch) continue;

    let meta: sharp.Metadata | undefined;
    try {
      meta = await sharp(orig, { failOn: "none" }).metadata();
    } catch {
      continue;
    }
    if (!meta?.width || !meta?.height) continue;

    const fmt = String(meta.format);
    const isJpeg = fmt === "jpeg" || fmt === "jpg";
    const isWebp = fmt === "webp";
    const isPng = fmt === "png";
    const isTiff = fmt === "tiff";
    const isPhoto = isJpeg || isWebp || isPng || isTiff;
    if (!isPhoto) continue;

    const needsResize = meta.width > maxWidth || meta.height > maxHeight;
    const pngNoAlpha = isPng && meta.hasAlpha !== true;

    // EARLY-EXIT: ảnh đã là JPEG & không cần resize -> bỏ qua
    if (!needsResize && isJpeg) continue;

    // EARLY-EXIT: PNG có alpha giữ nguyên (tránh mất trong suốt)
    if (!needsResize && isPng && meta.hasAlpha === true) continue;

    // Nếu không resize mà cũng không phải PNG không alpha -> bỏ qua
    if (!needsResize && !(isPng && pngNoAlpha)) continue;

    let pipeline = sharp(orig, { failOn: "none" });

    if (needsResize) {
      pipeline = pipeline.resize({
        width: maxWidth,
        height: maxHeight,
        fit: "inside",
        withoutEnlargement: true,
      });
    }

    let target = fmt;
    if (convertPngPhotos && pngNoAlpha) {
      target = preferWebP ? "webp" : "jpeg";
    }

    if (target === "jpeg" || target === "jpg") {
      pipeline = pipeline.jpeg({ quality, mozjpeg: true });
    } else if (target === "webp") {
      pipeline = pipeline.webp({ quality });
    } else if (target === "png") {
      pipeline = pipeline.png({ compressionLevel: 9 });
    } else if (target === "tiff") {
      target = "jpeg";
      pipeline = pipeline.jpeg({ quality, mozjpeg: true });
    }

    const out = await pipeline.toBuffer();
    // chỉ thay khi nhỏ hơn đáng kể
    if (out.length < orig.length * 0.97) {
      e.setData(out);
      changed++;
    }
  }

  return { buffer: zip.toBuffer(), changed };
}
