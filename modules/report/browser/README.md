# 本机 Chrome 连接器

控制操作员**自己电脑的 Chrome**，不是业务系统配置中的服务器 Chrome / 9333。复用 MIT `pi-chrome` 0.15.58 的浏览器控制引擎与旧 Chrome Gateway；保留 `connector/LICENSE`。业务实现集中于本模块，API 为薄路由，工具以 InlineExtension 注册，不改 AgentSession、SSE、会话文件格式。

## 操作流程（纯内网）

1. 登录警情分析助手，打开顶部 **业务配置 → 本机浏览器**，下载离线 ZIP。
2. 解压到固定目录，在 `chrome://extensions` 开启开发者模式，加载含 `manifest.json` 的目录。无需 Chrome 商店、外网、Python、本地桥接程序或远程调试端口。
3. 返回助手网页，点击工具栏扩展图标，核对**协议、主机、端口**后信任当前站点。HTTP 风险在此明确提示；刷新网页。
4. 打开一个已保存的对话，在配置页点击连接；再从扩展图标核对会话 ID 并确认。两分钟内有效，无需填写地址/设备名/配对码。
5. 当前会话可使用 `local_browser`：连接状态、标签列表、页面快照、打开、点击、填写查询条件、按键、滚动。每次读取/操作都需在对话中确认；密码、验证码、扫码、UKey 人工完成。已运行会话需重载工具/会话后才有新增工具。

普通网页不能静默首次安装 Chrome 扩展；企业策略部署不在本次范围。下载完成不代表安装成功；已配对不代表在线。在线为最近两分钟收到设备请求，断网后有检测延迟。只有选中浏览器分类时轮询状态，切换会话重置面板状态。新会话不会继承绑定；同一设备可明确连接多个会话。

## 断开与撤销

- **取消待确认连接**：使本次未使用的短时配对凭证失效，扩展旧确认会失败。
- **断开此会话**：删除绑定、取消服务器排队/等待结果，不撤销设备其他会话。
- **撤销设备**：删除该设备全部绑定，凭证失效。重新连接前须在扩展忘记站点再信任。
- **停止并忘记站点**：删除扩展保存的信任及凭证，不再取后续命令；服务端记录需另行撤销。
- 已送出的动作可能完成，不能回滚已发生操作；以上操作都不会注销业务系统或关闭其标签页。退出 Report **不**自动撤销设备/中止正在运行的 Agent。离岗前显式停止或撤销。

## 安全与部署边界

- Report 用户目前是可信共享操作员，现有会话、文件、终端及工具不做多租户隔离；配对不是用户 ACL。管理接口检查会话格式、路径与文件存在性。
- 精确三条设备路由采用独立认证：`/api/chrome-gateway/pair/claim`、`/device/next`、`/device/result`。**不要**把整个网关前缀设为认证例外。Host 仍检查，普通网页 Origin 拒绝；合法扩展 Origin、无 Fetch Metadata 的非浏览器客户端，以及 Chrome 扩展 GET 的无 Origin + `Sec-Fetch-Site: none` + `Sec-Fetch-Mode: cors` 可进入路由，但仍需一次性配对凭证或设备 Bearer token。不要把来源检查误认为身份认证。
- 一次性码为32个随机字符，TTL两分钟，重放拒绝，全局 claim 每分钟60次。设备 token 随机32字节，仅扩展 trusted storage 保存原文，网页/模型不获取；服务端只存 SHA-256。不传递 Report Cookie 给扩展，扩展 fetch 使用 `credentials: omit` / `redirect: error`。
- 扩展只信任一个精确 origin；动态脚本 match pattern 不含端口，但 worker 二次校验完整 origin、顶层 frame。配对最终由扩展 popup 确认。页面消息只能请求状态和待确认配对，不能直接下发浏览器命令。
- 扩展拥有广泛标签/页面/debugger权限，必须信任助手服务器与模型处理环境。已开放工具不含任意 JS、原始 CDP、网络日志、文件上传或截图；控制引擎保留上游实现，但命令入口只接受本次七类操作。工具参数显式挑选，不透传未知参数。
- 只读工具预设拒绝 open/click/fill/key/scroll；snapshot 可能创建会话专用标签，不代表绝对无副作用。查询交互仍可能触发写入，须使用只读业务账号与人工确认。页面正文是**不可信数据**，会进入模型及会话，快照密码输入遮罩不代表页面中所有敏感文本均已脱敏。
- HTTP 明文传输设备凭证和页面内容，优先内网 HTTPS；风险提示不能替代 TLS。内网域名须通过 `PI_WEB_HOSTNAME` 或 `PI_WEB_ALLOWED_HOSTS` 配置允许，IP直接支持。反向代理需允许25秒长轮询，建议超时60秒，不缓存这些接口。
- 网关存储：`<PI_CODING_AGENT_DIR 或默认 agentDir>/report-chrome-gateway/devices.json`，原子私有写入。目录0700/文件0600（Windows须配置ACL）。不是加密保险箱。
- **仅支持单个 Pi Web 服务进程**。队列/短时码/在线状态在内存；锁仅保护写入，不支持多实例共享状态或负载均衡。重启丢失队列和未用配对，保留设备绑定。写入失败则关闭授权操作，修复存储后重启；损坏配置不覆盖。上限1000设备（含撤销记录）、1000绑定、1000待配对、100待执行命令；大量撤销记录需管理员在停机备份后维护，不自动删除审计记录。
- JSON请求默认16KiB，设备结果2MiB，工具输出截至60,000字符。没有截图工具，因此不提高结果上限。取消/超时后晚到结果拒绝；浏览器已开始的动作仍可能完成。

## 离线包与升级

源码：`connector/`；下载文件：`public/report-chrome-connector.zip`，精确下载路径也经 Report 登录保护。ZIP无地址、密码、token或用户配置，无新增npm依赖。构建机器使用 Python 标准库（运行服务器和客户端均不需要Python）：

```bash
python modules/report/browser/pack.py
python modules/report/browser/pack.py --check
```

预期输出 `Built ...` 和 `PASS offline ZIP matches connector sources and manifest`。修改扩展后必须重建并同时提交ZIP；更新版本号时同步工具的 expectedExtensionVersion。客户端替换原目录文件后在扩展管理页点重新加载，再刷新助手页面；无需重复填连接信息。升级保留本地信任/凭证，撤销状态以服务器为准。

## 验证

```bash
node --experimental-strip-types --test modules/report/browser/*.test.mjs lib/web-auth-proxy.test.mjs
node_modules/.bin/tsc --noEmit
node modules/report/browser/connector.e2e.mjs
```

单测用临时存储/模拟Chrome API，涵盖短时码、来源、独立凭证、串行命令、撤销、故障关闭、工具确认/只读预设、会话管理。隔离E2E用已安装Chrome、临时用户目录及本地HTTP测试页，无真实账号/模型请求；通过CDP加载测试扩展（`--enable-unsafe-extension-debugging` **仅测试**），实际验证content script、HTTP配对/轮询、tabs/snapshot/fill/click、断开。Playwright不暴露action-popup target，E2E直接在真实worker调用popup处理函数，popup sender校验另由单测覆盖，尚需人工点击验收。

尚未验证：真实业务网站/Report账号的全链路、企业策略安装、CentOS7部署及多用户容量。不要为此在正在运行的源码目录执行 `next build`。
