# dsh-status-dot

[DeepSeek Harness](https://github.com/deepseek-ai/dsh) 会话头部的状态圆点：一眼看出本地 DSH 服务是否存活；鼠标悬停显示运行时长 / PID；点开是一个只读小面板（运行时长 / PID / 端口状态）。

本仓库提供**两个各自独立的包**，**只装其中一个**：

| 包 | 做什么 | 控制动作 |
|---|---|---|
| [`dsh-status-dot`](./dsh-status-dot) | 圆点 + 悬停气泡 + 只读面板 | **完全没有** —— 代码里根本不存在控制通道 |
| [`dsh-status-dot-control`](./dsh-status-dot-control) | 同样的圆点与面板，另有 启动 / 关闭 / 重启 / 日志 | 交给你自己的 `meowdsh://` 协议处理程序 |

两个包注册**相同的 HTTP 路由**，所以不建议同时安装 —— 二选一。

---

## 安装

两个版本都以「可直接安装的 tarball」放在 `dist/` 下，一条命令即可（**不需要 git**）：

```bash
# 只读版
dsh plugin --profile web add https://raw.githubusercontent.com/StarflowDream/dsh-status-dot/main/dist/dsh-status-dot-1.0.0.tgz

# 控制版（与上面二选一）
dsh plugin --profile web add https://raw.githubusercontent.com/StarflowDream/dsh-status-dot/main/dist/dsh-status-dot-control-1.0.0.tgz
```

⚠️ **不要用仓库 tarball**（`.../tar.gz/<sha>`）：本仓库两个包在子目录里，压缩包根目录没有 `package.json`，pnpm 会直接失败。请用上面的 `dist/` 包。

从本地目录安装：

```bash
dsh plugin --profile web add file:/path/to/dsh-status-dot/dsh-status-dot
```

装完**必须重启 `dsh web`** —— 插件 bundle 只在启动时并入 profile 层栈。圆点出现在每个会话的头部（欢迎页没有会话头部，先打开一条会话）。

## 配置

在 `$DSH_HOME/profiles/<profile>/cordis.patch.yml` 里按 profile 配置：

```yaml
- id: dsh-status-dot          # 装控制版就写 dsh-status-dot-control
  config:
    enabled: true
    ports: [3080]             # 要探测的端口，默认 [3080]
```

## 控制版需要自己配脚本

控制版**自己不会启停任何东西**：它只是打开 `meowdsh://<动作>`（`start` / `stop` / `restart` / `logs`），由操作系统交给**你自己的处理器脚本**。没有注册处理器时，点按钮什么也不会发生。

Windows 上的做法是注册一个 `HKCU\Software\Classes\meowdsh` 协议项，指向为你的环境做实际启停的脚本。若你已用别的协议名，改 `dsh-status-dot-control/lib/client.js` 里的 `PROTOCOL_BASE` 即可。

## 安全与隐私

两个版本都是刻意做小的，下面几条是**设计约束**，改动时请保持：

- **完全没有对外网络通信。** 客户端只调同源的相对路径；服务端只对 `127.0.0.1:<配置的端口>` 做 TCP 探测。没有遥测、没有统计、没有远程日志 —— **你的 API key / token 不可能经由这个插件离开本机。**
- **路由走 DSH 自己的浏览器围栏。** 直接注册在 `webServer` 上的路由默认没有鉴权，所以两个端点都调用 `connection.requestRejection(req)`，并在该服务不可用时退回严格同源检查。**没有有效 DSH cookie 的请求一律 401。**
- **不发 CORS 头。** 客户端本来就是同源请求，所以故意不写 `Access-Control-Allow-Origin` —— 其他网站读不到这些响应。
- **响应体最小化。** 只有 `{ alive, pid, startedAt, uptimeMs, node, ports }` —— 不含文件路径、不含命令行、不含监听 URL，因此泄漏不出用户名或目录结构。
- **不写任何磁盘文件。**
- 破坏性操作（关闭 / 重启）先弹确认框；只读版里根本没有这类代码。

## 开发笔记：这个宿主的两个坑

（都是用放大截图验证出来的，不看 computed style）

- **形状一律用 SVG 画，别用 CSS 画。** 一个加了样式的 `<span>` 圆点会被宿主样式变成方框；而 `border-radius:50%` + `box-shadow` 画的圆环**实际渲染成圆角方形**，尽管 `getComputedStyle()` 返回的是 `50%`。
- **圆点按钮上不要加 `title`。** 操作系统会额外画一个原生 tooltip，于是同时出现两个提示框；而且因为它是 OS 绘制的，**截图里根本拍不到**。

## 许可

MIT —— 见 [LICENSE](./LICENSE)。

---

## English summary

A status dot for the DeepSeek Harness conversation header: hover for uptime/PID, click for a read-only panel (uptime / PID / port state). This repository ships **two self-contained packages** — `dsh-status-dot` (read-only; contains no control channel at all) and `dsh-status-dot-control` (adds start / stop / restart / logs, forwarded to your own `meowdsh://` protocol handler). Install exactly one of them: both register the same HTTP routes. Install from the tarballs in `dist/` (a plain repository tarball will not work — the packages live in subdirectories). Restart `dsh web` afterwards. Security properties are load-bearing and documented in the Chinese section above: no outbound network traffic, routes pass through DSH's own browser fence (401 without a cookie), no CORS headers, minimal response body, nothing written to disk.
