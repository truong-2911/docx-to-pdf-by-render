import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS,PATCH",
  "Access-Control-Allow-Headers":
    "Content-Type, x-api-key, x-vercel-protection-bypass, X-Conversation-State, x-conversation-state",
  "Access-Control-Expose-Headers": "X-Conversation-State",
};

export async function middleware(request: NextRequest) {
  console.log("✅ Middleware hit:", request.nextUrl.pathname);

  if (request.method === "OPTIONS") {
    console.log("🔹 CORS preflight request");
    return new NextResponse(null, { status: 204, headers: corsHeaders });
  }

  if (
    request.nextUrl.pathname.includes("/api/convert") ||
    request.nextUrl.pathname.includes("/api/map-data-and-convert")
  ) {
    console.log("🔹 API protected route hit");
    const apiKey =
      request.headers.get("x-api-key") ||
      request.nextUrl.searchParams.get("x-api-key");
    const expectedApiKey = process.env.ZC_SECRET;

    console.log("Received API key:", apiKey);
    if (!apiKey || apiKey !== expectedApiKey) {
      console.warn("❌ Unauthorized access attempt");
      return new NextResponse(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    return NextResponse.next();
  }

  return await updateSession(request);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
