import type { MetadataRoute } from "next";

export const dynamic = "force-dynamic";

export default function manifest(): MetadataRoute.Manifest {
  const appName = process.env.PI_WEB_APP_NAME?.trim() || "警情分析助手";
  return {
    id: "/",
    name: appName,
    short_name: appName,
    description: "Local web interface for the pi coding agent",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#1a1a1a",
    categories: ["developer", "productivity"],
    lang: "en",
    icons: [],
  };
}
