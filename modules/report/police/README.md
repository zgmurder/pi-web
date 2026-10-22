# 警情查询 / 110 统计 React 移植

来源：`report/frontend/src/views/PoliceQueryView.vue`、`Police110StatsView.vue`，以及原 `api/police.ts`、`utils/datetime.ts`、`utils/privacyMask.ts`。只依赖已有 React、Next 和共享 `modules/report/api/client.ts`；不含 Vue、iframe、新依赖或模拟业务数据。

## 覆盖范围

- 查询：接警 / 反馈 / 标签三页签，原字段顺序与 480px 左侧筛选面板；完整接警/反馈码表、辖区默认值、部门、街道、社区字典；七级标签父子选择、后代清空、OR 请求口径；快捷时间、条件标签、列选择、20/50/100 条分页、当前页/全部 Excel 导出（上限 10000）、后端 notes、详情抽屉。
- 统计：接警 / 反馈页签切换自动请求；单位、时间、全部包含/排除开关；接警多选分类级联、反馈/部位分类级联；同比/环比、市级/县级1/县级2、Excel；合计、指标表、动态维度列，以及每单位本期+基期数值+比率的多行比较表。
- `/auth/me` 的根部门码用于查询默认区划；部门选项仅来自原 `/departments/tree`。身份加载失败不自动全量查询。业务范围仍由 Report 后端每个请求校验，客户端不替代权限边界。
- 保留原 `sensitive` 脱敏口径；详情地址也脱敏（原 Vue 详情地址未调用遮罩，是有意收紧）。正则消除 lookbehind 以兼容 Safari 16.2。
- 新查询响应有请求序号保护，重置/卸载后旧请求不覆盖当前结果。字典部分失败显示提示。原先“本周/本月”快捷只取首日的行为保留并有测试，未自行改业务口径。

## 验证

已有依赖即可，无新增安装步骤。不要运行 `next build` 或重启开发服务器。

```bash
node --experimental-strip-types --test modules/report/police/model.test.mjs
node_modules/.bin/eslint modules/report/police app/report/police/page.tsx app/report/police-stats/page.tsx
node_modules/.bin/tsc --noEmit

# 对现有开发服务的只读 UI 检查；storageState 含敏感 Cookie，不得提交
REPORT_TEST_URL=http://127.0.0.1:30142 \
REPORT_TEST_STORAGE_STATE=/private/report-state.json \
node modules/report/police/smoke.e2e.mjs
# 若复用已启动的 Chromium，可加 REPORT_TEST_CDP=http://127.0.0.1:9333
```

预期：7 项单测通过；lint / tsc 无本模块错误；浏览器脚本输出两行 PASS。浏览器脚本不模拟接口，不主动导出、不修改后端数据；查询页自身按原行为自动查询。

本次已在现有服务上验证：查询与各字典 HTTP 200、真实查询 20 行、详情打开/Escape 关闭、同比+环比统计 HTTP 200 且呈现 190 个表格行；三页签、列选择、统计重置、390px 窄屏无文档横向溢出、无 pageerror。

## 已知差异 / 尚未验证

- 日期/时间使用浏览器原生控件，而非 Naive UI 日历弹层；下拉为可搜索的 React 控件，不完全复刻 Naive 的虚拟列表、键盘方向键模型和多选胶囊。按钮、表格、间距沿用原布局，业务区域、抽屉及原生日期控件继承 Pi Web 当前主题；实心按钮使用主题的强调色对比文字，不宣称像素级 1:1。
- 列提示用浏览器 title，不是原 360px 富提示；分页是上一页/页码输入/下一页，不是 Naive 数字按钮组。显示字段浮层为原生 details。
- 警情表表头/固定列、统计比较表均已实现；尚无长列表性能与真机 Safari 验证。
- 统计返回结果标题绑定返回的 source/level，避免切换筛选失败时旧结果被新标题误标；原页面绑定实时表单。原空数据说明判断实际永远包含 total_row，现改为无明细行时提示。
- 共享 downloadReport 使用调用者固定文件名（警情查询.xlsx / 警情统计.xlsx）；未保留原 Content-Disposition 文件名。未实际下载全部 10000 条或核对导出文件内容。
- 已测试级联纯逻辑，但未对每一个真实字典组合、反馈结果、标签查询结果、维度分组结果逐一比对原站；也未用低权限真实账户完成数据范围验收。
