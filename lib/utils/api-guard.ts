// utils/api-guard.ts
import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS,PATCH",
  "Access-Control-Allow-Headers":
    // thêm Authorization để client gửi Bearer token qua CORS
    "Content-Type, Authorization, x-api-key, x-vercel-protection-bypass, X-Conversation-State, x-conversation-state",
  "Access-Control-Expose-Headers": "X-Conversation-State",
} as const;

// Đọc tất cả token từ ENV (hỗ trợ ngăn cách bởi dấu phẩy, xuống dòng, khoảng trắng)
function loadTokens(): Buffer[] {
  const raw = process.env.API_TOKENS || process.env.API_TOKEN || "";
  const arr = raw
    .split(/[\s,]+/g)
    .map((s) => s.trim())
    .filter(Boolean);
  return arr.map((t) => Buffer.from(t));
}
const TOKENS = loadTokens();

function timingSafeEqualStr(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  try {
    return crypto.timingSafeEqual(ab, bb);
  } catch {
    return false;
  }
}

function extractToken(req: NextRequest): string | null {
  const auth = req.headers.get("authorization");
  if (auth && /^bearer\s+/i.test(auth)) {
    return auth.replace(/^bearer\s+/i, "").trim();
  }
  const key = req.headers.get("x-api-key");
  if (key) return key.trim();

  const url = new URL(req.url);
  return (
    url.searchParams.get("token") ||
    url.searchParams.get("x-api-key") ||
    null
  );
}

export function handlePreflight(req: NextRequest) {
  if (req.method === "OPTIONS") {
    return new NextResponse(null, { status: 204, headers: corsHeaders });
  }
  return null;
}

// Trả NextResponse 401 nếu không hợp lệ; null nếu pass
export function requireAuth(req: NextRequest): NextResponse | null {
  // cho phép skip nếu bạn tạm thời chưa đặt token
  if (!TOKENS.length) return null;

  const token = extractToken(req);
  if (!token) {
    return new NextResponse(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "WWW-Authenticate": "Bearer" },
    });
  }

  // so sánh token với danh sách cho phép
  const ok = TOKENS.some((t) => timingSafeEqualStr(token, t.toString()));
  if (!ok) {
    return new NextResponse(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "WWW-Authenticate": "Bearer" },
    });
  }
  return null;
}
