import type { ReactNode } from "react";

// Lucide (ISC) stroke geometry, kept local because lucide-react is not installed.
export function WarningIcon({ name, size = 18 }: { name: string; size?: number }) {
  let shape: ReactNode;
  switch (name) {
    case "type3dayRise": shape = <path d="M12 3c1 4 5 5 5 9a5 5 0 0 1-10 0c0-2 1-4 3-6 0 3 1 4 2 4 2-2 1-5 0-7Z" />; break;
    case "stationDailyHb30": case "station_alarm": case "station": shape = <><rect x="4" y="2" width="16" height="20" rx="2" /><path d="M9 22v-4h6v4M8 6h.01M16 6h.01M12 6h.01M12 10h.01M12 14h.01M16 10h.01M16 14h.01M8 10h.01M8 14h.01" /></>; break;
    case "stationWeeklyHb30": case "stationMonthlyHb30": case "stationMonthlyTb30": shape = <><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" />{name === "stationWeeklyHb30" ? <path d="M8 15h8" /> : name === "stationMonthlyTb30" ? <path d="M12 13v4l3 1" /> : <path d="M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01M16 18h.01" />}</>; break;
    case "repeatPerson90d": shape = <><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" /><circle cx="9" cy="7" r="4" /></>; break;
    case "community_alarm": shape = <><path d="M20 10c0 5-8 12-8 12S4 15 4 10a8 8 0 1 1 16 0Z" /><circle cx="12" cy="10" r="3" /></>; break;
    case "search": shape = <><circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" /></>; break;
    case "reset": shape = <><path d="M3 11a9 9 0 1 1 2.64 6.36M3 3v8h8" /></>; break;
    case "close": shape = <path d="m18 6-12 12M6 6l12 12" />; break;
    default: shape = <path d="m22 7-8.5 8.5-5-5L2 17M16 7h6v6" />;
  }
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{shape}</svg>;
}
export function ruleIconName(rule?: { ruleKey: string; kind: string } | null) {
  if (!rule) return "trend";
  return ["type3dayRise", "type2weekRise", "stationDailyHb30", "stationWeeklyHb30", "stationMonthlyHb30", "stationMonthlyTb30", "repeatPerson90d"].includes(rule.ruleKey) ? rule.ruleKey : rule.kind === "community_alarm" ? "community_alarm" : "station";
}
