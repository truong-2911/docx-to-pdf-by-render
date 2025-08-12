// app/api/map-data-and-convert/route.ts
import { NextRequest, NextResponse } from "next/server";
import os from "os";
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

function json(status: number, body: any) {
  return new NextResponse(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
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

  try {
    const { fields, file } = await parseMultipartToTmp(req, { fieldName: "file", maxFileSize: 200 * 1024 * 1024 });
    if (!file) return json(400, { error: "file (template docx) is required" });

    const dataRaw = fields["data"];
    if (!dataRaw) return json(400, { error: "data (JSON string) is required" });

    tmpUploadDir = path.dirname(file.path);
    templatePath = file.path;
    const name = (fields["name"] || file.filename || "output.docx").replace(/\.docx?$/i, "");

    // 1) đọc template 1 lần để render
    const templateBuf = await fsp.readFile(templatePath);
    const jsonObj = replaceHtmlTags(JSON.parse(dataRaw));
    const mappedBuf = await populateDataOnDocx({ json: jsonObj, file: templateBuf });

    mappedPath = path.join(tmpUploadDir, "mapped.docx");
    await fsp.writeFile(mappedPath, mappedBuf);

    // 2) (tùy chọn) nén nếu mapped lớn
    const enableCompress = (process.env.ENABLE_IMAGE_COMPRESSION ?? "true") !== "false";
    const threshold = Number(process.env.COMPRESS_THRESHOLD_MB || 15) * 1024 * 1024;

    if (enableCompress && mappedBuf.length > threshold) {
      const { buffer: out, changed } = await compressDocxBuffer(mappedBuf, {
        maxWidth: Number(process.env.IMG_MAX_WIDTH || 1800),
        maxHeight: Number(process.env.IMG_MAX_HEIGHT || 1800),
        quality: Number(process.env.IMG_QUALITY || 75),
        convertPngPhotos: true,
        preferWebP: false,
        minBytesToTouch: Number(process.env.IMG_MIN_BYTES || 200000),
      });
      if (changed > 0) {
        preppedPath = path.join(tmpUploadDir, "prepared.docx");
        await fsp.writeFile(preppedPath, out);
      }
    }

    // 3) Convert từ file path → stream PDF trả về
    const inputForLO = preppedPath || mappedPath;
    const inputBuffer = await fsp.readFile(inputForLO);
    const { pdfPath, workDir } = await convertDocxToPdf(inputBuffer);
    loWorkDir = workDir;

    const nodeStream = fs.createReadStream(pdfPath);

    const cleanup = async () => {
      try { if (templatePath) await fsp.rm(path.dirname(templatePath), { recursive: true, force: true }); } catch {}
      try { if (mappedPath) await fsp.unlink(mappedPath); } catch {}
      try { if (preppedPath) await fsp.unlink(preppedPath); } catch {}
      try { if (loWorkDir) await fsp.rm(loWorkDir, { recursive: true, force: true }); } catch {}
    };
    nodeStream.on("close", cleanup);

    const webStream = Readable.toWeb(nodeStream) as unknown as ReadableStream;
    return new NextResponse(webStream, {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${name}.pdf"`,
      },
    });
  } catch (err: any) {
    console.error("[/api/map-data-and-convert] error:", err);
    return json(500, { error: err?.message || "Map & conversion failed" });
  }
}
