# Report 业务前端与整站登录

使用 Pi Web 已有的 Next.js / React，无 Vue、iframe、新依赖或模拟业务数据。

## 路由

| 路由 | 内容 |
| --- | --- |
| `/login` | Report 用户名、密码登录（简体中文） |
| `/` | 原对话功能，保留原工具栏 |
| `/report/analysis` | 研判占位页 |
| `/report/warnings` | 预警占位页 |
| `/report/tagging` | 打标占位页 |
| `/report/police` | 警情查询占位页 |
| `/report/police-stats` | 警情统计占位页 |
| `/report/dashboard` | 大屏占位页 |

导航顺序为对话、研判、预警、打标、查询、统计、大屏（页面标题保留警情查询、警情统计）；窄屏下导航栏可横向滚动，页面本身不横向溢出。

`app/report/**` 只负责挂载。导航、样式、登录与业务页面在本目录；后续业务 API 应在本目录实现，不依赖 Pi 的 AgentSession、会话存储或 SDK 私有接口。

## 与 Pi Web 的接入点

- `app/page.tsx`：包裹 `WorkspaceLayout`，不移动原首页或全局布局。
- `components/AppShell.tsx`：内容高度读取可选 CSS 变量；离开首页时停放新对话草稿，返回时恢复。已有会话沿用 Pi Web 的标签页记忆。
- `proxy.ts`：整站调用 `auth/server.ts` 校验 Report 身份，登录重定向保留目标路径。
- `app/login/page.tsx`、`app/api/web-auth/route.ts`：挂载本模块登录页与认证处理，兼容原设置页退出入口。
- `lib/i18n/messages/{en,zh-CN,zh-TW}.ts`：`workspaceNav.*` 文案。
- `package.json`：默认单测包含 `modules/**/*.test.mjs`。

CSS module 使用现有主题变量；手机抽屉和文件面板的高度/顶部偏移仅在本布局内覆盖。合并上游时检查上述接入点及 `.sidebar-container` / `.right-panel-container` 类名；不能保证完全无合并冲突。

## 业务配置

顶部齿轮提供数据源和业务系统配置，复用现有数据源面板与 DrissionPage 浏览器能力。安装、环境变量、登录定位、对话使用及凭据边界见 [settings/README.md](settings/README.md)。`app/api/report/systems/route.ts` 为薄 API，`lib/rpc-manager.ts` 仅增加业务工具扩展注册；不改变会话存储或 SSE 协议。

## 登录配置

同机部署默认连接 `http://127.0.0.1:8001`，可在 Pi Web 的 `.env.local`（不要提交）或启动环境中设置：

```dotenv
REPORT_API_URL=http://127.0.0.1:8001
```

填写源地址，不包含 `/api/v1`。生产修改环境变量后重启对应实例；Docker 内的 `127.0.0.1` 指向容器自身，分容器部署请使用 Report 服务名。

登录调用 `POST /api/v1/auth/login`，每个受保护请求调用 `GET /api/v1/auth/me`。Token 仅放在 HttpOnly 会话 Cookie，不返回浏览器 JS，不放 localStorage，不需要复制 Report JWT 密钥。HTTPS 自动设置 Secure；非本机访问应使用 HTTPS。Report 不可用时拒绝访问，不回退到免登录。

**此定制版本不再接受 `PI_WEB_PASSWORD`、旧登录 Cookie 或 API Basic Auth**，也不需要再输入原站点密码。已有 Basic 脚本/部署检查需要适配：先向 `/api/web-auth` 提交 Report 用户名、密码并保留 Cookie，再调用受保护 API；不要将账号密码放命令历史。原上游启动器和部署文档的密码说明不适用于此版本。

现阶段所有 Report 账号均视为可信操作员，共享 Pi 会话、文件、终端和工具；未做角色/部门隔离。退出仅清理当前浏览器 Cookie，不撤销 Report JWT、不停止运行中的 Agent 或已建立的流/终端。身份过期在后续请求被拒绝，页面在挂载、焦点恢复和每个可见分钟检查并跳转登录。用户停用同样由 `/auth/me` 检查。

每个请求远程校验身份会增加 Report 数据库负载；本阶段不增加缓存及刷新令牌机制，正式多用户上线前需要容量验证。

## 验证

优先复用已有健康开发服务，默认 `npm run dev` 使用 30141；不要为验证运行 `next build`。

```bash
node_modules/.bin/tsc --noEmit
node --experimental-strip-types --test app/api/web-auth/route.test.mjs lib/web-auth-proxy.test.mjs lib/request-security.test.mjs lib/login-destination.test.mjs modules/report/navigation.test.mjs lib/i18n/registry.test.mjs
# 无真实账号：登录表单与错误/跳转测试，成功响应为浏览器模拟，不调用真实登录接口
PI_WEB_TEST_URL=http://127.0.0.1:30142 PI_WEB_TEST_CHANNEL=chrome node modules/report/auth/login.e2e.mjs
# 导航回归需要事先导出的已登录 Playwright storageState（含敏感 Cookie，不得提交）
PI_WEB_TEST_STORAGE_STATE=/secure/path/report-state.json PI_WEB_TEST_URL=http://127.0.0.1:30142 PI_WEB_TEST_CHANNEL=chrome node modules/report/navigation.e2e.mjs
```

浏览器检查预期输出三行 `PASS`：独立路由与历史导航、未发送草稿恢复、窄屏布局与无 Agent 提示提交。测试不发送模型请求。

## 本阶段边界

- 业务页面只显示“功能待接入”；已接入 Report 登录，尚无业务数据 CRUD、角色或部门数据权限（配置管理除外）。
- 只对可信操作员开放；登录不是业务权限隔离。
- 切换业务路由会卸载对话 UI，沿用原来的流断开/返回重连机制，不新增后台常驻对话。业务页不显示对话的实时输出或完成声音。
- 草稿沿用内存存储，只保证同一标签页内客户端路由切换；刷新/关闭页面不保留。新对话的临时模型/推理选项、文件面板等非持久 UI 状态不在本阶段跨路由保留。
- 复用现有 Report 后端，不修改其代码。已验证健康检查与匿名 `/auth/me` 拒绝访问；未使用真实账号验证登录，也未验证真实业务接口、运行中 Agent 跨路由或真机软键盘表现。
