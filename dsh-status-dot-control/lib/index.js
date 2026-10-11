import net from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// dsh-status-dot-control -- server half. (Identical to the read-only edition's
// server half; the control actions leave this process only to be fired by the
// OS protocol handler (2026-10-11: the page asks /dsh-status-dot/action because
// the desktop app blocks meowdsh:// from the renderer). Both editions use the same endpoint paths, so install
// ONE of them, not both.)
//
// Two endpoints on the DSH web server:
//   GET  /dsh-status-dot/status  -> { alive, pid, startedAt, uptimeMs, node, ports }
//   GET  /dsh-status-dot/log     -> diagnostics ring
//   POST /dsh-status-dot/log     -> append a diagnostic line
//
// Security notes -- please keep all four properties:
//   1. Request fence. Routes registered on webServer get NO auth fence unless
//      the registrant asks for one: DSH applies its browser fence (signed cookie
//      + Host/Origin) per route, by whoever registers that route. Without the
//      fence below, a cross-site page or any local process could read these
//      endpoints (an earlier revision did exactly that). We reuse DSH's own
//      fence through connection.requestRejection() and fall back to a strict
//      same-origin check when that service is unavailable.
//   2. No CORS headers. The client half calls these paths same-origin, so
//      omitting `access-control-allow-origin` keeps other websites from reading
//      the response. (An earlier revision sent `*` next to `cwd` — that let any
//      visited page read the machine's username and working directory.)
//   3. The response carries no filesystem path, no command line and no listening
//      URL, so it cannot leak a username, a directory layout or an auth token.
//   4. Nothing is written to disk: uptime lives in this module's memory.
//
// Config (a profile's cordis.patch.yml can override it per install):
//   extraPorts: Array<number | {port,label}>   AUXILIARY services to watch, on
//     top of the main port. The main port itself is never configured: it is the
//     port this request arrived on, discovered at request time, so moving the
//     service to another port needs no config change.
//   controlVbs: string   OPTIONAL handler to run the actions. Default: the
//     generic script that ships in this package (scripts/dsh-control.vbs), which
//     is what makes the control edition install-and-use. Point it at your own
//     .vbs to route the actions into your own tooling.
//   appPath / processName: string   OPTIONAL values forwarded to that handler
//     (where to launch the app from / which process name to look for).
//
// The browser cannot reach any endpoint once the service is down, which is why
// start/stop are routed through an OS protocol handler rather than this server.

// Fallback main port, used ONLY when a request somehow carries no port in its
// Host header. Normal use never needs it: the main port is the one that
// answered, see auxPorts() below.
const DEFAULT_PORTS = [3080];

/** Last-resort same-origin check, used only when the connection service is
 * unavailable and DSH's real browser fence therefore cannot be applied. */
function sameOriginEnough(req) {
  const origin = req.headers.origin;
  if (typeof origin === 'string' && origin !== '') {
    try {
      return new URL(origin).host === req.headers.host;
    } catch {
      return false;
    }
  }
  const site = req.headers['sec-fetch-site'];
  return typeof site === 'string' && (site === 'same-origin' || site === 'none');
}

/** @returns true when the request may proceed (the fence already answered otherwise). */
function fenceRequest(req, res, connection) {
  if (connection !== undefined && connection !== null && typeof connection.requestRejection === 'function') {
    let rejection;
    try {
      rejection = connection.requestRejection(req);
    } catch {
      rejection = undefined;
    }
    if (rejection !== undefined) {
      res.writeHead(rejection);
      res.end(rejection === 401 ? 'unauthorized' : 'forbidden');
      return false;
    }
    return true;
  }
  if (!sameOriginEnough(req)) {
    res.writeHead(403);
    res.end('forbidden');
    return false;
  }
  return true;
}

function portListening(port) {
  // Cheap liveness probe: try to open a TCP connection to the local port.
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let done = false;
    const finish = (ok) => {
      if (done) return;
      done = true;
      try { socket.destroy(); } catch { }
      resolve(ok);
    };
    socket.setTimeout(400);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
    try { socket.connect(port, '127.0.0.1'); } catch { finish(false); }
  });
}

function portFromHost(host) {
  if (typeof host !== 'string' || host === '') return 0;
  const m = host.match(/:(\d+)$/);
  if (!m) return 0;
  const p = Number.parseInt(m[1], 10);
  return Number.isInteger(p) && p > 0 && p < 65536 ? p : 0;
}

// Runtime port discovery (2026-10-06, user asked: port must not be written in).
// Two SEPARATE things, deliberately:
//   · the main port  = the port THIS request arrived on. The browser showing the
//     dot is proof that port is alive, so it is never configured and never
//     guessed. `selfPort` reports it on its own.
//   · extraPorts     = optional auxiliary services the user wants watched
//     (remote entry 8898, notification relay 8899, ...). Bare numbers or
//     { port, label } objects; they are reported under their own key so the
//     panel can label them and never confuse them with the main port.
function auxPorts(config) {
  const raw = config && Array.isArray(config.extraPorts) ? config.extraPorts : [];
  const out = [];
  const seen = new Set();
  for (const item of raw) {
    const num = typeof item === 'object' && item !== null ? item.port : item;
    const p = typeof num === 'string' ? Number.parseInt(num, 10) : num;
    if (!Number.isInteger(p) || p <= 0 || p >= 65536 || seen.has(p)) continue;
    seen.add(p);
    const label = typeof item === 'object' && item !== null && typeof item.label === 'string' && item.label.trim() !== ''
      ? item.label.trim()
      : '';
    out.push({ port: p, label });
  }
  return out;
}

