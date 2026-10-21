import { NextResponse } from "next/server";
import { getBrowseStartDirectory } from "@/lib/directory-browser";

export async function GET() {
  return NextResponse.json({ home: getBrowseStartDirectory() });
}
