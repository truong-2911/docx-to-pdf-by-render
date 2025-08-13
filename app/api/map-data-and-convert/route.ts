// app/api/map-data-and-convert/route.ts
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

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
  // 👇 thêm Authorization để client có thể gửi Bearer token qua CORS
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

export async function POST(req: NextRequest) {
  const deny = requireAuth(req);
  if (deny) return deny;

  await acquire("map+convert");
  const ctx = beginRequestMetrics("map-data-and-convert");
  const REQUIRE_JOD = process.env.REQUIRE_JOD === "true";

  let templatePath: string | undefined;
  let mappedPath: string | undefined;
  let workDir: string | undefined;

  const t0 = Date.now();
  let tUpload = 0, tMap = 0, tConvert = 0;
  let inputBytes = 0, outputBytes = 0;
  let used: "jod" | "lo" = "jod";

  try {
    // 1) UPLOAD multipart
    const { fields, file } = await parseMultipartToTmp(req, { fieldName: "file", maxFileSize: 200 * 1024 * 1024 });
    tUpload = Date.now() - t0;
    if (!file) return json(400, { error: "file (template docx) is required" });
    if (!fields["data"]) return json(400, { error: "data (JSON string) is required" });

    inputBytes = file.size;
    templatePath = file.path;

    const rawName = (fields["name"] || file.filename || "output.docx").replace(/\.docx?$/i, "");
    const pdfKey = `${(process.env.BLOB_PREFIX || "pdf/")}${rawName}.pdf`;

    // 2) MAP
    const t1 = Date.now();
    const templateBuf = await fsp.readFile(templatePath);
    const jsonObj = replaceHtmlTags(JSON.parse(fields["data"]));
    const mappedBuf = await populateDataOnDocx({ json: jsonObj, file: templateBuf });
    mappedPath = path.join(path.dirname(templatePath), "mapped.docx");
    await fsp.writeFile(mappedPath, mappedBuf);
    tMap = Date.now() - t1;

    // 3) CONVERT (ưu tiên JOD)
    const t2 = Date.now();
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
    tConvert = Date.now() - t2;

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

    // 4) UPLOAD TO VERCEL BLOB (STREAM) — không đọc vào RAM
    // convert Node stream -> Web ReadableStream
    const nodeStream = fs.createReadStream(pdfPath);
    const webStream = Readable.toWeb(nodeStream) as unknown as ReadableStream;

    const token = process.env.BLOB_READ_WRITE_TOKEN; // bắt buộc ngoài Vercel
    const { url } = await put(pdfKey, webStream, {
      access: "public",
      contentType: "application/pdf",
      token,
      // nếu muốn ghi đè tên file cũ
      addRandomSuffix: false,
      // hoặc: allowOverwrite: true,  (cũng OK, nhưng addRandomSuffix:false đủ dùng)
      // cacheControl: "public, max-age=31536000, immutable",
    });

    // 5) CLEANUP file tạm sau khi upload xong
    try { if (templatePath) await fsp.rm(path.dirname(templatePath), { recursive: true, force: true }); } catch {}
    try { if (mappedPath) await fsp.unlink(mappedPath); } catch {}
    try { if (workDir) await fsp.rm(workDir, { recursive: true, force: true }); } catch {}

    // 6) TRẢ JSON (URL blob)
    const serverTiming = `upload;dur=${tUpload}, map;dur=${tMap}, convert;dur=${tConvert}, total;dur=${totalMs}`;
    return json(200, {
      ok: true,
      engine: used,
      url,
      key: pdfKey,
      bytes: { input_docx: inputBytes, output_pdf: outputBytes },
      timings: { upload: tUpload, map: tMap, convert: tConvert, total: totalMs },
    }, { "Server-Timing": serverTiming });

  } catch (err: any) {
    endRequestMetrics(ctx, { engine: used, error: err?.message ?? "unknown", phase_ms: { upload: tUpload, map: tMap, convert: tConvert } });
    console.error("[/api/map-data-and-convert] error:", err?.message || err);
    const partial = `upload;dur=${tUpload}, map;dur=${tMap}, convert;dur=${tConvert}`;
    return json(500, { error: err?.message || "Map & conversion failed" }, { "Server-Timing": partial });
  } finally {
    release("map+convert");
  }
}
