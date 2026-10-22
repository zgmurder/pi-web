# 研判包与警情打标 React 移植

范围仅为 `modules/report/tags/**`、`app/report/analysis/page.tsx`、`app/report/tagging/page.tsx`；不改变外层导航、对话和认证组件，无 Vue / iframe / 新依赖 / 业务模拟数据。

参考原文件（已完整阅读）：

- `report/frontend/src/views/TagWorkbenchView.vue`
- `report/frontend/src/views/AlarmTaggingV2View.vue`
- `report/frontend/src/components/tag/AlarmV2DetailPanel.vue`
- `api/tagV2.ts`、`api/feedbackCategory.ts`、`api/reportSearch.ts`、`api/department.ts`
- `utils/privacyMask.ts`、`utils/deptTree.ts`、`utils/reportDateRange.ts`
- 原 auth/user store、request/envelope/authSession、report store/API

## 接入

通过其他 worker 提供的 `../api/client.ts` 调用相同源业务代理，使用现有 HttpOnly 会话，不读写原 Vue JWT localStorage。

- `/auth/me`、`/departments/tree`：部门树、账号默认范围；缺少非市局账号部门码时停止检索。失败不回退无范围查询。后端授权仍是最终边界。
- `/tags/packages`：组合查询、新增、修改、删除（注意原接口不是 `/tags-v2/packages`）。
- `/tags-v2/catalog`、`/tags-v2/search`、`/tags-v2/alarms/:fkdbh`、`/tags-v2/alarms/verify`。
- `/tags-v2/export`：POST XLSX，全部警情/人员/选中警情；默认上限保留原值 20000。
- `/components/feedback-category-tree`；失败时使用 `/report-search/classifications?source=fkd_fkd&level=...` 三个真实字典请求。
- 保留 `/tags-v2/stats` API adapter；原两页未显示独立统计图，研判包显示 search 返回的命中、人员、单位统计。

组合支持单个 all/any 与多组 all/any（组内 AND），保存权威 `condition` 和兼容 `logic`，读取 legacy JSON。详情标签临时检索使用单标签 AND，避免原分组 JSON 意外覆盖点击的单标签；关闭后恢复组合。

警情打标支持报告缓存日期、最新数据日默认值、无交集时自动切换数据范围；三级标签级联、关键词/单号/人工来源筛选、核对展开、编辑标签与快捷 OK。查询分页处理非精确总数。列表和详情都保留敏感行脱敏，列表人员名比原 Vue 更严格，同样脱敏。

## 尚未达到的 1:1 与集成边界

1. **专项报告编辑器未接入**：入口明确禁用并显示“待接入”，没有创建报告或假装生成成功。原流程是 POST `/reports`，payload `report_type: '专项报告'`、`source_query: { source_type: 'tag_package_special', schema_version: 1, tag_package_id, filters: { window_start, window_end, dept_code, dept_name, ajlb_codes, ajlx_codes, ajxl_codes } }`，然后跳 `/home/editor/:id?autoGenerate=source`。需要其他任务移植编辑器/自动生成消费流程、获准代理报告接口，再启用此按钮。当前没有有效同源目标，故未制造失效链接，也不会泄露 HttpOnly token 到原系统。
2. 原 Naive UI 日期范围、树选择、多选、tooltip、dropdown 使用无新增依赖的 React / 原生控件代替；部门树以缩进选项加搜索显示，不能展开折叠树节点；时间选择是两个原生 datetime-local。原 feedback 三类字典本来是扁平、独立多选，保留该行为，不根据 fallback 构造虚假父子级联。
3. 已按原三栏/两卡/组合编辑双栏、宽度、间距、可拖详情面板、响应式布局移植 CSS module；颜色继承 Pi Web 当前主题，包含 Portal 下拉菜单和编辑弹窗，但未做真实浏览器截图与原页逐像素比对，不声称像素级一致。
4. 原 `NVirtualList` 标签库目前为滚动列表而非虚拟列表；超大标签库性能仍需真实数据验证。多选标签的 hover 提示为原生 title，不是 Naive 浮层。
5. 集成阶段使用已有登录态验证了真实组合/标签库加载、编辑器搜索与取消、筛选面板展开和窄屏无溢出。未验收真实后端写入、下载文件内容、完整键盘/屏幕阅读器交互；未运行 next build。

## 验证

```bash
node --experimental-strip-types --test modules/report/tags/logic.test.mjs
# 五页主题、弹窗、下拉与窄屏只读验收；登录态文件须放 Git 之外
PI_WEB_TEST_URL=http://127.0.0.1:30142 PI_WEB_TEST_STORAGE_STATE=<私密登录态文件> node modules/report/theme.e2e.mjs
node_modules/.bin/eslint modules/report/tags app/report/analysis/page.tsx app/report/tagging/page.tsx
node_modules/.bin/tsc --noEmit
```

预期：8 个纯逻辑测试通过，局部 ESLint 无错误/警告，TypeScript 无错误。覆盖条件编码/恢复、级联、日期半开区间、核对块顺序、敏感字段遮罩及部门范围。脱敏正则去掉 lookbehind，兼容本项目 Safari 16.2 语法要求。

交付后由主任务统一审阅并提交 GitHub；本 worker 未提交 Git。建议 commit：`feat(report): port tag workbench and alarm verification pages`。
