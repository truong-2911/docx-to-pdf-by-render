import { NextRequest, NextResponse } from "next/server";
import path from "path";
import fsp from "fs/promises";
import fs from "fs";
import { Readable } from "stream";
import { parseMultipartToTmp } from "@/lib/convert-api/docx-to-pdf/multipart";
import { replaceHtmlTags, populateDataOnDocx } from "@/lib/convert-api/docx-to-pdf/document-helper";
import { beginRequestMetrics, endRequestMetrics, mb } from "@/lib/metrics";
import { convertViaJodPath } from "@/lib/convert-api/jod";
import { convertDocxFile } from "@/lib/convert-api/libre-office";
import { requireAuth, handlePreflight } from "@/lib/utils/api-guard";
import { acquire, release } from "@/lib/utils/concurrency";
import { put } from "@vercel/blob";
import { compressDocxBuffer } from "@/lib/convert-api/docx-to-pdf/compress-docx";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, x-api-key, x-vercel-protection-bypass",
} as const;

function json(status: number, body: any, extraHeaders: Record<string, string> = {}) {
  return new NextResponse(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json", ...extraHeaders },
  });
}

export function OPTIONS(req: NextRequest) {
  return handlePreflight(req) ?? new NextResponse(null, { status: 204, headers: corsHeaders });
}

/** Tạo key upload an toàn: <BLOB_PREFIX>/<slug>.<ext> */
function toBlobKey(rawName?: string, fallback?: string, ext: "pdf" | "docx" = "pdf") {
  const base0 = (rawName || fallback || "output").replace(/\.[^.]+$/i, "");
  const safe =
    base0
      .normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-zA-Z0-9._-]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^[-_.]+|[-_.]+$/g, "")
      .slice(0, 120) || "file";
  const prefix = process.env.BLOB_PREFIX || "pdf/";
  return `${prefix}${safe}.${ext}`;
}

