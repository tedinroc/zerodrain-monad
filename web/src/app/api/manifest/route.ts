import { NextRequest, NextResponse } from "next/server";
import { buildManifestPayload } from "@/lib/manifest";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const hijacked = req.nextUrl.searchParams.get("hijacked") === "1";
  return NextResponse.json(buildManifestPayload(hijacked));
}