export const name = 'dsh-status-dot-control';

export function apply(ctx, config) {
  const startedAt = Date.now();
  const diag = [];
  const registered = [];

  // Resolved per request so a late-mounted connection service is picked up.
  const connectionOf = () => {
    try {
      return typeof ctx.get === 'function' ? ctx.get('connection') : ctx.connection;
    } catch {
      return undefined;
    }
  };

  const statusHandler = async (req, res) => {
    // Resolved per request: the main service port is the one that answered, so a
    // port change never requires editing a config file. Auxiliary services are
    // reported separately under extraPorts -- never mixed into the main port.
    const mainPort = portFromHost(req && req.headers ? req.headers.host : '') || DEFAULT_PORTS[0];
    const aux = auxPorts(config);
    const auxState = {};
    for (const a of aux) auxState[a.port] = await portListening(a.port);

    const body = JSON.stringify({
      alive: true,
      pid: process.pid,
      startedAt,
      uptimeMs: Date.now() - startedAt,
      node: process.version,
      mainPort,
      mainPortListening: await portListening(mainPort),
      selfPort: mainPort,
      extraPorts: auxState,
      extraPortLabels: aux.reduce((acc, a) => { if (a.label) acc[a.port] = a.label; return acc; }, {}),
      portSource: 'main port = request host (auto); extraPorts = config.extraPorts',
      now: Date.now(),
    });

    res.writeHead(200, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    });
    res.end(body);
  };

  // Diagnostics sink: the client half posts what happened while registering, so
  // a broken client can be debugged from outside the browser.
  const logHandler = (req, res) => {
    if (req.method === 'POST') {
      let raw = '';
      req.on('data', (chunk) => {
        raw += chunk.toString('utf8');
        if (raw.length > 20000) raw = raw.slice(0, 20000);
      });
      req.on('end', () => {
        try {
          const body = JSON.parse(raw);
          diag.push({ at: Date.now(), msg: String(body.msg ?? '').slice(0, 500) });
          if (diag.length > 200) diag.splice(0, diag.length - 200);
        } catch { /* ignore malformed reports */ }
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end('{"ok":true}');
      });
      return;
    }
    res.writeHead(200, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    });
    res.end(JSON.stringify({ diag }));
  };

  // ---- control actions over HTTP (appended 2026-10-11) ----------------------
  // WHY THIS ROUTE EXISTS: inside the DESKTOP app the product window installs
  //   webContents.setWindowOpenHandler(...) -> only http:/https: are passed to
  //                                            shell.openExternal, everything
  //                                            else gets { action: "deny" }
  //   webContents.on('will-navigate', ...)  -> preventDefault() for every URL
  //                                            that is not dsh-app: or same-origin
  //                                            http, and a non-http(s) scheme is
  //                                            not even handed to openExternal
  // so the panel button's window.open('meowdsh://stop') and its location.href
  // fallback never leave the renderer: in the desktop app every control button
  // was silently dead, while the same page in a normal browser worked (the
  // browser itself handles the unknown scheme). The page CAN still fetch its own
  // origin, so it asks this route instead; the route fires the very same
  // wscript -> dsh-control.vbs -> dsh-control.ps1 chain the /dsh-stop and
  // /dsh-restart commands already use.
  const CONTROL_ACTIONS = ['stop', 'restart', 'start', 'logs'];
  const actionHandler = (req, res) => {
    const reply = (code, body) => {
      res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
      res.end(JSON.stringify(body));
    };
    let action = '';
    try {
      action = String(new URL(req.url, 'http://localhost').searchParams.get('action') || '')
        .toLowerCase().replace(/[^a-z]/g, '');
    } catch { /* malformed URL -> falls through to the 400 below */ }
    if (!CONTROL_ACTIONS.includes(action)) {
      reply(400, { ok: false, error: 'unknown action', allowed: CONTROL_ACTIONS });
      return;
    }
    // The reply must reach the page BEFORE the handler runs: 'stop' and
    // 'restart' kill this very process. The delay lives in this process, and
    // the action itself is fired by a separate wscript process, so the page
    // always sees the response first.
    fireControlAction(action, 1000);
    reply(200, { ok: true, action, via: 'wscript ' + controlVbs, delayMs: 1000 });
  };

  // ctx.inject waits for webServer instead of a point-in-time ctx.get, so the
  // routes are registered even if webServer mounts after this row. Non-blocking:
  // a profile without webServer simply never gets the routes.
  ctx.inject(['webServer'], (wctx) => {
    const routes = [
      { path: '/dsh-status-dot/status', handler: statusHandler },
      { path: '/dsh-status-dot/log', handler: logHandler },
      { path: '/dsh-status-dot/action', handler: actionHandler },
    ];

    for (const route of routes) {
      const guarded = {
        kind: 'exact',
        path: route.path,
        handler: (req, res) => {
          if (!fenceRequest(req, res, connectionOf())) return;
          return route.handler(req, res);
        },
      };
      try {
        wctx.effect(() => wctx.webServer.register(guarded), 'dsh-status-dot-control: ' + route.path + ' route');
        registered.push(route.path);
      } catch (error) {
        ctx.logger?.warn?.('dsh-status-dot-control: failed to register ' + route.path + ': ' + String(error));
      }
    }

    const auxNames = auxPorts(config).map((a) => a.port + (a.label ? '(' + a.label + ')' : ''));
    ctx.logger?.info?.('dsh-status-dot-control: registered ' + registered.join(', ') + '; main port auto (request host); extraPorts ' + (auxNames.length ? auxNames.join(', ') : 'none'));
  });

  // ---- MEOW-CONTROL-COMMANDS (appended 2026-09-12) --------------------------
  // /dsh-stop and /dsh-restart only PULL THE TRIGGER; dsh-control.ps1 does the
  // actual stopping and relaunching.
  //
  // Why it goes through the VBS router instead of spawning powershell directly:
  // that is the SAME OS path the in-page panel button already uses and the user
  // has already proven end to end (meowdsh:// -> dsh-control.vbs ->
  // dsh-control.ps1), and WScript.Shell.Run starts the script hidden and
  // without waiting. Measured on Windows 2026-09-12: spawning powershell with
  // detached:true makes it exit silently with code 0 without running anything,
  // and without detached the child dies with this process -- so neither plain
  // spawn shape can be trusted to survive the very stop/restart it triggers.
  //
  // The 2 s delay deliberately lives HERE, in this process, so the command's
  // reply reaches the browser before anything is killed.
  //
  // There is deliberately NO "start" command: with the service down no plugin
  // is left to receive one -- use the in-page panel button (the page lives in
  // the browser, not in this process) or the desktop shortcut.
  //
  // child_process is resolved lazily inside the handler via
  // process.getBuiltinModule(), so there is no import statement and nothing at
  // module-load time can throw: the worst case is a command reporting an error.
  // The default handler SHIPS WITH THIS PACKAGE (scripts/dsh-control.vbs +
  // dsh-control.ps1), so the control edition works out of the box: no protocol
  // handler to register, no script of your own, nothing machine-specific. A
  // config.controlVbs still wins, for installs that route actions elsewhere.
  const controlVbs = typeof config?.controlVbs === 'string' && config.controlVbs.trim() !== ''
    ? config.controlVbs.trim()
    : join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'dsh-control.vbs');
  const controlAppPath = typeof config?.appPath === 'string' ? config.appPath.trim() : '';
  const controlProcessName = typeof config?.processName === 'string' ? config.processName.trim() : '';

  const fireControlAction = (action, delayMs) => {
    const timer = setTimeout(() => {
      try {
        // The optional values go along as extra positional arguments. A handler
        // that does not know them ignores them (the shipped .vbs reads [1] and
        // [2]), and no shell is involved: spawn passes the argv verbatim.
        const child = process.getBuiltinModule('node:child_process').spawn('wscript.exe',
          [controlVbs, 'meowdsh://' + action, controlAppPath, controlProcessName],
          { stdio: 'ignore', windowsHide: true });
        child.unref();
      } catch { /* the reply already went out; there is nowhere left to report */ }
    }, delayMs);
    if (typeof timer.unref === 'function') timer.unref();
  };

  const controlCommandDefinition = (name, description, action, note) => ({
    name,
    description,
    async handler() {
      try {
        fireControlAction(action, 2000);
        return { kind: 'success', text: note + '（2 秒后由独立进程执行）' };
      } catch (error) {
        return { kind: 'error', text: '触发失败：' + String(error).slice(0, 120) };
      }
    },
  });

  try {
    ctx.inject(['commands'], (cctx) => {
      const definitions = [
        controlCommandDefinition('dsh-stop', '关闭 DSH 服务（3080）——页面不会死，可用面板 ▶ 拉回', 'stop', '正在关闭 DSH 服务…'),
        controlCommandDefinition('dsh-restart', '重启 DSH 服务（3080）——当前会话会断开', 'restart', '正在重启 DSH 服务…'),
      ];
      for (const definition of definitions) {
        try {
          cctx.effect(() => cctx.commands.register(definition), 'dsh-status-dot-control: /' + definition.name);
          ctx.logger?.info?.('dsh-status-dot-control: registered /' + definition.name);
        } catch (error) {
          ctx.logger?.warn?.('dsh-status-dot-control: failed to register /' + definition.name + ': ' + String(error));
        }
      }
    });
  } catch (error) {
    ctx.logger?.warn?.('dsh-status-dot-control: commands injection failed: ' + String(error));
  }

  return () => { /* nothing to clean up */ };
}
