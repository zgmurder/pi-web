# Report 预警工作台迁移

来源：`report/frontend/src/views/WarningWorkbenchView.vue`、`api/warning.ts`、`stores/auth.ts`、`utils/deptTree.ts`。仅使用现有 React / Next.js 和 `modules/report/api/client.ts`，不安装依赖、不读取浏览器 Token、不修改外层导航或聊天。

## 已实现

- `/warnings/rules` 服务端模型列表、模型类别数、各模型命中数、图标、描述、切换后的筛选与分页重置。
- `/warnings/options` 可搜索报警类型选项。
- `/warnings/list` 原始查询参数及返回结构；五类模型的动态筛选和表格列、缺失值/零值、环比/同比、20 条默认分页以及 10/20/50/100 条页大小。
- `/auth/me` + `/departments/tree` 部门范围、可搜索/展开部门树、非市局默认本部门、市局可清空。
- `ruleKey`、`beginDate` URL 初始化，`autoOpen=1` 首行详情和成功后清理 `autoOpen`/`t`；额外支持 `endDate` 和浏览器历史导航。
- 560px 右侧详情抽屉、全部原字段、原版 CSS 数量对照条（原页本身未使用图表库）、重复报警人的涉及派出所标签。
- 行选中态、表格滚动、加载/空态/失败重试、取消过时请求。详情使用原生模态 dialog，支持 Escape、焦点约束及关闭后焦点恢复。
- 后端返回的姓名/电话原样展示，包括已脱敏值；与原页一致，不进行额外反查或解掩码。

## 有意收紧的部门行为

先加载当前身份和部门树，再执行首个列表查询，避免原 Vue 页面并发加载导致第一条派出所请求缺少部门条件。非市局身份找不到对应部门时不开放全部部门，派出所查询明确报错；其余类别仍由服务端按身份强制限定数据权限。客户端筛选不能替代服务端鉴权。

## 验证

在仓库根目录：

```bash
node --experimental-strip-types --test modules/report/warnings/model.test.mjs
node_modules/.bin/tsc --noEmit --incremental false
node_modules/.bin/eslint modules/report/warnings app/report/warnings/page.tsx
```

预期：8 项测试通过，后两条无错误输出。测试覆盖部门范围/未知账号拒绝、各类查询参数、日期校验、空值与零值、同比上一年数据、动态辖区趋势、脱敏值保留及分页边界。测试中仅有逻辑输入样例，页面没有模拟业务数据。

真实接口浏览器验收需要已登录的 Report 账号，复用现有开发服务访问 `/report/warnings`；集成阶段已在 30142 使用已有登录态验证真实列表与详情、Escape 关闭及窄屏，并进行截图对照；未执行 `next build`。

## 尚不能声称完全 1:1 的部分

- Naive UI 控件改为 React/HTML 控件：日期为两个原生日期输入而非双月历弹层；数字输入使用浏览器步进器；分页按钮的展开/省略规则和下拉菜单边距可能不同。
- 部门树和报警类型选择具备搜索、清空（市局）、展开及键盘 Tab/Enter 操作，但不完全复刻 Naive UI 树选择器的方向键行为。
- 表格截断文本使用原生 `title` 提示，不是 Naive UI 浮层；背景、文字、强调色和选中态继承 Pi Web 当前主题，详情抽屉及趋势条同步变化；增长红保留语义色。
- 原页没有导出按钮，`api/warning.ts` 也没有导出契约；此迁移不虚构预警导出接口。
- 尚未进行低权限账号权限测试、逐像素验收、iOS 实机检查。
