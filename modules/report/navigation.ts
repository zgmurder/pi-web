export const workspaceItems = [
  { id: "chat", href: "/", label: "workspaceNav.chat" },
  { id: "analysis", href: "/report/analysis", label: "workspaceNav.analysis" },
  { id: "warnings", href: "/report/warnings", label: "workspaceNav.warnings" },
  { id: "tagging", href: "/report/tagging", label: "workspaceNav.tagging" },
  { id: "police", href: "/report/police", label: "workspaceNav.search" },
  { id: "police-stats", href: "/report/police-stats", label: "workspaceNav.statistics" },
  { id: "dashboard", href: "/report/dashboard", label: "workspaceNav.dashboard" },
] as const;

export type BusinessModule = Exclude<(typeof workspaceItems)[number]["id"], "chat">;

export function isWorkspaceItemActive(pathname: string, href: string): boolean {
  return pathname === href || (href !== "/" && pathname.startsWith(`${href}/`));
}
