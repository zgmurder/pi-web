import { apiGet } from "@/modules/report/api/client";
import type { DepartmentItem, WarningListPage, WarningListQuery, WarningOptions, WarningRuleMeta, WarningUser } from "./types";

export const listWarningRules = (signal?: AbortSignal) => apiGet<WarningRuleMeta[]>("/warnings/rules", undefined, { signal });
export const getWarningOptions = (signal?: AbortSignal) => apiGet<WarningOptions>("/warnings/options", undefined, { signal });
export const listWarnings = (query: WarningListQuery, signal?: AbortSignal) => apiGet<WarningListPage>("/warnings/list", { ...query }, { signal });
export const getWarningUser = (signal?: AbortSignal) => apiGet<WarningUser>("/auth/me", undefined, { signal });
export const getWarningDepartments = (signal?: AbortSignal) => apiGet<DepartmentItem[]>("/departments/tree", undefined, { signal });
