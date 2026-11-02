# Skill Hub 技能市场：平台身份桥接

托管 Pi Web 沿用平台登录身份，不需要维护 Desktop token。插件市场仍使用 `PI_WEB_MARKET_URL` / `PI_WEB_MARKET_DIR`。源码已实现，不代表部署完成。

## 托管配置与访问

由管理员在用户容器创建环境中设置（只有地址，没有秘密）：

```dotenv
PI_WEB_SKILL_HUB_MANAGED=1
PI_WEB_SKILL_HUB_BRIDGE_URL=http://skillhub-pi-gateway-direct:8091/skill-market/
```

该地址必须是容器可达的固定工作空间网关，不能使用浏览器头提供的地址，也不能把容器的 localhost 当网关。网关与容器必须在同一用户网络上；回调源 IP 要与代理目标容器 IP 一致（不支持经过额外 NAT/代理的回调拓扑）。

登录平台 → 从平台打开个人工作空间 → 设置 → 技能 → 添加。直接访问独立本机地址没有平台身份：应提示从平台重新打开，不应把平台 token 手工填入 Pi Web。已托管但缺少地址或凭证时明确失败；即使设置了旧共享 token 也绝不回退。网关注入的凭证头也会强制进入托管模式，旧容器缺配置不能误用共享 token。

## 身份与安全边界

- 平台 token 与内部 key 仅在网关和 Java 后端之间传递，绝不注入 Pi Web、浏览器或用户容器环境。
- 网关仅为 `GET /api/market?kind=skill` 和 `POST /api/skills/install` 的合法 `skillhub:<code>` 请求生成 256 位随机能力凭证。凭证在头中传给 Pi Web，仅允许目录分页或指定技能的详情/正式包；没有任意 URL 转发。
- 凭证绑定原平台会话、记录 ID、用户 ID、容器源 IP，最长 120 秒。原请求完成/断开就删除并取消回调；失效会话、账号切换、非 READY 或变更的记录均拒绝。凭证保存于私有映射（仅存哈希索引），不进入通用 view/debug，入站伪造工作空间头被剥离，出站凭证头也不传浏览器。
- 每次回调及返回数据前重新验证平台身份和会话，Java 再校验内部 key + 平台 token，从真实用户 ID 读取 `SysUser`，复用 `searchV2ForUser/detailV2ForUser/packageDownloadV2ForUser` 当前权限规则。无跨用户缓存。
- V2 每页 30 项，最多 10000 项，只展示 `installable=true` 条目；不可安装条目仍计入翻页进度。不传递自报 userId、scope 或下载 URL。
- 内部 8091 的 `/skill-market/` 是无内部 key 的受限能力入口；其他内部路由仍要求内部 key。部署网络策略需要允许该回调，控制面接口不能因此公开。HTTP 不加密，生产网络须限制旁路监听或配置 TLS。

## 安装行为

安装前重新获取详情/releaseId，再从固定网关下载 ZIP。校验大小/SHA-256；下载最多 64 MiB，解包最多 128 MiB/5000 条目，JSON 最多 8 MiB。拒绝重定向、链接、特殊文件、穿越、Windows 别名、重复路径、多个 SKILL.md。支持根目录或单层包装目录，保留辅助文件和执行位，不执行脚本或安装依赖。

复用现有非覆盖安装器：全局 `~/.pi/agent/skills/<name>`，项目 `<cwd>/.pi/skills/<name>`。项目仍需目录授权和信任；失败清理临时目录/部分复制。目录以 SKILL.md name 为准，不假设 skillCode 等于调用名。活动会话遵循原资源重载规则。已经成功下载到用户容器的文件不会因随后退出平台被远程擦除。

## 独立实例兼容

仅非托管独立实例可继续配置 `PI_WEB_SKILL_HUB_URL=<平台上下文根>` 和服务端 `PI_WEB_SKILL_HUB_TOKEN=<正式 Desktop Bearer token>`，使用旧 v1 协议。它是实例共享身份，不适合托管多用户，不接受普通平台 token。不要提交凭据或使用 `NEXT_PUBLIC_`。两个模式均无静默市场回退；完全未配置时保留原市场。

## 验证（无真实平台/Docker）

```bash
SKILL_HUB_GATEWAY_SOURCE=../skill-hub-codex-st/deploy/pi-workspace/gateway/server.mjs \
  node --test lib/skill-hub-market.test.mjs lib/local-market.test.mjs lib/remote-market.test.mjs
node_modules/.bin/tsc --noEmit
npm run lint
```

跨仓库测试通过真实本地 HTTP 串联网关、Pi 适配器和临时安装目录，平台服务是替身；未设置源码路径时该项明确 skip。网关及 Java 测试命令见后端 `deploy/pi-workspace/SKILL-MARKET.md`。

上线需分别更新 Java、网关和 Pi Web 产物。现有用户容器须保留 home/workspace 卷、绑定和端口重建以获得环境变量，普通 restart 不生效；本轮没有执行。真实双账号登录/撤权、可信项目安装、容器 DNS/源 IP、内网防火墙及 CentOS 7 旧内核仍需独立验收。
