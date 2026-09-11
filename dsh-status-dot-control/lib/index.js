import net from 'node:net';

// dsh-status-dot-control -- server half. (Identical to the read-only edition's
// server half; the control actions never touch this process, they leave through
// the OS protocol handler. Both editions use the same endpoint paths, so install
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
//   ports: number[]   ports to probe, default [3080]
//
// The browser cannot reach any endpoint once the service is down, which is why
// start/stop are routed through an OS protocol handler rather than this server.

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

function normalizePorts(config) {
  const raw = config && Array.isArray(config.ports) ? config.ports : null;
  if (!raw) return DEFAULT_PORTS;
  const clean = raw.filter((p) => Number.isInteger(p) && p > 0 && p < 65536);
  return clean.length > 0 ? clean : DEFAULT_PORTS;
}

export const name = 'dsh-status-dot-control';

export function apply(ctx, config) {
  const startedAt = Date.now();
  const ports = normalizePorts(config);
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
    const portState = {};
    for (const p of ports) portState[p] = await portListening(p);

    const body = JSON.stringify({
      alive: true,
      pid: process.pid,
      startedAt,
      uptimeMs: Date.now() - startedAt,
      node: process.version,
      ports: portState,
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

  // ctx.inject waits for webServer instead of a point-in-time ctx.get, so the
  // routes are registered even if webServer mounts after this row. Non-blocking:
  // a profile without webServer simply never gets the routes.
  ctx.inject(['webServer'], (wctx) => {
    const routes = [
      { path: '/dsh-status-dot/status', handler: statusHandler },
      { path: '/dsh-status-dot/log', handler: logHandler },
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

    ctx.logger?.info?.('dsh-status-dot-control: registered ' + registered.join(', ') + '; probing ports ' + ports.join(', '));
  });

  return () => { /* nothing to clean up */ };
}
