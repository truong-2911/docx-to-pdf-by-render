// app/api/map-data-and-convert/route.ts
import { NextRequest, NextResponse } from "next/server";
import path from "path";
import fsp from "fs/promises";
import fs from "fs";
import { Readable } from "stream";
import { parseMultipartToTmp } from "@/lib/convert-api/docx-to-pdf/multipart";
import { replaceHtmlTags } from "@/lib/convert-api/docx-to-pdf/html-helper";
import { populateDataOnDocx } from "@/lib/convert-api/docx-to-pdf/document-helper";
import { convertDocxToPdf } from "@/lib/convert-api/libre-office";
import { compressDocxBuffer } from "@/lib/convert-api/docx-to-pdf/compress-docx";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, x-api-key, x-vercel-protection-bypass",
};

function json(status: number, body: any, extraHeaders: Record<string,string> = {}) {
  return new NextResponse(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json", ...extraHeaders },
  });
}

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders });
}

export async function POST(req: NextRequest) {
  let tmpUploadDir: string | undefined;
  let templatePath: string | undefined;
  let mappedPath: string | undefined;
  let preppedPath: string | undefined;
  let loWorkDir: string | undefined;

  // timers
  const t0 = Date.now();
  let tUpload = 0, tMap = 0, tCompress = 0, tConvert = 0;

  try {
    // UPLOAD
    const { fields, file } = await parseMultipartToTmp(req, { fieldName: "file", maxFileSize: 200 * 1024 * 1024 });
    tUpload = Date.now() - t0;

    if (!file) return json(400, { error: "file (template docx) is required" });

    const dataRaw = fields["data"];
    if (!dataRaw) return json(400, { error: "data (JSON string) is required" });

    tmpUploadDir = path.dirname(file.path);
    templatePath = file.path;
    const name = (fields["name"] || file.filename || "output.docx").replace(/\.docx?$/i, "");

    // MAP DATA
    const t1 = Date.now();
    const templateBuf = await fsp.readFile(templatePath);
    const jsonObj = replaceHtmlTags(JSON.parse(dataRaw));
    const mappedBuf = await populateDataOnDocx({ json: jsonObj, file: templateBuf });
    mappedPath = path.join(tmpUploadDir, "mapped.docx");
    await fsp.writeFile(mappedPath, mappedBuf);
    tMap = Date.now() - t1;

    // COMPRESS (optional)
    const t2 = Date.now();
    const enableCompress = (process.env.ENABLE_IMAGE_COMPRESSION ?? "true") !== "false";
    const threshold = Number(process.env.COMPRESS_THRESHOLD_MB || 15) * 1024 * 1024;

    // if (enableCompress && mappedBuf.length > threshold) {
    //   const { buffer: out, changed } = await compressDocxBuffer(mappedBuf, {
    //     maxWidth: Number(process.env.IMG_MAX_WIDTH || 1800),
    //     maxHeight: Number(process.env.IMG_MAX_HEIGHT || 1800),
    //     quality: Number(process.env.IMG_QUALITY || 75),
    //     convertPngPhotos: true,
    //     preferWebP: false,
    //     minBytesToTouch: Number(process.env.IMG_MIN_BYTES || 200000),
    //   });
    //   if (changed > 0) {
    //     preppedPath = path.join(tmpUploadDir, "prepared.docx");
    //     await fsp.writeFile(preppedPath, out);
    //   }
    // }
    tCompress = Date.now() - t2;

    // CONVERT
    const t3 = Date.now();
    const inputForLO = preppedPath || mappedPath;
    const inputBuffer = await fsp.readFile(inputForLO!);
    const { pdfPath, workDir } = await convertDocxToPdf(inputBuffer);
    loWorkDir = workDir;
    tConvert = Date.now() - t3;

    const totalMs = Date.now() - t0;
    console.log(`[map+convert] size=${(file.size/1024/1024).toFixed(2)}MB | upload=${tUpload}ms | map=${tMap}ms | compress=${tCompress}ms | convert=${tConvert}ms | total=${totalMs}ms`);

    const nodeStream = fs.createReadStream(pdfPath);
    const cleanup = async () => {
      try { if (templatePath) await fsp.rm(path.dirname(templatePath), { recursive: true, force: true }); } catch {}
      try { if (mappedPath) await fsp.unlink(mappedPath); } catch {}
      try { if (preppedPath) await fsp.unlink(preppedPath); } catch {}
      try { if (loWorkDir) await fsp.rm(loWorkDir, { recursive: true, force: true }); } catch {}
    };
    nodeStream.on("close", cleanup);

    const serverTiming =
      `upload;dur=${tUpload}, map;dur=${tMap}, compress;dur=${tCompress}, convert;dur=${tConvert}, total;dur=${totalMs}`;

    const webStream = Readable.toWeb(nodeStream) as unknown as ReadableStream;
    return new NextResponse(webStream, {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${name}.pdf"`,
        "Server-Timing": serverTiming,
        "X-Timing-Upload": String(tUpload),
        "X-Timing-Map": String(tMap),
        "X-Timing-Compress": String(tCompress),
        "X-Timing-Convert": String(tConvert),
        "X-Timing-Total": String(totalMs),
      },
    });
  } catch (err: any) {
    console.error("[/api/map-data-and-convert] error:", err);
    const partial = `upload;dur=${tUpload}, map;dur=${tMap}, compress;dur=${tCompress}, convert;dur=${tConvert}`;
    return json(500, { error: err?.message || "Map & conversion failed" }, { "Server-Timing": partial });
  }
}
