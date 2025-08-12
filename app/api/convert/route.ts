// app/api/convert/route.ts
import { NextRequest, NextResponse } from "next/server";
import { convertDocxToPdf } from "@/lib/convert-api/libre-office";
import { compressDocxBuffer } from "@/lib/convert-api/docx-to-pdf/compress-docx";
import { parseMultipartToTmp } from "@/lib/convert-api/docx-to-pdf/multipart";
import path from "path";
import fs from "fs";
import fsp from "fs/promises";
import { Readable } from "stream";

export const runtime = "nodejs";          // bắt buộc để spawn soffice
export const dynamic = "force-dynamic";   // tránh cache

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
  let docxPath: string | undefined;
  let preppedPath: string | undefined;
  let loWorkDir: string | undefined;

  try {
    // (tuỳ chọn) API key guard
    const apiKey = req.headers.get("x-api-key") ?? new URL(req.url).searchParams.get("x-api-key");
    if (process.env.ZC_SECRET && apiKey !== process.env.ZC_SECRET) {
      return json(401, { error: "Unauthorized" });
    }

    const { file } = await parseMultipartToTmp(req, { fieldName: "file", maxFileSize: 200 * 1024 * 1024 });
    if (!file) return json(400, { error: "file is required" });

    docxPath = file.path;

    const enableCompress = (process.env.ENABLE_IMAGE_COMPRESSION ?? "true") !== "false";
    const threshold = Number(process.env.COMPRESS_THRESHOLD_MB || 15) * 1024 * 1024;

    if (enableCompress && file.size > threshold) {
      const buf = await fsp.readFile(docxPath);
      const { buffer: out, changed } = await compressDocxBuffer(buf, {
        maxWidth: Number(process.env.IMG_MAX_WIDTH || 1800),
        maxHeight: Number(process.env.IMG_MAX_HEIGHT || 1800),
        quality: Number(process.env.IMG_QUALITY || 75),
        convertPngPhotos: true,
        preferWebP: false,
        minBytesToTouch: Number(process.env.IMG_MIN_BYTES || 200000),
      });
      if (changed > 0) {
        preppedPath = path.join(path.dirname(docxPath), "prepared.docx");
        await fsp.writeFile(preppedPath, out);
      }
    }

    const inputForLO = preppedPath || docxPath;
    const inputBuffer = await fsp.readFile(inputForLO);
    const { pdfPath, workDir } = await convertDocxToPdf(inputBuffer);
    loWorkDir = workDir;

    const baseName = (file.filename || "converted.docx").replace(/\.docx?$/i, "");
    const nodeStream = fs.createReadStream(pdfPath);

    nodeStream.on("error", (e) => console.error("[/api/convert] stream error:", e));
    nodeStream.on("close", async () => {
      try { if (docxPath) await fsp.rm(path.dirname(docxPath), { recursive: true, force: true }); } catch {}
      try { if (preppedPath) await fsp.unlink(preppedPath); } catch {}
      try { if (loWorkDir) await fsp.rm(loWorkDir, { recursive: true, force: true }); } catch {}
    });

    const webStream = Readable.toWeb(nodeStream) as unknown as ReadableStream;
    return new NextResponse(webStream, {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${baseName}.pdf"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err: any) {
    console.error("[/api/convert] error:", err);
    return json(500, { error: err?.message || "Conversion failed" });
  }
}
