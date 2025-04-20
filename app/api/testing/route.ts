import { NextResponse } from "next/server";

export async function GET() {
  console.log(`[${process.env.ENV?.toUpperCase()}] Testing API`);
  return NextResponse.json({
    message: "Connection successful!",
    timestamp: new Date().toISOString(),
  });
}