export async function POST(req: NextRequest) {
  const deny = requireAuth(req);
  if (deny) return deny;

  await acquire("map+convert");
  const ctx = beginRequestMetrics("map-data-and-convert");
  const REQUIRE_JOD = process.env.REQUIRE_JOD === "true";

  let templatePath: string | undefined;
  let mappedPath: string | undefined;
  let preparedPath: string | undefined;
  let workDir: string | undefined;

  const t0 = Date.now();
  let tUpload = 0, tMap = 0, tConvert = 0, tCompress = 0;
  let inputBytes = 0, outputBytes = 0;
  let used: "jod" | "lo" | "none" = "jod";

  try {
    // 1) Nhận multipart
    const { fields, file } = await parseMultipartToTmp(req, {
      fieldName: "file",
      maxFileSize: 200 * 1024 * 1024,
    });
    tUpload = Date.now() - t0;

    if (!file) return json(400, { error: "file (template docx) is required" });
    if (!fields["data"]) return json(400, { error: "data (JSON string) is required" });

    const outType = String(fields["type"] || "pdf").toLowerCase() === "docx" ? "docx" : "pdf";

    inputBytes = file.size;
    templatePath = file.path;

    // 2) MAP dữ liệu vào DOCX (ra Buffer)
    const t1 = Date.now();
    const templateBuf = await fsp.readFile(templatePath);
    const jsonObj = replaceHtmlTags(JSON.parse(fields["data"]));
    const mappedBuf = await populateDataOnDocx({ json: jsonObj, file: templateBuf });
    mappedPath = path.join(path.dirname(templatePath), "mapped.docx");
    await fsp.writeFile(mappedPath, mappedBuf);
    tMap = Date.now() - t1;

    // 3a) Nếu client yêu cầu DOCX: (tuỳ chọn) nén ảnh rồi upload DOCX lên Blob
    if (outType === "docx") {
      const enableCompress = (process.env.ENABLE_DOCX_COMPRESSION ?? "true") !== "false";
      const threshold = Number(process.env.DOCX_COMPRESS_THRESHOLD_MB || 10) * 1024 * 1024;

      let finalDocxPath = mappedPath;
      if (enableCompress && mappedBuf.length > threshold) {
        const t2 = Date.now();
        const { buffer: outBuf, changed } = await compressDocxBuffer(mappedBuf, {
          maxWidth: Number(process.env.IMG_MAX_WIDTH || 1800),
          maxHeight: Number(process.env.IMG_MAX_HEIGHT || 1800),
          quality: Number(process.env.IMG_QUALITY || 75),
          convertPngPhotos: true,
          preferWebP: false,
          minBytesToTouch: Number(process.env.IMG_MIN_BYTES || 200000),
        });
        tCompress = Date.now() - t2;

        if (changed > 0) {
          preparedPath = path.join(path.dirname(mappedPath), "prepared.docx");
          await fsp.writeFile(preparedPath, outBuf);
          finalDocxPath = preparedPath;
        }
      }

      // Upload DOCX
      const key = toBlobKey(fields["name"], file.filename, "docx");
      const nodeStream = fs.createReadStream(finalDocxPath!);
      const webStream = Readable.toWeb(nodeStream) as unknown as ReadableStream;

      const token = process.env.BLOB_READ_WRITE_TOKEN;
      const { url } = await put(key, webStream, {
        access: "public",
        contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        token,
        addRandomSuffix: false,
        allowOverwrite: true
      });

      const stat = await fsp.stat(finalDocxPath);
      outputBytes = stat.size;
      used = "none";

      const totalMs = Date.now() - t0;
      console.log(
        `[map+docx] in=${mb(inputBytes)}MB out=${mb(outputBytes)}MB | upload=${tUpload}ms | map=${tMap}ms | ` +
        `compress=${tCompress}ms | total=${totalMs}ms`
      );

      endRequestMetrics(ctx, {
        engine: used,
        phase_ms: { upload: tUpload, map: tMap, compress: tCompress, total: totalMs },
        io_bytes: { input_docx: inputBytes, output_docx: outputBytes },
      });

      // Dọn tạm
      try { if (templatePath) await fsp.rm(path.dirname(templatePath), { recursive: true, force: true }); } catch {}
      try { if (mappedPath) await fsp.unlink(mappedPath); } catch {}
      try { if (preparedPath) await fsp.unlink(preparedPath); } catch {}

      const filename = key.split("/").pop()!;
      const downloadUrl = `${url}?download=${encodeURIComponent(filename)}`;

      return json(200, {
        ok: true,
        engine: used,
        type: "docx",
        url,              // xem trực tiếp
        downloadUrl,      // ép tải về với đúng tên
        key,
        bytes: { input_docx: inputBytes, output_docx: outputBytes },
        timings: { upload: tUpload, map: tMap, compress: tCompress, total: totalMs },
      });
    }

    // 3b) Nếu client yêu cầu PDF: convert như cũ (ưu tiên JOD)
    const t3 = Date.now();
    let pdfPath: string;
    try {
      const out = await convertViaJodPath(mappedPath);
      pdfPath = out.pdfPath; workDir = out.workDir; used = "jod";
    } catch (e: any) {
      console.warn("[jod->fallback] map+convert:", e?.message || e);
      if (REQUIRE_JOD) throw new Error("JOD required but failed: " + (e?.message || e));
      const out = await convertDocxFile(mappedPath);
      pdfPath = out.pdfPath; workDir = out.workDir; used = "lo";
    }
    tConvert = Date.now() - t3;

    const stat = await fsp.stat(pdfPath);
    outputBytes = stat.size;

    const totalMs = Date.now() - t0;
    console.log(
      `[map+convert:${used}] in=${mb(inputBytes)}MB out=${mb(outputBytes)}MB | ` +
      `upload=${tUpload}ms | map=${tMap}ms | convert=${tConvert}ms | total=${totalMs}ms`
    );

    endRequestMetrics(ctx, {
      engine: used,
      phase_ms: { upload: tUpload, map: tMap, convert: tConvert, total: totalMs },
      io_bytes: { input_docx: inputBytes, output_pdf: outputBytes },
    });

    // Upload PDF
    const key = toBlobKey(fields["name"], file.filename, "pdf");
    const nodeStream = fs.createReadStream(pdfPath);
    const webStream = Readable.toWeb(nodeStream) as unknown as ReadableStream;
    const token = process.env.BLOB_READ_WRITE_TOKEN;

    const { url } = await put(key, webStream, {
      access: "public",
      contentType: "application/pdf",
      token,
      addRandomSuffix: false,
      allowOverwrite: true
    });

    // Cleanup
    try { if (templatePath) await fsp.rm(path.dirname(templatePath), { recursive: true, force: true }); } catch {}
    try { if (mappedPath) await fsp.unlink(mappedPath); } catch {}
    try { if (workDir) await fsp.rm(workDir, { recursive: true, force: true }); } catch {}

    const filename = key.split("/").pop()!;
    const downloadUrl = `${url}?download=${encodeURIComponent(filename)}`;

    return json(200, {
      ok: true,
      engine: used,
      type: "pdf",
      url,
      downloadUrl,
      key,
      bytes: { input_docx: inputBytes, output_pdf: outputBytes },
      timings: { upload: tUpload, map: tMap, convert: tConvert, total: totalMs },
    });

  } catch (err: any) {
    endRequestMetrics(ctx, { engine: used, error: err?.message ?? "unknown", phase_ms: { upload: tUpload, map: tMap, convert: tConvert, compress: tCompress } });
    console.error("[/api/map-data-and-convert] error:", err?.message || err);
    const partial = `upload;dur=${tUpload}, map;dur=${tMap}, convert;dur=${tConvert}, compress;dur=${tCompress}`;
    return json(500, { error: err?.message || "Map & conversion failed" }, { "Server-Timing": partial });
  } finally {
    release("map+convert");
  }
}
