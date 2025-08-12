// middleware.ts
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS,PATCH",
  "Access-Control-Allow-Headers":
    "Content-Type, x-api-key, x-vercel-protection-bypass, X-Conversation-State, x-conversation-state",
  "Access-Control-Expose-Headers": "X-Conversation-State",
};

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // ✅ Bypass hoàn toàn cho các route chuyển đổi
  if (pathname.startsWith("/api/convert") || pathname.startsWith("/api/map-data-and-convert")) {
    if (request.method === "OPTIONS") {
      return new NextResponse(null, { status: 204, headers: corsHeaders });
    }
    return NextResponse.next();
  }

  // ... phần còn lại giữ nguyên như bạn có
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
