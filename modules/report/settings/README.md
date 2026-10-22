# 数据源与业务系统配置

顶部齿轮 → 数据源 / 业务系统。打开配置时切换为简体中文；数据源直接复用原建模平台与本地 MySQL 面板。业务系统可新增、修改、删除、测试当前调试端口、打开已保存网址、提交登录。切换分类保留表单，关闭面板放弃未保存内容。

## 服务端准备

复用开源 DrissionPage 4.x 和已有 dp-browser 技能；没有新增 npm 依赖，也不会自动安装 Python 依赖。Node 服务运行账号必须能访问 Python 和专用 Chrome。

```bash
# 在部署环境的 Python/虚拟环境中安装（内网需预备对应 Linux amd64 离线依赖）
python -m pip install DrissionPage==4.1.1.4
```

环境变量（Pi Web `.env.local` 或服务启动环境，不提交私有配置）：

```dotenv
# Linux 示例；也可填写 Windows 实际 python.exe 的完整路径，不能填 pyenv .bat shim
REPORT_BROWSER_PYTHON=/opt/report-browser/bin/python
```

不设置时直接执行 `python`，不通过 shell。Windows pyenv 的 shim 可能被 Node 跳过而误调用 WindowsApps 占位程序，请指定实际解释器。本机验证使用 Python 3.12.10 / DrissionPage 4.1.1.4；服务器 CentOS 7 旧内核与 Chrome 兼容性尚需部署验证。

启动专用 Chrome（命令以 Linux 为例；Windows 用 chrome.exe 的实际路径）：

```bash
google-chrome --remote-debugging-address=127.0.0.1 --remote-debugging-port=9333 --user-data-dir=/secure/report-chrome about:blank
```

必须使用独立用户目录，不复用日常浏览器，不使用 `--no-sandbox`。无桌面环境可按 Chrome 支持情况使用 `--headless=new`，但扫码/验证码仍需可操作的人工登录途径。连接器只连接现有浏览器，不自动启动、退出或安装 Chrome。Docker 中本机指容器本身，本版不支持远程调试主机。

点击“测试连接”预期显示“本机 Chrome 调试连接正常”；它只验证 CDP 端点，不验证 Python、登录成功或数据库权限。打开/登录失败会显示中文错误，不回传 Python traceback 或凭据。

## 登录与对话

1. 保存系统名称、完整登录网址、本机端口、查询说明；账号密码可选。
2. 人工登录：点击“打开系统”，在服务端 Chrome 完成登录。
3. 自动提交：配置账号框、密码框、登录按钮的 CSS 选择器并保存，点击“提交登录”并确认。
4. 新建普通工具会话（已有会话需要重新加载工具），例如：`请打开业务系统“警情查询”，查询今天各类警情数量，不修改任何数据。`
5. `business_system` 先按名称查 ID；打开/登录都通过现有确认对话框确认。返回端口和 tabId 后，助手使用已安装 dp-browser 技能的 `--port <端口> switch <tabId>`，再读取页面执行获授权查询。纯聊天和子代理不注册该工具。无需把密码发给模型。

自动登录仅支持同源主文档的可见 input（密码框须 type=password）；iframe、跨域 SSO、验证码不自动处理。跨域跳转或跨域表单 action 会拒绝填写；“已提交”不等于“登录成功”。每次打开新标签页，以 tabId 定位，避免误操作其他系统。不同会话及用户仍共享同一浏览器；并发插件操作不受连接器串行锁控制。

## 凭据与权限边界

- 文件：`<agentDir>/report-business-systems.json`；私有原子写、跨进程锁、损坏文件拒绝覆盖，最多 100 系统 / 1 MiB。
- GET/保存响应只含 hasPassword，不回显密码；空密码保留，勾选可清除。网址、账号或端口改变后不复用旧密码，需重新填入。
- 凭据仅在服务端通过 stdin 送到 DrissionPage 子进程，不放进 argv、模型参数、工具结果、localStorage 或会话日志。查询说明和网址不应含令牌或密码。
- 私有文件不是加密保险箱。所有操作员及代理本来就有同机文件/命令能力，不能防止他们主动读取文件或浏览器状态；生产需保护服务账号与 ACL，不能承诺多租户秘密隔离。
- 登录页面本身及其脚本必然获得输入凭据，只保存可信登录网址；HTTP 传输明文，推荐 HTTPS。查询内容会进入模型和会话，须事先授权。
- 不强制只读：dp-browser 支持点击/JS，请配置业务系统只读账号。删除配置或退出 Pi Web 不会注销业务系统或关闭标签页。
- `/api/report/systems` 由整站 Report 认证保护，仍校验请求来源、JSON、大小和字段。权限沿用当前“全部登录账号是可信操作员”的规则。

## 验证

```bash
node --experimental-strip-types --test modules/report/settings/systems.test.mjs
REPORT_BROWSER_PYTHON=/path/to/python node modules/report/settings/browser.e2e.mjs
```

后者启动隔离 Chrome、临时配置与本地测试网页，仅用测试凭据，不接触真实业务系统。预期两行 PASS：连接/打开/提交/结果脱敏；跨域和缺失字段拒绝提交。真实系统表单适配和登录状态需另行验收。
