# 本机 Chrome 连接器

独立于 Report 的 Pi Web 功能：控制操作员**自己电脑的 Chrome**，不是服务器的 9333 浏览器。复用 MIT `pi-chrome` 0.15.58 的控制引擎，保留 `connector/LICENSE`；无新增 npm 依赖，不改 AgentSession、SSE 或会话文件格式。

## 使用

1. 打开 Pi Web → **设置 → 本机浏览器**，下载离线 ZIP。
2. 解压到固定目录，在 `chrome://extensions` 开启开发者模式，加载含 `manifest.json` 的目录。无需 Chrome 商店、Python、本地桥接程序或远程调试端口。
3. 回到 Pi Web，从工具栏扩展图标核对**协议、主机、端口**并信任站点，然后刷新网页。
4. 打开一个已保存的对话，在设置中点击连接，再从扩展图标核对会话 ID 并确认（两分钟有效）。无需手填地址、设备名或配对码。
5. 当前会话可使用 `local_browser`：状态、标签、页面快照、打开、点击、填写、按键、滚动。连接即授权该会话自动执行后续操作，不再逐次确认。密码、验证码、扫码、UKey 由用户人工处理。

首次安装不能由网页静默完成。下载不等于安装成功，配对不等于在线；在线表示最近两分钟收到设备请求，断网检测存在延迟。面板只在当前设置分类可见时轮询，切换会话重置状态；新会话不会继承设备，同一设备可显式连接多个会话。正常会话注册工具，纯聊天和子代理不注册；已运行的旧会话需重载或重启后使用新工具。

## 认证与兼容

- 站点恢复原生可选 `PI_WEB_PASSWORD` 登录：未配置时直接进入，配置后使用签名 Cookie，API 兼容 Basic Auth。`REPORT_API_URL`、`REPORT_DEMO_LOGIN` 不再生效，不调用 Report 服务。本地配置和旧业务配置文件不删除。
- 管理 API 为 `/api/local-browser`（旧 `/api/report/browser` 已移除），受站点认证及 Host/Origin 检查保护，验证会话 UUID、路径和文件存在性。
- 仅三个精确设备地址使用独立认证：`/api/chrome-gateway/pair/claim`、`/api/chrome-gateway/device/next`、`/api/chrome-gateway/device/result`。不要把整个前缀设为例外。保留 Host 检查和扩展 Origin 检查；无 Fetch Metadata 的客户端以及扩展 GET 的无 Origin + `Sec-Fetch-Site: none` + `Sec-Fetch-Mode: cors` 可进入路由，但仍需一次性配对凭证或设备 Bearer token。
- 为保持已安装扩展兼容，保留 `report-*` 消息/IndexedDB 标识、网关存储目录、下载地址 `/report-chrome-connector.zip` 和版本 `0.15.59-report.2`。这些只是兼容标识，不依赖 Report 登录、账号或业务代码。扩展显示名称改为 Pi Web。
- 网关存储为 `<agentDir>/report-chrome-gateway/devices.json`，服务端只存 token SHA-256。原子私有写入，目录 0700 / 文件 0600，Windows 需保护 ACL；不是加密保险箱。扩展凭证原文只存扩展源 IndexedDB，不向网页/模型提供，也不转发站点 Cookie。

## 断开与安全边界

