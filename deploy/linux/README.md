# Linux 多实例发布（第一版，无 Docker）

一个开发环境、一个独立构建环境、多个用户运行实例。复用 Git/npm、systemd、Nginx；不改 Pi Web 的认证/会话核心，不引入平台数据库。

**状态：部署脚本和隔离配置原型。必须在目标 Linux 完成本文验收后才用于业务。单元测试用假 systemctl/HTTP，不等于双用户运行验证。**

## 约束

- 目标：单台 Debian/Ubuntu、systemd、Python >= 3.10、Linux x86_64/glibc。其他发行版尚未验证。
- Node 安装在 `/usr/bin/node`，满足项目版本要求；构建和运行精确版本一致。不要用管理员 HOME 下的 nvm 给其他账号运行。
- `git`、`npm`、`bash`、`useradd`、Nginx；原生依赖编译可能需要 `python3 build-essential`。
- 构建使用独立的非特权账号，不授予 sudo、不放生产凭据。npm 生命周期和项目测试可以执行代码，必须审核来源。
- 管理脚本只给管理员使用。它可以创建系统账号、切换服务；不要给普通用户 sudo 授权，也不要包装成无鉴权 Web API。
- 不自动获取“最新 dev”，不定时更新，不迁移历史管理员配置，不自动删除账号/数据/旧版本。
- 系统账号、目录权限和 systemd 限制不是完整沙箱。用户仍共享内核/网络，可以访问本机网络服务。数据库和模型必须单独鉴权，不能靠“只监听 localhost”保护它们。

## 布局

```text
/srv/pi-web/releases/<release>/                 root 私有的批准产物
/srv/pi-web/instances/alice/releases/<release>/ alice 的应用副本
/srv/pi-web/instances/alice/current             当前版本链接
/srv/pi-web/instances/alice/previous            上一成功版本链接
/etc/pi-web/alice.json                         端口、域名等管理员元数据
/etc/pi-web/alice.env                          独立实例密码，root 0600
/home/pi-alice/.pi/agent/                      配置、凭据、会话、个人技能
/home/pi-alice/pi-cwd/                         现有默认工作目录（按日期）
/opt/pi-market/                                管理员维护的共享只读市场
```

构建一次，但每个实例有独立部署副本。不共享可写 `.next`，也不用硬链接。
代码、依赖由 root 管理；`.next` 属于实例账号且为私有目录。`ExecStartPre` 复用项目的预览密钥刷新函数，失败即拒绝启动，再通过官方 `bin/pi-web.js` 启动。
**不能让其他用户读取 `.next/prerender-manifest.json` 或公开构建包：预览 ID 关系到 Next 的代理认证绕过防护。** 发布目录必须保持 root 私有。

## 1. 安装管理工具（管理员）

在审核过的项目检出目录执行：

```bash
sudo install -o root -g root -m 0755 deploy/linux/pi-web-admin.py /usr/local/sbin/pi-web-admin
sudo install -o root -g root -m 0644 deploy/linux/pi-web@.service /etc/systemd/system/pi-web@.service
sudo systemctl daemon-reload
python3 /usr/local/sbin/pi-web-admin --help
```

管理命令使用固定的 `/srv/pi-web` 和 `/etc/pi-web`，不从用户环境变量读取 root 写入路径。管理操作由文件锁串行化。日志输出到控制台，实例日志由 journal 管理。

## 2. 准备市场（管理员）

复用已经建立的内网 `pi-market` 仓库，但不要直接复制某人的 `~/.pi`：

```bash
# 仓库地址和认证方式由管理员指定；凭据不写进 URL。
sudo git clone <内网市场仓库地址> /opt/pi-market
sudo chown -R root:root /opt/pi-market
sudo chmod -R go-w /opt/pi-market
sudo chmod -R a+rX /opt/pi-market
```

首次克隆失败时先检查 Gitblit SSH 算法兼容及只读账号；不要禁用主机密钥验证。最好部署一个审核过的固定市场快照，将 `.git`、部署密钥留在管理员工作区。

`create` 拒绝非 root 所有、组/其他用户可写或含符号链接的市场。上级目录也必须由管理员控制、可遍历且不可被普通用户替换。目录最好放在 `/opt`，不要放进任何人的 HOME（服务会隐藏其他 HOME）。

**市场现有语义未改：** 技能复制到个人目录，同名不覆盖；插件直接引用共享路径。有自写文件需求的插件、插件内技能启停必须单独验证。个人插件副本安装尚未实现，不要承诺所有插件都兼容只读市场。第一版只发布已审核且能从只读目录运行的插件；禁止普通用户修改共享目录。不在多人运行时原地 `git pull` 改变已加载插件；用版本化市场目录并安排维护切换。

## 3. 构建一次（非 root 的专用构建账号）

### 只有 Windows 开发机：使用本机 Docker 构建 Linux 产物

内网私有发布仓库：`ssh://admin@192.168.31.98:29418/~admin/pi-web-releases.git`。将其克隆到源码仓库同级的 `pi-web-releases`，保持工作区干净。在 Windows 安装 Python >= 3.11、Git，并启动 Docker Desktop 的 Linux containers：

