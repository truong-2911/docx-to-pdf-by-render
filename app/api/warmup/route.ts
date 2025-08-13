// app/api/warmup/route.ts
import { NextResponse } from "next/server";
import { jodConvertBytes } from "@/lib/convert-api/jod";
import fsp from "fs/promises";
import path from "path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function warmNodeModules() {
  // nạp trước để lần request thật không còn cold-import
  await Promise.allSettled([
    import("@/lib/convert-api/docx-to-pdf/document-helper"),
    import("@/lib/convert-api/docx-to-pdf/multipart"),
    import("@/lib/convert-api/libre-office"),
  ]);
}

async function warmJOD() {
  // ép JOD/LibreOffice chạy 1 job thật sự (file text vài byte)
  // giúp spawn LO + load filter/pdf-export + font cache
  const buf = Buffer.from("warmup", "utf8");
  try {
    const tinyDocx = await fsp.readFile(path.join(process.cwd(), "public", "tiny.docx"));
    const pdf = await jodConvertBytes("warmup.docx", tinyDocx, "pdf");
    // bỏ kết quả, chỉ cần khởi động đường convert
    return { ok: true, bytes: pdf.length };
  } catch (e: any) {
    return { ok: false, error: e?.message || String(e) };
  }
}

export async function GET() {
  const t0 = Date.now();
  try {
    await warmNodeModules();
    const r = await warmJOD();
    const ms = Date.now() - t0;
    return NextResponse.json({ ok: true, jod: r, took_ms: ms });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 500 });
  }
}
