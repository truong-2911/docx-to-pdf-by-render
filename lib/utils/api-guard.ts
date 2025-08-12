import { NextRequest, NextResponse } from "next/server";

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS,PATCH",
  "Access-Control-Allow-Headers":
    "Content-Type, x-api-key, x-vercel-protection-bypass, X-Conversation-State, x-conversation-state",
  "Access-Control-Expose-Headers": "X-Conversation-State",
} as const;

export function okJSON(status: number, body: any) {
  return new NextResponse(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

export function okPDF(stream: ReadableStream, filename: string) {
  return new NextResponse(stream, {
    status: 200,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}.pdf"`,
    },
  });
}

export function handlePreflight(req: NextRequest) {
  if (req.method === "OPTIONS") {
    return new NextResponse(null, { status: 204, headers: corsHeaders });
  }
  return null;
}

export function checkApiKey(req: NextRequest) {
  const apiKey =
    req.headers.get("x-api-key") ||
    new URL(req.url).searchParams.get("x-api-key");
  const expected = process.env.ZC_SECRET;
  if (!expected || apiKey !== expected) return false;
  return true;
}
