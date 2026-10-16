import { NextResponse } from "next/server";
import { readLocalMarket } from "@/lib/local-market";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json(await readLocalMarket());
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
