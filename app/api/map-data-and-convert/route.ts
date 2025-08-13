// app/api/map-data-and-convert/route.ts
import { NextRequest, NextResponse } from "next/server";
import path from "path";
import fsp from "fs/promises";
import fs from "fs";
import { Readable } from "stream";
import { parseMultipartToTmp } from "@/lib/convert-api/docx-to-pdf/multipart";
import { replaceHtmlTags } from "@/lib/convert-api/docx-to-pdf/document-helper";
import { populateDataOnDocx } from "@/lib/convert-api/docx-to-pdf/document-helper";
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

  const deny = requireAuth(req);
  if (deny) return deny;
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
    const { fields, file } = await parseMultipartToTmp(req, { fieldName: "file", maxFileSize: 200 * 1024 * 1024 });
    tUpload = Date.now() - t0;
    if (!file) return json(400, { error: "file (template docx) is required" });
    if (!fields["data"]) return json(400, { error: "data (JSON string) is required" });

    inputBytes = file.size;
    templatePath = file.path;
    const name = (fields["name"] || file.filename || "output.docx").replace(/\.docx?$/i, "");

    // MAP
    const t1 = Date.now();
    const templateBuf = await fsp.readFile(templatePath);
    const jsonObj = replaceHtmlTags(JSON.parse(fields["data"]));
    const mappedBuf = await populateDataOnDocx({ json: jsonObj, file: templateBuf });
    mappedPath = path.join(path.dirname(templatePath), "mapped.docx");
    await fsp.writeFile(mappedPath, mappedBuf);
    tMap = Date.now() - t1;

    // CONVERT (ưu tiên JOD)
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

    const nodeStream = fs.createReadStream(pdfPath);
    const cleanup = async () => {
      try { if (templatePath) await fsp.rm(path.dirname(templatePath), { recursive: true, force: true }); } catch {}
      try { if (mappedPath) await fsp.unlink(mappedPath); } catch {}
      try { if (workDir) await fsp.rm(workDir, { recursive: true, force: true }); } catch {}
    };
    nodeStream.on("close", cleanup);

    const webStream = Readable.toWeb(nodeStream) as unknown as ReadableStream;
    return new NextResponse(webStream, {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${name}.pdf"`,
        "Server-Timing": `upload;dur=${tUpload}, map;dur=${tMap}, convert;dur=${tConvert}, total;dur=${totalMs}`,
      },
    });
  } catch (err: any) {
    endRequestMetrics(ctx, { engine: used, error: err?.message ?? "unknown", phase_ms: { upload: tUpload, map: tMap, convert: tConvert } });
    console.error("[/api/map-data-and-convert] error:", err);
    const partial = `upload;dur=${tUpload}, map;dur=${tMap}, convert;dur=${tConvert}`;
    return json(500, { error: err?.message || "Map & conversion failed" }, { "Server-Timing": partial });
  }
}