- **取消待确认连接**：短时码失效；**断开此会话**：删除绑定并取消排队/等待结果，不影响设备的其他会话；**撤销设备**：删除全部绑定，凭证失效，需在扩展忘记站点后重新信任配对。
- **停止并忘记站点**：删除扩展信任与凭证，不再取命令；服务端记录需另行撤销。退出 Pi Web 不会自动撤销设备、终止运行中的 Agent 或关闭业务标签。已送出的操作可能完成，不能撤回。
- Pi Web 是可信操作员共享环境，会话、文件、终端及工具不按用户隔离，设备绑定不是多租户 ACL。无密码实例不要暴露给不可信网络。
- HTTP 明文传输设备凭证和页面内容，优先内网 HTTPS。内网域名通过 `PI_WEB_HOSTNAME` 或 `PI_WEB_ALLOWED_HOSTS` 配置；IP 直接支持。代理须允许 25 秒长轮询，建议超时 60 秒，不缓存设备接口。
- 扩展权限广泛，须信任服务器和模型处理环境。工具不暴露任意 JS、原始 CDP、网络日志、上传或截图；参数显式挑选。只读预设只允许 status/tabs/snapshot；snapshot 可能创建专用标签，不是绝对无副作用。交互可能触发业务写入，应使用只读业务账号。
- 网页正文是不可信数据，会进入模型与会话；密码输入遮罩不保证所有敏感文本脱敏。不要把秘密放入对话。
- 一次性码 32 个随机字符、两分钟有效、拒绝重放；claim 全局每分钟 60 次。设备 token 随机 32 字节。扩展只信任一个精确 origin，worker 校验完整 origin 和顶层 frame；页面消息只能请求状态或待确认配对，不能直接下发命令。
- **仅支持单个提供连接器的 Pi Web 服务进程**。队列、短时码、在线状态在内存；锁只保护文件，不支持负载均衡。重启保留设备绑定，丢失队列和未用配对。写入失败关闭授权，损坏文件不覆盖。上限 1000 设备/绑定/待配对、100 待执行命令。
- JSON 默认 16 KiB、设备结果 2 MiB、工具输出 60,000 字符；取消/超时后的迟到结果拒绝，已开始的浏览器动作仍可能完成。

## 浏览器与离线包

最低目标 **Chrome 109**。凭证使用扩展源 IndexedDB，旧 `storage.local` 副本只在私有事务提交后删除；失败停止连接，不回退到共享存储。debugger attach/detach 使用兼容回调，唤醒周期一分钟；后台休眠或节能可能导致 35 秒工具请求超时。弹窗初始化失败/25 秒超时显示错误和重试；内部页面不能设为可信站点。

打包只需开发机 Python 标准库，运行服务器和客户端不需要 Python：

```bash
python modules/local-browser/pack.py
python modules/local-browser/pack.py --check
```

预期输出 `Built ...` 和 `PASS offline ZIP matches connector sources and manifest`。源码在 `connector/`，ZIP 在 `public/report-chrome-connector.zip`，下载经过原生站点认证。修改扩展必须重建 ZIP；更新引擎版本同步工具 expectedExtensionVersion。客户端覆盖原解压目录后点重新加载，再刷新网页，保留配对；移动目录或重装可能改变扩展 ID，需重新配对。旧存储迁移后不要直接降级。

## 验证与运行

```bash
npm run dev -- --port 30142
node --experimental-strip-types --test modules/local-browser/*.test.mjs lib/web-auth-proxy.test.mjs app/api/web-auth/route.test.mjs
node_modules/.bin/tsc --noEmit
node modules/local-browser/connector.e2e.mjs
node modules/local-browser/local-browser.e2e.mjs
```

开发只运行 Turbopack，不在运行中的源码目录执行 `next build`。无需新增运行依赖。

单测使用临时存储和模拟 Chrome API，覆盖认证、来源、配对、会话授权、只读预设、撤销和存储失败。隔离 E2E 使用临时浏览器用户目录及本地测试页，无真实账号/模型请求；验证 content script、HTTP 配对/轮询、七类动作和 IndexedDB 迁移/回滚/源隔离。E2E 在真实 worker 调用 popup 处理函数，popup sender 校验由单测覆盖，真实工具栏点击仍需人工验收。

历史版本已在 Chrome 155 和官方 Chromium 109.0.5414.0 验证；指定浏览器可用 `PI_WEB_TEST_CHROME_EXECUTABLE='/path/to/chrome109' node modules/local-browser/connector.e2e.mjs`。实际企业/裁剪版浏览器、长期休眠、真实业务网站、CentOS 7 和多用户容量仍需部署验收；Chrome 109 已停止安全更新，不要访问不可信网站。
