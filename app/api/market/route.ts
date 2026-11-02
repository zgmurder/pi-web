import { NextResponse } from "next/server";
import { readLocalMarket } from "@/lib/local-market";
import { readSkillHubMarket, skillHubConfigured } from "@/lib/skill-hub-market";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    if (new URL(req.url).searchParams.get("kind") === "skill" && skillHubConfigured(req)) {
      return NextResponse.json({ skills: await readSkillHubMarket(req), source: "skill-hub" });
    }
    return NextResponse.json(await readLocalMarket());
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error),
        ...(new URL(req.url).searchParams.get("kind") === "skill" && skillHubConfigured(req) ? { source: "skill-hub" } : {}) },
      { status: 500 },
    );
  }
}
