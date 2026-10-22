import { authStatus, login, logout } from "@/modules/report/auth/server";

export const dynamic = "force-dynamic";
export const GET = authStatus;
export const POST = login;
export const DELETE = logout;
