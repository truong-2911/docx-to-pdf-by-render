import axiosBase from "axios";
import PizZip from "pizzip";
import Docxtemplater from "docxtemplater";
import ImageModule from "docxtemplater-image-module-free";
import { imageSize as sizeOf } from "image-size";
import http from "http";
import https from "https";
import sharp from "sharp";

// ==== Tuning (có thể đổi bằng env) ====
const MAX_W = Number(process.env.IMG_MAX_WIDTH || 1800);
const MAX_H = Number(process.env.IMG_MAX_HEIGHT || 1800);
const JPEG_Q = Number(process.env.IMG_QUALITY || 75);
const INLINE_OPTIMIZE = (process.env.FAST_INLINE_OPTIMIZE ?? "true") !== "false";
// =====================================

// Keep-alive agents để tải nhiều ảnh nhanh hơn
const agentHttp = new http.Agent({ keepAlive: true, maxSockets: 6 });
const agentHttps = new https.Agent({ keepAlive: true, maxSockets: 6 });
const axios = axiosBase.create({
  httpAgent: agentHttp,
  httpsAgent: agentHttps,
  timeout: 15000,
});

export function getHttpData(url: string, token = ""): Promise<ArrayBuffer> {
  const headers = token ? { Authorization: `Zoho-oauthtoken ${token}` } : {};
  return axios.get(url, { responseType: "arraybuffer", headers }).then((r) => r.data);
}

// ⚡️ MẸO: memo hoá theo URL để không tải/biến đổi lặp lại
type ImgRec = { buf: Buffer; w: number; h: number };
function makeGetters() {
  const memo = new Map<string, Promise<ImgRec>>();

  const getImage = (tagObj: any) => {
    const url = String(tagObj?.link || "");
    if (!url) throw new Error("Image tag missing 'link'");

    if (!memo.has(url)) {
      memo.set(
        url,
        (async () => {
          const arr = Buffer.from(await getHttpData(url));

          if (!INLINE_OPTIMIZE) {
            const s = sizeOf(arr);
            const w = s.width ?? 1, h = s.height ?? 1;
            return { buf: arr, w, h };
          }

          // Tối ưu inline: resize và/hoặc đổi JPEG nếu hợp lý
          let out = arr;
          let meta = await sharp(arr, { failOn: "none" }).metadata();
          let w = meta.width ?? 1, h = meta.height ?? 1;

          const needsResize = (meta.width ?? 0) > MAX_W || (meta.height ?? 0) > MAX_H;
          const pngNoAlpha = meta.format === "png" && meta.hasAlpha !== true;
          const tiff = meta.format === "tiff";

          if (needsResize || pngNoAlpha || tiff) {
            let p = sharp(arr, { failOn: "none" });
            if (needsResize) {
              p = p.resize({ width: MAX_W, height: MAX_H, fit: "inside", withoutEnlargement: true });
            }
            // PNG không alpha & TIFF => chuyển JPEG cho gọn/nhanh
            if (pngNoAlpha || tiff) {
              p = p.jpeg({ quality: JPEG_Q, mozjpeg: true });
            }
            out = Buffer.from(await p.toBuffer());

            const meta2 = await sharp(out, { failOn: "none" }).metadata();
            w = meta2.width ?? w;
            h = meta2.height ?? h;
          }

          return { buf: out, w, h };
        })()
      );
    }
    // ImageModule sẽ nhận Buffer
    return memo.get(url)!.then((r) => r.buf);
  };

  const getSize = (img: Buffer, tagObj: any) => {
    // Hầu hết trường hợp img là buffer sau tối ưu ở trên -> sizeOf đọc header rất nhanh
    const { width = 1, height = 1 } = sizeOf(img);
    const targetW = Math.min(tagObj?.maxWidth || width, width);
    const targetH = Math.round((height / width) * targetW);
    return [targetW, targetH];
  };

  return { getImage, getSize };
}

export async function populateDataOnDocx({
  json, file,
}: { json: any; file: Buffer; }): Promise<Buffer> {
  const { getImage, getSize } = makeGetters();

  const imageModule = new ImageModule({
    centered: false,
    fileType: "docx",
    getImage,
    getSize,
  });

  const zip = new PizZip(file);
  const doc = new Docxtemplater(zip, {
    modules: [imageModule],
    paragraphLoop: true,
    linebreaks: true,
  });

  await doc.renderAsync(json);

  return doc.getZip().generate({ type: "nodebuffer", compression: "DEFLATE" });
}
