"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getWarningDepartments, getWarningOptions, getWarningUser, listWarningRules, listWarnings } from "./api";
import { buildWarningQuery, departmentScope, emptyFilters, pageNumbers, rowKey } from "./model";
import type { DepartmentScope, WarningBjlxOption, WarningFilters, WarningRow, WarningRuleMeta } from "./types";
import { DepartmentSelect } from "./DepartmentSelect";
import { WarningDetail } from "./WarningDetail";
import { WarningTable } from "./WarningTable";
import { ruleIconName, WarningIcon } from "./WarningIcon";
import styles from "./warnings.module.css";

const EMPTY_SCOPE: DepartmentScope = { options: [], tree: [], defaultKey: "", isCityBureau: false };
interface SearchRequest { rule: WarningRuleMeta; filters: WarningFilters; page: number; size: number; revision: number }
interface Results { request: SearchRequest | null; rows: WarningRow[]; total: number; error: string }

function AlarmTypeSelect({ options, value, onChange }: { options: WarningBjlxOption[]; value: string; onChange: (value: string) => void }) {
  const [search, setSearch] = useState("");
  const details = useRef<HTMLDetailsElement>(null);
  const selected = options.find((item) => item.code === value);
  const label = (item: WarningBjlxOption) => item.name ? `${item.name}（代码${item.code}）` : `类型${item.code}`;
  const select = (code: string) => { onChange(code); setSearch(""); if (details.current) { details.current.open = false; details.current.querySelector("summary")?.focus(); } };
  return <details ref={details} className={styles.alarmSelect} onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget) && details.current) details.current.open = false; }} onKeyDown={(event) => { if (event.key === "Escape" && details.current?.open) { event.preventDefault(); details.current.open = false; details.current.querySelector("summary")?.focus(); } }}>
    <summary aria-label="报警类型">{selected ? label(selected) : "报警类型"}</summary>
    <div className={styles.deptPopup}>
      <input type="search" aria-label="搜索报警类型" placeholder="搜索报警类型" value={search} onChange={(event) => setSearch(event.target.value)} />
      <button type="button" className={styles.deptOption} onClick={() => select("")}>全部类型</button>
      {options.filter((item) => label(item).toLowerCase().includes(search.trim().toLowerCase())).map((item) => <button key={item.code} type="button" aria-pressed={value === item.code} className={styles.deptOption} onClick={() => select(item.code)}>{label(item)}</button>)}
    </div>
  </details>;
}

