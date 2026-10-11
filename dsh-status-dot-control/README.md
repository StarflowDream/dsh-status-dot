# dsh-status-dot-control

[DeepSeek Harness](https://github.com/deepseek-ai/dsh) 会话头部的状态圆点（**控制版**）：一眼看出本地 DSH 服务是否存活 —— 悬停看运行时长 / PID，点开是面板，另带 **启动 / 关闭 / 重启 / 日志** 四个动作，**装完即用**。

> 这是**控制版**。只读版 [`dsh-status-dot`](https://github.com/StarflowDream/dsh-status-dot/tree/main/dsh-status-dot) 有同样的圆点与面板，但代码里根本不存在控制通道。两个包注册**相同的 HTTP 路由**，**只装其中一个**。

## 安装

安装物是挂在 [Release](https://github.com/StarflowDream/dsh-status-dot/releases) 上的 tarball，一条命令（不需要 git）：

```bash
dsh plugin --profile web add https://github.com/StarflowDream/dsh-status-dot/releases/download/v1.0.4/dsh-status-dot-control-1.0.4.tgz
```

装完**必须重启 DSH**（`dsh web` 或桌面端应用）—— 插件的 bundle 只在启动时并入 profile 层栈。圆点出现在每个会话的头部（欢迎页没有会话头部，先打开一条会话）。

不要用仓库 tarball（`.../tar.gz/<sha>`）：两个包在子目录里，压缩包根目录没有 `package.json`，pnpm 会直接失败。

## 配置

在 `$DSH_HOME/profiles/<profile>/cordis.patch.yml` 里按 profile 配置：

```yaml
- id: dsh-status-dot-control
  config:
    enabled: true
    ports: [3080]             # 要探测的端口，默认 [3080]（主端口实际上从请求推出来，见下）
    extraPorts: [8898, 8899]  # 可选：额外顺带盯的服务，支持 [{ port: 8898, label: phone-login }]
    # controlVbs: 'D:\your\path\dsh-control.vbs'      # 可选：换成你自己的处理器
    # appPath: 'D:\your\path\DeepSeek Harness.exe'    # 可选：start 找不到 exe 时才需要
    # processName: 'DeepSeek Harness'                 # 可选：进程名不同时才需要
```

主端口不是写死的：按 `req.socket.localPort` → `Host` 头 → 默认值排序取，所以 `dsh web`（默认 3080）与 **DSH 桌面端**（默认 19387）都能直接用，换端口、两个入口同时开着也不影响；响应里的 `portSource` 说明这次用了哪一个。

## 四个动作怎么走

插件**自己不启停任何东西**，它只负责把动作交出去。两条路，优先第一条。

**① 同源 HTTP 动作路由（默认路径）**：`POST /dsh-status-dot/action?action=<start|stop|restart|logs>`。与状态端点走同一套 DSH 浏览器围栏（没有有效 cookie 一律 401），非 POST 一律 405。命中后隔 1 秒，用独立进程执行处理器脚本：

```
wscript.exe <controlVbs> meowdsh://<动作> [appPath] [processName]
```

- 1 秒延迟刻意留在服务端进程里，好让 HTTP 响应先回到页面再动手。
- 经 `wscript` 而不是直接 `spawn`：实测在 Windows 上 `spawn` 起 powershell 加 `detached:true` 会**静默退出、exit 0、什么都不跑**，不加 detached 又会随本进程一起死。
- 动作白名单是 `start` / `stop` / `restart` / `logs`，其它值不会被转交。

**② `meowdsh://` 协议处理器（回退路径）**：HTTP 那条走不通时（旧版插件、服务端半边不在、普通浏览器里）才用。桌面端（Electron 壳）不会把 `meowdsh://` 交给系统协议处理器，所以桌面端实际走的一直是第一条。

**默认处理器＝随包自带的脚本**（`scripts/dsh-control.vbs` → `scripts/dsh-control.ps1`）。它的路径由插件用 `import.meta.url` 就地算出，包里不含任何作者机器上的路径，所以**装上就能用**：不用自己写脚本，也不用注册协议。它做的事：

- `stop`：把该 app 的**全部同名进程一次性强杀**。主进程、`--type=` 辅助进程和监听端口的 host 子进程镜像名相同，而只有 host 子进程监听端口；只杀监听者会留下一个活着但「宿主已死」的窗口，渲染出「应用无法启动或已意外停止」。
- `restart`：**先**安排 `relaunch`（先等旧进程真的消失，最多 25 秒，再启动），**再**停 —— 这个脚本本身可能被这一停带走，先排后停才保证能回来。
- `start`：已在跑就跳过；否则依次找配置的 `appPath` → 运行中进程的 exe 路径 → 常见安装目录（`%LOCALAPPDATA%\Programs`、`%ProgramFiles%` 等）下的 `DeepSeek Harness.exe`。
- `logs`：打开日志目录。`status`：只报告发现了什么（安全，测试与探针用）。
- 自己的动作记录写在 `%USERPROFILE%\.dsh\dsh-status-dot-control.log`；四个动作都支持 `-DryRun`（只打印将要做什么，不动进程）。

想接自己的处理器（例如顺便管别的服务）就覆盖 `controlVbs`；`appPath` / `processName` 会作为额外位置参数交给处理器（不经 shell 拼串），不认识这两个参数的自定义 handler 会直接忽略它们。

## 需要什么

- Node **>= 20.16**：低于它没有 `process.getBuiltinModule`，动作路由会直接回 500 并说明原因。
- Windows：随包处理器是 `.vbs` + PowerShell。

## 安全属性

- 每个端点（`status` / `log` / `action`）都过 DSH 自己的浏览器围栏，没有有效 cookie 一律 401；不发 CORS 头；响应体最小化，`via` 只回文件名、不回绝对路径。
- 动作白名单之外的值不转交；`appPath` / `processName` 含双引号直接拒绝（会撕开参数列表）；围栏遇到非数字的 rejection 值回落到 403。
- 插件本身不写磁盘文件 —— 唯一的落盘是随包处理器追加的那条动作日志。

## License

MIT，见 [LICENSE](./LICENSE)。逐版本更新记录见 [CHANGELOG.md](./CHANGELOG.md)。
