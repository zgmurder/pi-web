import { NextResponse } from "next/server";
import { mkdirSync } from "fs";
import { defaultCwdPath } from "@/lib/default-cwd";
import { assertInstancePath, InstancePathError } from "@/lib/instance-root";

// POST /api/default-cwd
// Creates the daily workspace inside the instance (~/pi-cwd in development).
// The client then selects it through /api/cwd/validate like any other directory.
export async function POST() {
  try {
    const dir = defaultCwdPath();
    assertInstancePath(dir, true);
    mkdirSync(dir, { recursive: true });
    assertInstancePath(dir);
    return NextResponse.json({ cwd: dir });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: error instanceof InstancePathError ? 403 : 500 });
  }
}