export default function WarningWorkbench() {
  const [rules, setRules] = useState<WarningRuleMeta[]>([]);
  const [options, setOptions] = useState<WarningBjlxOption[]>([]);
  const [scope, setScope] = useState<DepartmentScope>(EMPTY_SCOPE);
  const [filters, setFilters] = useState<WarningFilters>(() => emptyFilters());
  const [request, setRequest] = useState<SearchRequest | null>(null);
  const [results, setResults] = useState<Results>({ request: null, rows: [], total: 0, error: "" });
  const [initializing, setInitializing] = useState(true);
  const [initialError, setInitialError] = useState("");
  const [validationError, setValidationError] = useState("");
  const [reload, setReload] = useState(0);
  const [detail, setDetail] = useState<WarningRow | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const autoOpen = useRef(false);
  const activeRule = request?.rule || null;
  const kind = activeRule?.kind || "type_rise";
  const loading = initializing || Boolean(request && results.request !== request);
  const sameRule = results.request?.rule.ruleKey === request?.rule.ruleKey;
  const rows = sameRule ? results.rows : [];
  const total = sameRule ? results.total : 0;
  const page = request?.page || 1;
  const size = request?.size || 20;
  const pages = Math.max(1, Math.ceil(total / size));
  const error = [...new Set([initialError, validationError, results.request === request ? results.error : ""].filter(Boolean))].join("；");

  useEffect(() => {
    const controller = new AbortController();
    const initialize = async () => {
      setInitializing(true);
      setInitialError("");
      setValidationError("");
      const query = new URLSearchParams(window.location.search);
      autoOpen.current = query.get("autoOpen") === "1";
      try {
        // Resolve account scope before the first station request (the Vue view races these).
        const [metadata, department] = await Promise.allSettled([
          Promise.all([listWarningRules(controller.signal), getWarningOptions(controller.signal)]),
          Promise.all([getWarningUser(controller.signal), getWarningDepartments(controller.signal)]),
        ]);
        if (controller.signal.aborted) return;
        if (metadata.status === "rejected") throw metadata.reason;
        const [loadedRules, loadedOptions] = metadata.value;
        const available = Array.isArray(loadedRules) ? loadedRules : [];
        setRules(available);
        setOptions(loadedOptions?.bjlxOptions || []);
        let nextScope = EMPTY_SCOPE;
        if (department.status === "fulfilled") nextScope = departmentScope(department.value[1], department.value[0]);
        else setInitialError(department.reason instanceof Error ? department.reason.message : "部门列表加载失败");
        setScope(nextScope);
        const nextFilters = { ...emptyFilters(nextScope.defaultKey), beginDate: query.get("beginDate") || "", endDate: query.get("endDate") || "" };
        setFilters(nextFilters);
        const rule = available.find((item) => item.ruleKey === query.get("ruleKey")) || available.find((item) => item.ruleKey === "type3dayRise") || available[0];
        setDetail(null);
        setDetailOpen(false);
        setRequest(rule ? { rule, filters: nextFilters, page: 1, size: 20, revision: 0 } : null);
      } catch (cause) {
        if (!controller.signal.aborted) { setInitialError(cause instanceof Error ? cause.message : "预警模型加载失败"); setRules([]); setRequest(null); }
      } finally {
        if (!controller.signal.aborted) setInitializing(false);
      }
    };
    void initialize();
    return () => controller.abort();
  }, [reload]);

  useEffect(() => {
    const navigate = () => setReload((value) => value + 1);
    window.addEventListener("popstate", navigate);
    return () => window.removeEventListener("popstate", navigate);
  }, []);

  useEffect(() => {
    if (!request || initializing) return;
    const controller = new AbortController();
    const search = async () => {
      try {
        const query = buildWarningQuery(request.rule.ruleKey, request.rule.kind, request.filters, request.page, request.size, scope);
        const data = await listWarnings(query, controller.signal);
        if (controller.signal.aborted) return;
        const found = data?.rows || [];
        setResults({ request, rows: found, total: data?.total || 0, error: "" });
        if (autoOpen.current && found.length) {
          setDetail(found[0]); setDetailOpen(true); autoOpen.current = false;
          const url = new URL(window.location.href);
          url.searchParams.delete("autoOpen"); url.searchParams.delete("t");
          window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
        }
      } catch (cause) {
        if (!controller.signal.aborted) setResults({ request, rows: [], total: 0, error: cause instanceof Error ? cause.message : "预警查询失败" });
      }
    };
    void search();
    return () => controller.abort();
  }, [request, scope, initializing]);

  const update = (key: keyof WarningFilters, value: string) => setFilters((previous) => ({ ...previous, [key]: value }));
  const search = (nextFilters = filters, nextPage = 1, nextSize = size, nextRule = activeRule) => {
    if (!nextRule) return;
    try {
      buildWarningQuery(nextRule.ruleKey, nextRule.kind, nextFilters, nextPage, nextSize, scope);
      setValidationError("");
      setRequest((previous) => ({ rule: nextRule, filters: { ...nextFilters }, page: nextPage, size: nextSize, revision: (previous?.revision || 0) + 1 }));
    } catch (cause) { setValidationError(cause instanceof Error ? cause.message : "查询条件无效"); }
  };
  const switchRule = (rule: WarningRuleMeta) => {
    if (rule.ruleKey === activeRule?.ruleKey) return;
    const next = emptyFilters(scope.defaultKey);
    setFilters(next); setDetail(null); setDetailOpen(false); setValidationError(""); autoOpen.current = false;
    // Keep the chosen model visible even when department scope is unavailable.
    setRequest((previous) => ({ rule, filters: next, page: 1, size, revision: (previous?.revision || 0) + 1 }));
  };
  const openDetail = (row: WarningRow) => { setDetail(row); setDetailOpen(true); };
  const closeDetail = useCallback(() => setDetailOpen(false), []);
  const rangeText = total ? `${(page - 1) * size + 1}-${Math.min(page * size, total)} / ${total} 条` : "0 条";
  const pagination = pageNumbers(page, pages);

  return <section className={styles.workbench} aria-label="预警工作台">
    <aside className={`${styles.card} ${styles.rulesCard}`} aria-label="预警模型">
      <header className={styles.cardHeader}><h1>预警模型 <span className={styles.muted}>（{rules.length} 类）</span></h1><span className={styles.accent}><WarningIcon name="trend" /></span></header>
      <div className={styles.ruleList} aria-busy={initializing}>
        {rules.map((rule) => <button type="button" key={rule.ruleKey} className={`${styles.ruleItem} ${activeRule?.ruleKey === rule.ruleKey ? styles.activeRule : ""}`} aria-pressed={activeRule?.ruleKey === rule.ruleKey} onClick={() => switchRule(rule)} disabled={initializing}>
          <span className={styles.ruleHeading}><span className={styles.ruleIcon}><WarningIcon name={ruleIconName(rule)} size={16} /></span><span className={styles.ruleName} title={rule.label}>{rule.label}</span><span className={styles.ruleCount}>{rule.total}</span></span>
          <span className={styles.ruleDescription}>{rule.description}</span>
        </button>)}
        {!rules.length && <div className={styles.empty}>{initializing ? "加载预警模型…" : "暂无预警模型"}</div>}
      </div>
    </aside>
    <div className={styles.main}>
      {error && <div className={styles.error} role="alert"><span>{error}</span>{initialError && <button type="button" disabled={initializing} onClick={() => setReload((value) => value + 1)}>重新加载</button>}</div>}
      <section className={`${styles.card} ${styles.filterCard}`} aria-label="预警筛选">
        <div className={styles.filterHeading}><div className={styles.activeHeading}><span className={styles.accent}><WarningIcon name={ruleIconName(activeRule)} /></span><div><h2>{activeRule?.label || "预警"}</h2><p title={activeRule?.description}>{activeRule?.description || ""}</p></div></div><div className={styles.hitBadge}>模型命中 <b>{activeRule?.total ?? "-"}</b></div></div>
        <form className={styles.filters} onSubmit={(event) => { event.preventDefault(); search(); }}>
          {kind === "station" ? <><DepartmentSelect key={`${scope.defaultKey}-${scope.options.length}`} scope={scope} value={filters.deptKey} disabled={initializing} onChange={(value) => update("deptKey", value)} /><input type="search" aria-label="派出所名称或代码" placeholder="派出所名称 / 代码" value={filters.keyword} onChange={(event) => update("keyword", event.target.value)} /></> : kind === "type_rise" ? <AlarmTypeSelect options={options} value={filters.bjlxdm} onChange={(value) => update("bjlxdm", value)} /> : kind === "station_alarm" || kind === "community_alarm" ? <input type="search" className={styles.areaInput} aria-label="区域、代码或警情类型" placeholder="区域 / 代码 / 警情类型" value={filters.keyword} onChange={(event) => update("keyword", event.target.value)} /> : <>
            <input type="search" aria-label="姓名或联系电话" placeholder="姓名 / 联系电话" value={filters.keyword} onChange={(event) => update("keyword", event.target.value)} />
            <input type="search" className={styles.deptNameInput} aria-label="涉及派出所" placeholder="涉及派出所" value={filters.deptName} onChange={(event) => update("deptName", event.target.value)} />
            <input className={styles.countInput} type="number" min={1} step={1} aria-label="最少报警次数" placeholder="最少报警次数" value={filters.minTotalCnt} onChange={(event) => update("minTotalCnt", event.target.value)} />
          </>}
          <div className={styles.dateRange}><input type="date" aria-label={kind === "person" ? "活跃开始" : "日期起"} title={kind === "person" ? "活跃开始" : "日期起"} value={filters.beginDate} max={filters.endDate || undefined} onChange={(event) => update("beginDate", event.target.value)} /><span aria-hidden="true">—</span><input type="date" aria-label={kind === "person" ? "活跃结束" : "日期止"} title={kind === "person" ? "活跃结束" : "日期止"} value={filters.endDate} min={filters.beginDate || undefined} onChange={(event) => update("endDate", event.target.value)} />{(filters.beginDate || filters.endDate) && <button type="button" className={styles.clearDates} aria-label="清空日期范围" onClick={() => setFilters((previous) => ({ ...previous, beginDate: "", endDate: "" }))}><WarningIcon name="close" size={12} /></button>}</div>
          <button type="submit" className={styles.primaryButton} disabled={loading || !activeRule}>{loading ? <span className={styles.spinner} /> : <WarningIcon name="search" size={16} />}查询</button>
          <button type="button" className={styles.secondaryButton} disabled={loading || !activeRule} onClick={() => { const next = emptyFilters(scope.defaultKey); setFilters(next); search(next); }}><WarningIcon name="reset" size={16} />重置</button>
        </form>
      </section>
      <section className={`${styles.card} ${styles.tableCard}`} aria-label="预警列表">
        <header className={`${styles.cardHeader} ${styles.paginationHeader}`}>
          <div className={styles.paginationLeft}><span className={styles.range} aria-live="polite">{rangeText}</span>
            <nav className={styles.pagination} aria-label="预警分页">
              <button type="button" aria-label="上一页" disabled={loading || page <= 1} onClick={() => search(filters, page - 1)}>‹</button>
              {pagination.map((number, index) => <span className={styles.pageItem} key={number}>{index > 0 && number - pagination[index - 1] > 1 && <span className={styles.pageEllipsis}>…</span>}<button type="button" aria-label={`第 ${number} 页`} aria-current={page === number ? "page" : undefined} disabled={loading} onClick={() => { if (number !== page) search(filters, number); }}>{number}</button></span>)}
              <button type="button" aria-label="下一页" disabled={loading || page >= pages} onClick={() => search(filters, page + 1)}>›</button>
              <select aria-label="每页条数" value={size} disabled={loading} onChange={(event) => search(filters, 1, Number(event.target.value))}>{[10, 20, 50, 100].map((count) => <option key={count} value={count}>{count} 条/页</option>)}</select>
            </nav>
          </div><span className={styles.range}>命中 <b>{total.toLocaleString()}</b></span>
        </header>
        <WarningTable rows={rows} ruleKey={activeRule?.ruleKey || "type3dayRise"} kind={kind} selectedKey={detail && activeRule ? rowKey(detail, activeRule.ruleKey) : ""} loading={loading} onSelect={openDetail} />
      </section>
    </div>
    {detailOpen && detail && activeRule && <WarningDetail row={detail} rule={activeRule} onClose={closeDetail} />}
  </section>;
}
