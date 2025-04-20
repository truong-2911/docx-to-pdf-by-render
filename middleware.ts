import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export function middleware(request: NextRequest) {
  // Check if the request is for an API route
  if (request.nextUrl.pathname.startsWith("/api/")) {
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

  return NextResponse.next();
}

// Configure which routes the middleware should run on
export const config = {
  matcher: "/api/:path*",
};
