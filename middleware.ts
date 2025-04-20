import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { updateSession } from "@/utils/supabase/middleware";

export async function middleware(request: NextRequest) {
  // Check if the request is for Zoho Creator API routes
  if (request.nextUrl.pathname.startsWith("/api/zoho/")) {
    const apiKey = request.headers.get("x-api-key");
    const expectedApiKey = process.env.ZC_SECRET;

    // If no API key is provided or it doesn't match, return 401
    if (!apiKey || apiKey !== expectedApiKey) {
      return new NextResponse(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: {
          "Content-Type": "application/json",
        },
      });
    }
  }

  // For all other routes, use Supabase authentication
  return await updateSession(request);
}

// Configure which routes the middleware should run on
export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * Feel free to modify this pattern to include more paths.
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
