# 更新记录

本仓库有两个包：`dsh-status-dot`（只读版）与 `dsh-status-dot-control`（控制版）。两包各自独立发版，安装物是 `dist/` 下的 tarball。

## dsh-status-dot-control v1.0.1 — 2026-10-11

**一句话：控制版从「你得先自己准备一个处理器」变成「装上就能用」，并且在 DSH 桌面端上真正可用。**

### 开箱即用（本次重点）

- 包内自带处理器：`scripts/dsh-control.vbs`（转发）→ `scripts/dsh-control.ps1`（干活）。默认路径由插件用 `import.meta.url` 就地算出，**发布包里不含任何作者机器上的路径**，所以装上即用 —— 不用写脚本，也不用注册任何协议。
- 想换成你自己的处理器（例如顺便管别的服务）：`config.controlVbs` 指过去即可；`appPath` / `processName` 作为位置参数转发，不认识它们的自定义脚本会直接忽略。不配置就是内置的那份。
- 动作仍走同源 HTTP 路由 `POST /dsh-status-dot/action?action=<start|stop|restart|logs>`，白名单之外的值不转交；`wscript` 独立进程执行，1 秒延迟保证 HTTP 响应先回到页面。

### 支持 DSH 桌面端

- 桌面端（Electron 壳）不会把 `meowdsh://` 交给系统协议处理器，因此旧的「协议处理器」路径在桌面端**完全无效**（点了没反应）。新版默认走同源 HTTP 动作路由，只有在浏览器 / 旧服务端上才回退到协议。
- 主端口从请求的 `Host` 头推出来，所以 `dsh web`（默认 3080）与桌面端（默认 19387）都能直接用，不用改配置；额外服务用 `config.extraPorts` 列。

### 修掉「关闭服务」后的恢复框

- 桌面端主进程、`--type=` 辅助进程与真正监听端口的 host 子进程**同名**。只按端口杀监听者，会留下一个活着但"宿主已死"的窗口，渲染出「应用无法启动或已意外停止」。
- 随包脚本改为**一次扫掉整棵同名进程树**（单次 `Stop-Process -Id <全部 pid> -Force`）。
- `restart` **先**安排重开（默认 6 秒后）**再**停 —— 脚本自己可能被这一停带走，先排后停才保证能回来。
- `start` 依次找：配置的 `appPath` → 运行中进程的 exe 路径 → 常见安装目录；`stop` / `restart` / `start` / `logs` 都支持 `-DryRun`（只打印将要做什么，不动进程）。

### 安全属性（未放松）

- 每个端点（`status` / `log` / 控制版的 `action`）都过 DSH 自己的浏览器围栏，没有有效 cookie 一律 401；不发 CORS 头；响应体最小化；插件本身不写磁盘文件，随包处理器只把动作记录追加到 `%USERPROFILE%\.dsh\dsh-status-dot-control.log`。

### 升级方式

```bash
dsh plugin --profile web add https://raw.githubusercontent.com/StarflowDream/dsh-status-dot/main/dist/dsh-status-dot-control-1.0.1.tgz
```

装完重启 DSH（`dsh web` 或桌面端应用）。控制版与只读版注册相同路由，**二选一**。

## dsh-status-dot v1.0.0 — 2026-09-12

- 首发：会话头部状态圆点，悬停显示运行时长 / PID，点开只读面板（运行时长 / PID / 端口状态）。
- 同时发布控制版 v1.0.0：多出 启动 / 关闭 / 重启 / 日志，动作交给用户自备的 `meowdsh://` 协议处理器。
- 两个包都注册 `/dsh-status-dot/status` 与 `/dsh-status-dot/log`，全部经过 DSH 浏览器围栏。