```powershell
python deploy/linux/build-release.py
# 非同级目录时：
python deploy/linux/build-release.py --release-repo E:/releases/pi-web-releases
```

`build-release.py` 默认输出到同级发布仓库；`Dockerfile.builder` 固定 Debian Bookworm / Linux amd64 / Node v22.19.0 基础镜像摘要。容器以非 root 用户运行现有构建流程，输入仅为已提交 HEAD 的 Git bundle 和部署工具，不挂载开发工作区、凭据或 Docker socket。首次准备镜像和 npm 依赖需要网络。目标服务器必须使用兼容的 Linux/glibc 和精确相同的 Node 版本，其他架构需另建发布流程。

只有完整构建、测试、lint 成功后才替换发布仓库的 `pi-web-linux-x64.tar.gz`、`release.json`、`SHA256SUMS`；不会自动提交、推送或部署。发布者检查后将三者一起提交推送。失败时不上传半成品；临时构建目录自动清理。发布工作目录应限制访问，不要公开构建包。

生产服务器在私有暂存目录 `git pull --ff-only` 后校验 `sha256sum -c SHA256SUMS`，将可信包解压至私有目录，再按下文执行 `publish` / `deploy`。不要在运行目录直接 pull。认证交给 SSH 密钥或交互提示，不在脚本中保存密码。此流程不包含自动生产更新。

后续构建复用 Docker 命名卷 `pi-web-build-cache-node22.19.0-amd64` 中的 npm 下载缓存和 Next 编译缓存，后者按锁文件 SHA-256 分目录并加锁，只在检查及构建成功后更新。镜像层也由 Docker 复用。仍执行干净的 `npm ci`、全量测试、lint 和构建，不复用旧发布目录或开发 `.next`。缓存不含生产凭据、不进入发布包，仅供可信构建任务使用。首次启用需要暖缓存；依赖变化会触发新的编译缓存，实际提速需测量，不能承诺秒级发布。升级 Node 或平台需同步更换缓存卷名。缓存疑似损坏时，在无构建运行时删除该命名卷再重建。

入口测试（无需 Docker）：`python -m unittest discover -s deploy/linux -p test_build_release.py -v`。

### 已有 Linux 构建账号


从内网获取一个明确提交，在任意非开发工作目录发起：

```bash
pi-web-admin build \
  --repo <内网pi-web仓库地址> \
  --commit <完整提交ID> \
  --output /home/pi-builder/artifacts
```

流程：全新临时 clone → 检出提交 → `npm ci --include=dev` → TypeScript 检查 → `npm test` → lint → `npm run build` → 输出版本目录。

**不会在现有开发目录执行构建，不复制开发机 `.env.local`、会话或未提交代码。** 构建子进程使用临时 HOME 和最小环境；SSH 取仓库仍使用构建账号自己的 Git 认证。npm 私有 Registry 如需认证，后续需设计专用构建凭据，不复制生产用户 `.npmrc`。

产物保留完整依赖，第一版不做 standalone 或删除 devDependencies，避免误删运行时外置 SDK/原生模块。包含 `release.json`，记录提交、Node 版本、架构、Next BUILD_ID、锁文件 SHA-256。发布 ID 为 `<12位提交>-<UTC时间>-<随机后缀>`，同一提交可以重新构建，但不覆盖旧产物。

### 无外网构建

```bash
pi-web-admin build --repo <内网仓库> --commit <提交ID> \
  --output /home/pi-builder/artifacts \
  --npm-cache /home/pi-builder/npm-cache --offline
```

必须预先准备同平台、该锁文件的完整 npm 缓存及安装脚本需要的资源；`--offline` 不是依赖自动打包工具，也不能阻止生命周期脚本自己联网。不完整会失败。也可指定 `--registry <内网npm地址>`，但已有锁文件的外网 `resolved` 地址需要实际验证。严格断网需网络策略。

已有桌面 `node_modules` 压缩包不是 npm 缓存，此脚本不会自动导入它。Linux 原生依赖要在兼容的 Node/glibc 环境构建；不能拿 Windows 依赖运行。

## 4. 审核并导入发布版本（管理员）

```bash
sudo pi-web-admin publish /home/pi-builder/artifacts/<release>
```

验证平台、精确 Node 版本、BUILD_ID、必要文件、目录中的越界/绝对符号链接和特殊文件，复制到 root 管理的发布目录。此检查不是恶意代码扫描或签名验证。只导入可信构建者的冻结产物；复制期间不可让构建者并发修改目录。

`publish` 不运行 npm，也不更新任何用户。后续每个实例从此份批准产物复制，不重新构建。

## 5. 创建测试实例及用户实例

```bash
sudo pi-web-admin create test --port 30150 --host test.pi.internal \
  --market /opt/pi-market --release <release>

# 完成测试实例的登录、终端、会话、SSE、市场验收后再创建用户
sudo pi-web-admin create alice --port 30151 --host alice.pi.internal \
  --market /opt/pi-market --release <release>
sudo pi-web-admin create bob --port 30152 --host bob.pi.internal \
  --market /opt/pi-market --release <release>
```

