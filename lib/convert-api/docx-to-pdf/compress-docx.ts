// lib/convert-api/docx-to-pdf/compress-docx.ts
import AdmZip from "adm-zip";
import sharp from "sharp";

type Opts = {
  maxWidth?: number;
  maxHeight?: number;
  quality?: number;
  convertPngPhotos?: boolean;
  preferWebP?: boolean;
  minBytesToTouch?: number;
};

export async function compressDocxBuffer(
  input: Buffer,
  {
    maxWidth = 1900,
    maxHeight = 1900,
    quality = 78,
    convertPngPhotos = true,
    preferWebP = false,
    minBytesToTouch = 100 * 1024
  }: Opts = {}
) {
  const zip = new AdmZip(input);
  const entries = zip.getEntries();
  let changed = 0;

  for (const e of entries) {
    if (!e.entryName.startsWith("word/media/") || e.isDirectory) continue;

    const orig = e.getData();
    if (!orig || orig.length < minBytesToTouch) continue;

    let meta;
    try { meta = await sharp(orig, { failOn: "none" }).metadata(); }
    catch { continue; }
    if (!meta?.width || !meta?.height) continue;

    const photo = ["jpeg","jpg","webp","png","tiff"].includes(String(meta.format));
    if (!photo) continue;

    let pipe = sharp(orig, { failOn: "none" });
    if (meta.width > maxWidth || meta.height > maxHeight) {
      pipe = pipe.resize({ width: maxWidth, height: maxHeight, fit: "inside", withoutEnlargement: true });
    }

    let target = meta.format;
    if (convertPngPhotos && meta.format === "png" && meta.hasAlpha !== true) {
      target = preferWebP ? "webp" : "jpeg";
    }

    if (target === "jpeg" || target === "jpg") pipe = pipe.jpeg({ quality, mozjpeg: true });
    else if (target === "webp") pipe = pipe.webp({ quality });
    else if (target === "png") pipe = pipe.png({ compressionLevel: 9 });
    else if (target === "tiff") { target = "jpeg"; pipe = pipe.jpeg({ quality, mozjpeg: true }); }

    const out = await pipe.toBuffer();
    if (out.length < orig.length * 0.97) { e.setData(out); changed++; }
  }

  return { buffer: zip.toBuffer(), changed };
}
