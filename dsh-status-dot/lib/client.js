window.__ModuleLoader__.load({
  id: 'dsh-status-dot',
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;

    // ---- config -----------------------------------------------------------
    // NOTE: const declarations must come BEFORE any use. Declaring BUILD after
    // the log() call below threw "Cannot access 'BUILD' before initialization"
    // (temporal dead zone) and took the whole DSH UI down with it.
    const BUILD = 'dot-v10';             // bump on every client change
    const LOG_URL = '/dsh-status-dot/log';
    const STATUS_URL = '/dsh-status-dot/status';
    const POLL_MS = 3000;
    // This is the READ-ONLY edition: it contains no control channel at all, so
    // it provably cannot start, stop or restart anything. The control edition
    // lives in a separate package (dsh-status-dot-control).
    //
    // Two hard-won rendering rules for this host, both established with zoomed
    // screenshots rather than computed styles:
    //   · every dot is inline SVG — CSS shapes get mangled by host styles (a
    //     <span>+CSS dot turned into a box, and a `border-radius:50%` +
    //     box-shadow ring painted as a rounded SQUARE even though computed
    //     style reported 50%)
    //   · the dot button carries no `title` attribute — it makes the OS draw a
    //     second, native tooltip next to the custom one

    // ---- tiny remote logger (posts to the server half, so I can read it) --
    const log = (msg) => {
      try { console.log('[dsh-status-dot]', msg); } catch (e) { }
      try {
        fetch(LOG_URL, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ msg: String(msg) }),
        }).catch(() => { });
      } catch (e) { }
    };

    // PATHNAME only, never href: a DSH web URL can carry `?token=...`, and this
    // text is served back over HTTP by /dsh-status-dot/log.
    const pagePath = (typeof window !== 'undefined' && window.location) ? window.location.pathname : '?';
    log('module evaluated; BUILD=' + BUILD + '; page=' + pagePath);

    // ---- react ------------------------------------------------------------
    let React = null;
    try {
      React = require('react');
      log('require("react") ok; keys=' + Object.keys(React || {}).slice(0, 8).join(','));
    } catch (e) {
      log('require("react") FAILED: ' + (e && e.message ? e.message : String(e)));
    }
    const h = React ? React.createElement : null;

    // ---- helpers ----------------------------------------------------------
    const fmtUptime = (ms) => {
      if (ms === null || ms === undefined) return '—';
      const s = Math.floor(ms / 1000);
      const d = Math.floor(s / 86400);
      const hh = Math.floor((s % 86400) / 3600);
      const mm = Math.floor((s % 3600) / 60);
      if (d > 0) return d + 'd ' + hh + 'h';
      if (hh > 0) return hh + 'h ' + mm + 'm';
      if (mm > 0) return mm + 'm ' + (s % 60) + 's';
      return s + 's';
    };

    const useStatus = () => {
      const [state, setState] = React.useState({ phase: 'init', data: null });
      React.useEffect(() => {
        let cancelled = false;
        let timer = null;
        let announced = false;
        const tick = async () => {
          try {
            const res = await fetch(STATUS_URL, { cache: 'no-store' });
            if (!res.ok) throw new Error('HTTP ' + res.status);
            const data = await res.json();
            if (!cancelled) setState({ phase: 'online', data });
            if (!announced) { announced = true; log('poll ok: ' + JSON.stringify(data).slice(0, 150)); }
          } catch (e) {
            if (!cancelled) setState((prev) => ({ phase: 'offline', data: prev.data }));
            if (!announced) { announced = true; log('poll failed: ' + (e && e.message ? e.message : String(e))); }
          }
          if (!cancelled) timer = window.setTimeout(tick, POLL_MS);
        };
        tick();
        return () => { cancelled = true; if (timer) window.clearTimeout(timer); };
      }, []);
      return state;
    };

    // ---- status dot -------------------------------------------------------
    // ONE flat dot shape reused everywhere (header button + panel header + every
    // port row): a solid core inside a flat translucent halo, drawn as inline
    // SVG. Two reasons it is SVG: host CSS used to square off a styled <span>,
    // and the halo has to stay readable at a glance — the defaults below give a
    // 10px core inside an 18px halo.
    const TONE = {
      on: { core: '#22c55e', halo: 'rgba(34,197,94,0.22)' },
      off: { core: '#ef4444', halo: 'rgba(239,68,68,0.22)' },
      idle: { core: '#a1a1aa', halo: 'rgba(161,161,170,0.22)' },
    };
    // dot(tone, corePx, haloPx, ringOn)
    //   corePx = diameter of the solid core, haloPx = diameter of the flat halo.
    //   ringOn = draw the "panel is open" ring INSIDE the svg.
    //   The ring used to be a CSS box-shadow + border-radius:50%; computed styles
    //   claimed 50% but it still PAINTED AS A ROUNDED SQUARE (verified with a 6x
    //   zoom screenshot). Anything CSS-drawn is at the mercy of the host
    //   stylesheet, so the ring is a vector circle now. The svg box always
    //   reserves the ring's space so the layout does not jump when toggling.
    const dot = (toneKey, corePx, haloPx, ringOn) => {
      const core = corePx || 10;
      const halo = haloPx || 18;
      const ringW = 2;
      const box = halo + ringW * 2 + 2;
      const c = box / 2;
      const t = TONE[toneKey] || TONE.idle;
      const kids = [
        h('circle', { key: 'halo', cx: c, cy: c, r: halo / 2, fill: t.halo }),
        h('circle', { key: 'core', cx: c, cy: c, r: core / 2, fill: t.core }),
      ];
      if (ringOn) {
        kids.push(h('circle', {
          key: 'ring', cx: c, cy: c, r: halo / 2 + ringW / 2 + 1,
          fill: 'none', stroke: 'rgba(255,255,255,0.34)', strokeWidth: ringW,
        }));
      }
      return h('svg', {
        width: box, height: box, viewBox: '0 0 ' + box + ' ' + box,
        style: { display: 'block', flex: '0 0 auto', overflow: 'visible' },
        'aria-hidden': 'true',
      }, kids);
    };

    // ---- styles -----------------------------------------------------------
    const rowStyle = { display: 'flex', gap: 10, alignItems: 'center', lineHeight: 1.45 };
    const keyStyle = { color: '#8b8b8b', minWidth: 44, flex: '0 0 auto' };
    const valStyle = { color: '#f4f4f5', fontVariantNumeric: 'tabular-nums' };
    const portRowStyle = { display: 'inline-flex', alignItems: 'center', gap: 12 };
    const portItemStyle = { display: 'inline-flex', alignItems: 'center', gap: 5 };
    const panelStyle = {
      position: 'absolute', top: 'calc(100% + 8px)', right: 0, zIndex: 2147483000,
      minWidth: 248, padding: '12px 14px', borderRadius: 14,
      border: '1px solid rgba(255,255,255,0.10)',
      background: 'rgba(24,24,27,0.96)',
      backdropFilter: 'blur(14px)', WebkitBackdropFilter: 'blur(14px)',
      color: '#e5e5e5', fontSize: 12,
      boxShadow: '0 16px 40px rgba(0,0,0,0.55)',
    };
    const bubbleStyle = {
      position: 'absolute', top: 'calc(100% + 8px)', right: 0, zIndex: 2147483000,
      whiteSpace: 'nowrap', padding: '6px 10px', borderRadius: 10,
      border: '1px solid rgba(255,255,255,0.10)',
      background: 'rgba(24,24,27,0.96)',
      backdropFilter: 'blur(14px)', WebkitBackdropFilter: 'blur(14px)',
      color: '#f4f4f5', fontSize: 12, boxShadow: '0 10px 28px rgba(0,0,0,0.5)',
      pointerEvents: 'none',
    };

    // ---- component --------------------------------------------------------
    const buildComponent = () => {
      const StatusDot = () => {
        const state = useStatus();
        const [open, setOpen] = React.useState(false);
        const [hover, setHover] = React.useState(false);
        const wrapRef = React.useRef(null);
        const online = state.phase === 'online';
        const unknown = state.phase === 'init';
        const tone = online ? 'on' : (unknown ? 'idle' : 'off');
        const d = state.data || {};

        React.useEffect(() => {
          if (!open) return undefined;
          const onDoc = (ev) => { if (wrapRef.current && !wrapRef.current.contains(ev.target)) setOpen(false); };
          document.addEventListener('mousedown', onDoc);
          return () => document.removeEventListener('mousedown', onDoc);
        }, [open]);

        const tooltip = online
          ? 'DSH 服务在线 · 已运行 ' + fmtUptime(d.uptimeMs) + ' · PID ' + d.pid
          : unknown ? '正在检测 DSH 服务…' : 'DSH 服务离线（后端未运行）';

        const panel = h('div', { style: panelStyle },
          h('div', { style: { display: 'flex', alignItems: 'center', gap: 9 } },
            dot(tone, 9, 16),
            h('strong', { style: { fontSize: 13, fontWeight: 600 } },
              online ? 'DSH 运行中' : (unknown ? '检测中…' : 'DSH 已离线'))),
          online ? h('div', {
            style: {
              marginTop: 11, paddingTop: 10, display: 'grid', gap: 7,
              borderTop: '1px solid rgba(255,255,255,0.07)',
            },
          },
            h('div', { style: rowStyle }, h('span', { style: keyStyle }, '运行'), h('span', { style: valStyle }, fmtUptime(d.uptimeMs))),
            h('div', { style: rowStyle }, h('span', { style: keyStyle }, 'PID'), h('span', { style: valStyle }, String(d.pid ?? '—'))),
            h('div', { style: rowStyle }, h('span', { style: keyStyle }, '端口'), h('span', { style: portRowStyle },
              Object.keys(d.ports || {}).map((p) => h('span', { key: p, style: portItemStyle },
                dot(d.ports[p] ? 'on' : 'off', 7, 12),
                h('span', { style: valStyle }, p))))),
            // The Node version row is gone on purpose: a status dot should answer
            // "is it alive, are the ports up" and nothing else. /dsh-status-dot/status
            // still returns `node` for anyone who actually needs it.
          ) : null,
          online ? null : h('div', {
            style: { marginTop: 10, color: '#d4b357', fontSize: 12 },
          }, '后端未运行，暂无 PID / 端口信息'),
        );

        return h('div', {
          ref: wrapRef,
          style: { position: 'relative', display: 'flex', alignItems: 'center' },
          onMouseEnter: () => setHover(true),
          onMouseLeave: () => setHover(false),
        },
          h('button', {
            type: 'button',
            // Deliberately NO `title`: it makes the OS draw a SECOND, native
            // tooltip next to the custom one — and because the OS paints it, it
            // never lands in a screenshot, which makes that bug easy to miss.
            // aria-label carries the same text for screen readers.
            'aria-label': tooltip,
            onClick: () => setOpen((v) => !v),
            // The slot rejects a plain <div> (the dot vanished), so this stays a
            // <button> — stripped bare so it never renders as a box. The "open"
            // indicator is a circular ring via box-shadow: `outline` followed the
            // button box and drew a rounded RECTANGLE around the dot.
            style: {
              appearance: 'none',
              WebkitAppearance: 'none',
              border: 'none',
              background: 'transparent',
              padding: 3,
              margin: 0,
              lineHeight: 0,
              fontSize: 0,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              color: 'inherit',
              borderRadius: '50%',
              // No CSS ring here on purpose: the open indicator is drawn inside the
              // svg (see dot()) because a box-shadow ring painted as a rounded square.
            },
          }, dot(tone, 10, 18, open)),
          (hover && !open) ? h('div', { style: bubbleStyle }, tooltip) : null,
          open ? panel : null,
        );
      };
      return StatusDot;
    };

    // ---- registration -----------------------------------------------------
    const inject = ['slots'];

    function apply(ctx) {
      const disposers = [];
      try { log('apply() called; ctx keys=' + Object.keys(ctx || {}).join(',')); } catch (e) { }

      let slots;
      try {
        slots = ctx.slots;
        log('ctx.slots type=' + typeof slots + '; keys=' + (slots ? Object.keys(slots).join(',') : 'null'));
      } catch (e) {
        log('cannot read ctx.slots: ' + (e && e.message ? e.message : String(e)));
        return () => { };
      }
      if (!slots || typeof slots.inject !== 'function') {
        log('ABORT: slots.inject is not a function');
        return () => { };
      }

      let Component = null;
      if (React && h) {
        try { Component = buildComponent(); log('component built ok'); }
        catch (e) { log('component build FAILED: ' + (e && e.message ? e.message : String(e))); }
      } else {
        log('ABORT: React unavailable');
      }
      if (!Component) return () => { };

      const CANDIDATES = [
        'conversation.session.header.utilities',
        'conversation.session.header.actions',
        'conversation.session.header',
        'conversation.input.model',
        'sidebar',
      ];

      for (const slotName of CANDIDATES) {
        try {
          const ret = slots.inject(slotName, () => {
            log('slot available -> registering into ' + slotName);
            // A "list" slot (like .utilities) requires a stable id; some builds
            // spell it `key`. Try both, then progressively drop options.
            const attempts = [
              { name: slotName, id: 'dsh-status-dot', key: 'dsh-status-dot' },
              { name: slotName, id: 'dsh-status-dot' },
              { name: slotName, key: 'dsh-status-dot' },
              { name: slotName },
            ];
            for (const opts of attempts) {
              try {
                const r = slots.register(opts, Component);
                if (typeof r === 'function') disposers.push(r);
                log('register OK for ' + slotName + ' opts=' + JSON.stringify(opts) + ' (returned ' + typeof r + ')');
                return;
              } catch (e) {
                log('register threw opts=' + JSON.stringify(opts) + ': ' + (e && e.message ? e.message : String(e)));
              }
            }
          });
          if (typeof ret === 'function') disposers.push(ret);
          log('inject(' + slotName + ') attached');
          break;
        } catch (e) {
          log('inject THREW for ' + slotName + ': ' + (e && e.message ? e.message : String(e)));
        }
      }

      return () => { disposers.forEach((fn) => { try { fn(); } catch (e) { } }); };
    }

    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  },
});
