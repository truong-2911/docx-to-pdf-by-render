// app/api/warmup/route.ts
import { NextResponse } from "next/server";
import http from "http";
import https from "https";
import axios from "axios";
import { jodConvertBytes } from "@/lib/convert-api/jod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Keep-Alive agents để tái dùng kết nối ngay trong process app
const agentHttp = new http.Agent({ keepAlive: true, maxSockets: 16, maxFreeSockets: 16, keepAliveMsecs: 60_000 });
const agentHttps = new https.Agent({ keepAlive: true, maxSockets: 16, maxFreeSockets: 16, keepAliveMsecs: 60_000 });
const ax = axios.create({
  timeout: 5000,
  httpAgent: agentHttp,
  httpsAgent: agentHttps,
  validateStatus: () => true,
});

// 1) Nạp trước các module nặng
async function warmNodeModules() {
  await Promise.allSettled([
    import("@/lib/convert-api/docx-to-pdf/document-helper"),
    import("@/lib/convert-api/docx-to-pdf/multipart"),
    import("@/lib/convert-api/libre-office"),
  ]);
}

// 2) Ép JOD/LibreOffice chạy 1 job nhỏ (ấm thật sự filter/pdf-export)
async function warmJOD() {
  try {
    const dummy = Buffer.from("warmup", "utf8");
    const pdf = await jodConvertBytes("warmup.txt", dummy, "pdf");
    return { ok: true, bytes: pdf.length };
  } catch (e: any) {
    return { ok: false, error: e?.message || String(e) };
  }
}

// 3a) HEAD để ấm DNS/TLS/Keep-Alive tới host Zoho
async function warmZohoHeads() {
  const targets = (process.env.WARM_ZOHO_URLS || "https://creator.zohopublic.com/")
    .split(",").map(s => s.trim()).filter(Boolean);
  const t0 = Date.now();
  const results = await Promise.allSettled(targets.map(u => ax.head(u, { headers: { "Cache-Control": "no-store" } })));
  const ok = results.filter(r => r.status === "fulfilled").length;
  return { ok, total: targets.length, took_ms: Date.now() - t0 };
}

// 3b) GET “range 0-0” để ấm cache đúng object rất nhẹ
async function warmZohoObjects() {
  const urls = (process.env.WARM_ZOHO_GET_URLS || "")
    .split(",").map(s => s.trim()).filter(Boolean);
  if (urls.length === 0) return { ok: 0, total: 0, took_ms: 0 };

  const MAX = Number(process.env.WARM_ZOHO_MAX_BYTES || 20000); // 20KB mặc định
  const t0 = Date.now();
  let ok = 0;

  for (const u of urls) {
    try {
      // Thử GET range 0-0 (1 byte) để populate cache mà hầu như không tốn băng thông
      const r = await ax.get(u, {
        responseType: "arraybuffer",
        headers: { Range: "bytes=0-0", Accept: "image/*" },
      });
      // 206 Partial Content là tốt nhất; một số server vẫn 200 OK và trả full nếu không hỗ trợ range
      if (r.status === 206 || r.status === 200) {
        ok++;
        continue;
      }

      // Nếu không thành công, đọc HEAD để quyết định có nên GET full không
      const h = await ax.head(u);
      const len = Number(h.headers["content-length"] || 0);
      if (h.status >= 200 && h.status < 300 && len > 0 && len <= MAX) {
        const r2 = await ax.get(u, { responseType: "arraybuffer", headers: { Accept: "image/*" } });
        if (r2.status >= 200 && r2.status < 300) ok++;
      }
    } catch {
      // bỏ qua lỗi từng URL để không fail cả warmup
    }
  }

  return { ok, total: urls.length, took_ms: Date.now() - t0 };
}

export async function GET() {
  const t0 = Date.now();
  try {
    await warmNodeModules();
    const [jod, heads, objs] = await Promise.all([
      warmJOD(),
      warmZohoHeads(),
      warmZohoObjects(),
    ]);
    return NextResponse.json({
      ok: true,
      jod, zoho_heads: heads, zoho_objects: objs,
      took_ms: Date.now() - t0
    });
  } catch (e:any) {
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 500 });
  }
}
