import { NextRequest, NextResponse } from "next/server";
import { convertDocxToPdf } from "@/lib/convert-api/libre-office";
import { compressDocxBuffer } from "@/lib/convert-api/docx-to-pdf/compress-docx";
import { parseMultipartToTmp } from "@/lib/convert-api/docx-to-pdf/multipart";
import path from "path";
import fs from "fs";
import fsp from "fs/promises";
import { Readable } from "stream";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type"
};

function j(status: number, body: any) {
  return new NextResponse(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" }
  });
}

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: cors });
}

export async function POST(req: NextRequest) {
  let tmpDir: string | undefined;
  let docxPath: string | undefined;
  let preppedPath: string | undefined;
  let loWorkDir: string | undefined;

  try {
    const { file } = await parseMultipartToTmp(req, {
      fieldName: "file",
      maxFileSize: 200 * 1024 * 1024
    });
    console.log("file", file);
    if (!file) return j(400, { error: "file is required" });

    tmpDir = path.dirname(file.path);
    docxPath = file.path;

    // optional compress
    const enable = (process.env.ENABLE_IMAGE_COMPRESSION ?? "true") !== "false";
    const threshold = Number(process.env.COMPRESS_THRESHOLD_MB || 15) * 1024 * 1024;

    if (enable && file.size > threshold) {
      const buf = await fsp.readFile(docxPath);
      const { buffer: out, changed } = await compressDocxBuffer(buf, {
        maxWidth: Number(process.env.IMG_MAX_WIDTH || 1900),
        maxHeight: Number(process.env.IMG_MAX_HEIGHT || 1900),
        quality: Number(process.env.IMG_QUALITY || 78),
        convertPngPhotos: true,
        preferWebP: false,
        minBytesToTouch: Number(process.env.IMG_MIN_BYTES || 100000)
      });
      if (changed > 0) {
        preppedPath = path.join(tmpDir, "prepared.docx");
        await fsp.writeFile(preppedPath, out);
      }
    }

    const input = await fsp.readFile(preppedPath || docxPath);
    const { pdfPath, workDir } = await convertDocxToPdf(input);
    loWorkDir = workDir;

    const base = (file.filename || "converted.docx").replace(/\.docx?$/i, "");
    const nodeStream = fs.createReadStream(pdfPath);

    const cleanup = async () => {
      try { if (docxPath) await fsp.rm(path.dirname(docxPath), { recursive: true, force: true }); } catch {}
      try { if (preppedPath) await fsp.unlink(preppedPath); } catch {}
      try { if (loWorkDir) await fsp.rm(loWorkDir, { recursive: true, force: true }); } catch {}
    };
    nodeStream.on("close", cleanup);

    const webStream = Readable.toWeb(nodeStream) as unknown as ReadableStream;
    return new NextResponse(webStream, {
      status: 200,
      headers: {
        ...cors,
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${base}.pdf"`
      }
    });
  } catch (err: any) {
    console.error("[/api/convert] error:", err);
    return j(500, { error: err?.message || "Conversion failed" });
  }
}
