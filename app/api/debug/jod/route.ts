// app/api/debug/jod/route.ts
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const base = (process.env.JOD_URL || "").replace(/\/+$/, "");
  const ep = process.env.JOD_ENDPOINT ? process.env.JOD_ENDPOINT.replace(/\/+$/, "") : "/conversion";
  if (!base) {
    return NextResponse.json({ ok: false, error: "JOD_URL not set" }, { status: 500 });
  }

  const out: any = { base, try: { ready: `${base}/ready`, conv: `${base}${ep}?format=pdf` } };

  try {
    const r = await fetch(`${base}/ready`, { cache: "no-store" });
    out.ready = { status: r.status };
  } catch (e: any) {
    out.ready = { error: e?.message || String(e) };
  }

  try {
    const r = await fetch(`${base}${ep}`, { method: "POST", cache: "no-store" });
    out.probe = { status: r.status };
  } catch (e: any) {
    out.probe = { error: e?.message || String(e) };
  }

  return NextResponse.json({ ok: true, ...out }, { status: 200 });
}