创建 `pi-alice`/`pi-bob` 等独立系统账号，无交互登录 shell、无 sudo；服务内 `SHELL=/bin/bash` 供 Pi 的终端使用。HOME 0700、实例目录 root:用户组 0750。不会复用现有账号或目录。

密码随机生成且不打印到日志，保存在 `/etc/pi-web/<name>.env`，由管理员通过安全渠道交付。浏览器只输入实例密码；API Basic 用户名仍为 `pi`。这不是完整多用户账号系统，也没有自助注册。

健康检查确认：认证已启用、正确密码可访问、匿名会话访问返回 401、agent 接口结构正常、市场无诊断。**不是模型调用或完整 UI 测试。** 首次创建失败会保留账号和私有目录，绝不自动删除；排除问题后 `deploy --name ...` 重试，并手动 `systemctl enable pi-web@<name>`。不要直接反复 `create`。

## 6. HTTPS 访问

复制 `nginx.conf.example`，替换每个用户的域名、端口、证书路径，配置内网 DNS。示例使用正常证书校验，不生成或默认信任自签名证书。

```bash
sudo nginx -t
sudo systemctl reload nginx
```

后端只监听 127.0.0.1。代理保留 Host、设置 HTTPS 协议头、禁用 SSE 缓冲，并移除敏感的内部重验证请求头。`PI_WEB_ALLOWED_HOSTS` 必须匹配个人域名，不要关闭应用的 Host/Origin 校验。

不同端口不隔离浏览器 Cookie，因此使用不同域名。不同域名仍各自需要认证，没有统一 SSO。

## 7. 一键发布、状态和回退

先备份个人数据和 `/etc/pi-web`；确认用户已结束模型任务、子代理、后台插件任务与终端，然后关闭客户端，安排维护窗口。工具不自动判断忙闲，也不冻结新的客户端请求；维护期间应由管理员在代理层阻止访问。

```bash
sudo pi-web-admin status
sudo pi-web-admin deploy --name test --release <新release> --maintenance-confirmed
# 人工验收测试实例，再逐个推广；遇到第一处失败就停止
sudo pi-web-admin deploy --all --release <新release> --maintenance-confirmed
sudo pi-web-admin rollback alice --maintenance-confirmed
```

准备副本 → 停止整个服务进程组 → 原子替换 current → 启动 → 健康检查。
失败则停止候选版本、恢复旧链接；旧版本原本在运行才重新启动并验证。第一次安装失败则移除 current，保留可排查的文件。回退后再次健康检查失败会明确报错，不宣称恢复成功。

批量失败不会回滚此前已经成功更新的其他用户；用 `status` 查看版本，按需逐个回退。`--all` 跳过未运行的实例，避免重新启用已停止的用户；要更新并启动它们，请明确使用 `--name`。停用账号管理尚未实现。

**应用回退不恢复配置/会话数据。** 有格式迁移的发布必须先做兼容设计与备份。不自动删除旧版本或个人数据。断电或 SIGKILL 等中断不是完整事务：链接替换是原子的，但需根据 `status` 和 journal 人工检查恢复；不能把脚本当作高可用调度器。

```bash
sudo systemctl status pi-web@alice
sudo journalctl -u pi-web@alice -n 100 --no-pager
sudo systemctl stop pi-web@alice
sudo systemctl start pi-web@alice
```

服务模板设置初始上限 `MemoryMax=2G`、`CPUQuota=200%`、`TasksMax=256`，不是容量测评结论。真实工具链可能需要更高额度，管理员可用 `systemctl edit pi-web@alice` 调整。磁盘配额和网络策略需按服务器环境单独设置。

`ProtectSystem=strict` 仅允许个人 HOME、个人 `.next` 和私有临时目录写入；其他 HOME 隐藏。需要访问共享业务目录时显式审核后增加只读/读写挂载，不要简单关闭全部保护。

## 8. 验收清单

在 Linux 文件系统（不要在 Windows 挂载盘上测试权限）执行脚本测试：

```bash
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s deploy/linux -p 'test_*.py' -v
sudo systemd-analyze verify /etc/systemd/system/pi-web@.service
```

真正投入使用前仍需验证：

- 两个实例同时登录，Cookie 不串；Alice 密码不能访问 Bob。
- Alice 的真实终端无法读取 Bob 的 HOME、实例 `.next`、`/etc/pi-web` 或发布原件；不能修改公共市场和系统配置。
- 个人会话、模型凭据和安装状态不交叉，重启后持久保存。
- 文件上传/预览、中文终端、SSE 断线重连、插件加载正常。
- 用户插件需要的系统工具/Python 包已准备；只读市场兼容性验证。
- 候选版本故意启动失败时确实恢复旧服务；真实个人数据备份可以恢复。
- 停服、资源超限、磁盘满场景；多实例内存和磁盘容量实测。
- 代理 HTTPS、跨用户授权、对未认证和内部重验证请求头的防护。

第一版不包含：自动定时更新、SSO/账号管理页面、首次登录分配、磁盘配额、网络隔离、插件个人副本安装、自动业务数据备份、完整漏洞审计。`PI_OFFLINE` 和关闭版本检查不能保证整个应用断网。
