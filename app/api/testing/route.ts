import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({
    message: "Connection successful!",
    timestamp: new Date().toISOString(),
  });
}
