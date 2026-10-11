# 更新记录 —— dsh-status-dot-control

本包是 [`dsh-status-dot`](https://github.com/StarflowDream/dsh-status-dot) 仓库里的**控制版**（只读版见仓库的 `dsh-status-dot/` 目录）。安装物是挂在 [Release](https://github.com/StarflowDream/dsh-status-dot/releases) 上的 tarball。仓库级、含只读版的完整记录见根目录 [CHANGELOG.md](https://github.com/StarflowDream/dsh-status-dot/blob/main/CHANGELOG.md)。

## 1.0.4 — 2026-10-11

**一句话：代码没动，把发布件补齐成规范包。**

- 包内新增 `README.md` / `LICENSE` / `CHANGELOG.md`。此前 tgz 里只有 6 个代码文件，别人 `dsh plugin add` 装完看不到任何文档。
- `package.json` 新增 `files` 白名单：`lib`、`scripts`、`cordis.patch.yml`、`README.md`、`LICENSE`、`CHANGELOG.md`。打包内容从此是显式声明的，`.bak-*`、草稿之类不会再被 `npm pack` 顺手带走。
- 行为与 1.0.3 **完全一致**：`lib/index.js`、`lib/client.js`、`scripts/dsh-control.vbs`、`scripts/dsh-control.ps1` 四个文件的 sha256 未变。
- 判据 `checks/dot-control-package.check.mjs` 相应升级：版本断言 → 1.0.4，四份副本比对面扩到 8 个文件，并新增"tgz 文件清单必须**恰好** 9 项"。

## 1.0.3 — 2026-10-11

**一句话：回滚 1.0.2 里那处会让桌面端启动失败的客户端改动；1.0.2 的服务端修复全部保留。**

- 修掉 1.0.2 引入的客户端回归：装了之后桌面端每次启动都弹「应用无法启动或已意外停止」。1.0.2 把候选槽位循环改成「只有 `register` 真成功才 `break`」，但插件加载器的 `inject` 回调是**延后执行**的，这个标记在循环里永远看不到 ⇒ 圆点组件被注册进**所有**候选槽位，`@deepseek-ai/dsh-client-ui-sidebar` 与 `@deepseek-ai/dsh-client-ui-conversation` 两个官方插件 `failed`（`web boot: 11 entries did not activate`）。
- 修法：`lib/client.js` 在四个副本里逐字节回滚到 1.0.1 那版（sha256 前 16 位 `cdbf9e1b4dae6f8a`）；判据新增"客户端回归闸"：出现 `registeredHere` 直接失败，且必须保持"attach 成功立刻 `break`"的已知 good 形状。

## 1.0.2 — 2026-10-11

**一句话：重启少等 3 秒，并修掉一批「看着成功、其实没做到」的边角。**

- 重启固定等待 6s → 3s（客户端点下去本来就先等 1s，那 6 秒只是让回复先到页面的余量）。
- 修掉「重启可能停掉了却没起来」：延迟启动改走 `relaunch` —— **先等旧进程真的消失**（最多 25s）再启动，消除原来「先排 N 秒后启动、再停」的时间窗反转。
- 同源 GET 也能停服务 → 动作端点非 POST 一律 405。
- `via` 原来会回 `wscript C:\Users\<用户名>\…` → 现在只回文件名。
- 主端口取错：反代/隧道下 `Host` 头带的是入口端口 → 现在按 `req.socket.localPort` → `Host` → 默认 排序，`portSource` 说明用了哪一个。
- Node < 20.16（没有 `process.getBuiltinModule`）不再「报成功其实没动」，直接回 500 带原因，并声明 `engines.node >= 20.16`；`stop` 找不到同名进程时探端口，端口还在听就记 FAIL。
- 其它：`appPath` / `processName` 含双引号直接拒绝；围栏遇非数字 rejection 回落到 403；两处与实现不符的文案改掉。

## 1.0.1 — 2026-10-11

**一句话：从「你得先自己准备一个处理器」变成「装上就能用」，并且在 DSH 桌面端上真正可用。**

- 包内自带处理器：`scripts/dsh-control.vbs`（转发）→ `scripts/dsh-control.ps1`（干活）。默认路径由插件用 `import.meta.url` 就地算出，**发布包里不含任何作者机器上的路径**，所以装上即用，不用写脚本也不用注册协议；想接自己的处理器用 `config.controlVbs` 覆盖，`appPath` / `processName` 作为位置参数转发。
- 桌面端兼容：桌面端（Electron 壳）不会把 `meowdsh://` 交给系统协议处理器，旧的协议路径在桌面端**完全无效**；新版默认走同源 HTTP 动作路由 `POST /dsh-status-dot/action?action=<start|stop|restart|logs>`，只在浏览器 / 旧服务端上回退到协议。白名单之外的动作值不转交；`wscript` 独立进程执行，1 秒延迟保证 HTTP 响应先回到页面。
- 主端口从请求推出来，`dsh web`（默认 3080）与桌面端（默认 19387）都能直接用；额外服务用 `config.extraPorts` 列。
- 修掉「关闭服务」后的恢复框：主进程、`--type=` 辅助进程与监听端口的 host 子进程同名，只按端口杀监听者会留下「宿主已死」的窗口；随包脚本改为**一次扫掉整棵同名进程树**，并且 `restart` **先**安排重开**再**停。
- 安全属性未放松：每个端点都过 DSH 浏览器围栏（无有效 cookie 一律 401），不发 CORS 头，响应体最小化；插件本身不写磁盘文件。

## 1.0.0 — 2026-10-11

首个公开发布版：状态圆点 + 悬停气泡（运行时长 / PID）+ 可展开面板，另带启动 / 关闭 / 重启 / 日志四个动作。此时控制动作默认走 `meowdsh://` 协议处理器（需要使用者自己注册），随包处理器从 1.0.1 起才有。
