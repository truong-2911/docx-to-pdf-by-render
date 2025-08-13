// app/api/convert/route.ts
import { NextRequest, NextResponse } from "next/server";
import { parseMultipartToTmp } from "@/lib/convert-api/docx-to-pdf/multipart";
import path from "path";
import fs from "fs";
import fsp from "fs/promises";
import { Readable } from "stream";
import { beginRequestMetrics, endRequestMetrics, mb } from "@/lib/metrics";
import { convertViaJodPath } from "@/lib/convert-api/jod";
import { convertDocxFile } from "@/lib/convert-api/libre-office";
import { requireAuth } from "@/lib/utils/api-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, x-api-key, x-vercel-protection-bypass",
} as const;

function json(status: number, body: any, extraHeaders: Record<string, string> = {}) {
  return new NextResponse(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json", ...extraHeaders },
  });
}

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders });
}

export async function POST(req: NextRequest) {

  const deny = requireAuth(req);
  if (deny) return deny;  
  const ctx = beginRequestMetrics("convert");
  const REQUIRE_JOD = process.env.REQUIRE_JOD === "true";

  let docxPath: string | undefined;
  let workDir: string | undefined;

  const t0 = Date.now();
  let tUpload = 0, tConvert = 0;
  let inputBytes = 0, outputBytes = 0;
  let used: "jod" | "lo" = "jod";

  try {
    const { file } = await parseMultipartToTmp(req, { fieldName: "file", maxFileSize: 200 * 1024 * 1024 });
    tUpload = Date.now() - t0;
    if (!file) return json(400, { error: "file is required" });

    inputBytes = file.size;
    docxPath = file.path;

    const t2 = Date.now();
    let pdfPath: string;

    try {
      const out = await convertViaJodPath(docxPath!);
      pdfPath = out.pdfPath; workDir = out.workDir; used = "jod";
    } catch (e: any) {
      console.warn("[jod->fallback] convert:", e?.message || e);
      if (REQUIRE_JOD) throw new Error("JOD required but failed: " + (e?.message || e));
      const out = await convertDocxFile(docxPath!);
      pdfPath = out.pdfPath; workDir = out.workDir; used = "lo";
    }
    tConvert = Date.now() - t2;

    const stat = await fsp.stat(pdfPath);
    outputBytes = stat.size;

    const totalMs = Date.now() - t0;
    console.log(`[convert:${used}] in=${mb(inputBytes)}MB out=${mb(outputBytes)}MB | upload=${tUpload}ms | convert=${tConvert}ms | total=${totalMs}ms`);

    endRequestMetrics(ctx, {
      engine: used,
      phase_ms: { upload: tUpload, convert: tConvert, total: totalMs },
      io_bytes: { input_docx: inputBytes, output_pdf: outputBytes },
    });

    const baseName = (file.filename || "converted.docx").replace(/\.docx?$/i, "");
    const nodeStream = fs.createReadStream(pdfPath);
    const cleanup = async () => {
      try { if (docxPath) await fsp.rm(path.dirname(docxPath), { recursive: true, force: true }); } catch {}
      try { if (workDir) await fsp.rm(workDir, { recursive: true, force: true }); } catch {}
    };
    nodeStream.on("close", cleanup);

    const webStream = Readable.toWeb(nodeStream) as unknown as ReadableStream;
    return new NextResponse(webStream, {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${baseName}.pdf"`,
        "Server-Timing": `upload;dur=${tUpload}, convert;dur=${tConvert}, total;dur=${totalMs}`,
      },
    });
  } catch (err: any) {
    endRequestMetrics(ctx, { engine: used, error: err?.message ?? "unknown", phase_ms: { upload: tUpload, convert: tConvert } });
    console.error("[/api/convert] error:", err);
    const partial = `upload;dur=${tUpload}, convert;dur=${tConvert}`;
    return json(500, { error: err?.message || "Conversion failed" }, { "Server-Timing": partial });
  }
}
