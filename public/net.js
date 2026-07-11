// Network transport for the two-player mode. Game-agnostic: a websocket
// wrapper with typed dispatch, a server-clock offset estimator, a snapshot
// ring buffer for entity interpolation, and the sessionStorage resume token
// that survives the track-change reload.

export const NET = {
  ws: null,
  offset: 0, // serverTime ≈ performance-independent Date.now() + offset
  _handlers: new Map(),
  _pings: [],

  connected() { return this.ws && this.ws.readyState === WebSocket.OPEN; },

  connect(timeoutMs = 12000) {
    if (this.connected()) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
      let ws;
      try { ws = new WebSocket(`${proto}//${location.host}/ws`); }
      catch (e) { return reject(e); }
      // Timeout subtlety: a busy main thread (first render, shader compile)
      // delays the open-event dispatch past any deadline, and readyState
      // only becomes OPEN in that same dispatch — so a timer that fires
      // while CONNECTING can't tell "slow page" from "dead network". Extend
      // instead of rejecting: real failures fire onerror promptly, and once
      // the thread unblocks the queued open event wins the extended race.
      let settled = false;
      let extensions = 2;
      let timer;
      const deadline = () => {
        timer = setTimeout(() => {
          if (settled) return;
          if (ws.readyState === WebSocket.CONNECTING && extensions-- > 0) return deadline();
          if (ws.readyState === WebSocket.OPEN) return;   // onopen is queued
          settled = true;
          ws.close();
          reject(new Error('timeout'));
        }, timeoutMs);
      };
      deadline();
      ws.onopen = () => {
        if (settled) return;
        clearTimeout(timer);
        this.ws = ws;
        this._syncClock();
        // app-level keepalive: browsers under load can miss protocol pings,
        // and an idle lobby sends nothing — this keeps the server's quiet
        // counter at zero (and the clock offset fresh) either way
        this._ka = setInterval(() => this.send({ t: 'ping', ct: Date.now() }), 8000);
        resolve();
      };
      ws.onerror = () => { clearTimeout(timer); reject(new Error('connect failed')); };
      ws.onmessage = (ev) => {
        let m;
        try { m = JSON.parse(ev.data); } catch { return; }
        if (!m || !m.t) return;
        if (m.t === 'pong') return this._onPong(m);
        const h = this._handlers.get(m.t);
        if (h) h(m);
      };
      ws.onclose = () => {
        clearInterval(this._ka);
        if (this.ws === ws) {
          this.ws = null;
          const h = this._handlers.get('_closed');
          if (h) h({});
        }
      };
    });
  },

  close() {
    clearInterval(this._ka);
    if (this.ws) {
      const ws = this.ws;
      this.ws = null; // silence the _closed handler for deliberate exits
      try { ws.close(); } catch { /* already dead */ }
    }
  },

  send(msg) {
    if (this.connected()) this.ws.send(JSON.stringify(msg));
  },

  on(type, fn) { this._handlers.set(type, fn); },

  // Three pings; the sample with the lowest RTT gives the best offset
  // estimate (offset = serverNow - (sent + rtt/2)).
  _syncClock() {
    this._pings = [];
    for (let i = 0; i < 3; i++) {
      setTimeout(() => this.send({ t: 'ping', ct: Date.now() }), i * 120);
    }
  },
  _onPong(m) {
    const now = Date.now();
    const rtt = now - m.ct;
    this._pings.push({ rtt, offset: m.st - (m.ct + rtt / 2) });
    this._pings.sort((a, b) => a.rtt - b.rtt);
    this.offset = this._pings[0].offset;
  },
  // convert a server timestamp into local Date.now() terms
  toLocal(serverT) { return serverT - this.offset; },
};

// Ring buffer of timed snapshots for one entity. sampleAt() interpolates
// between the two snapshots bracketing t (track-position field `s` uses
// wrap-aware shortest-path deltas), or extrapolates from the newest one,
// capped so a silent peer freezes rather than sails off.
export class SnapshotBuffer {
  constructor(trackLen, size = 12) {
    this.L = trackLen;
    this.size = size;
    this.buf = [];
    this.lastSeq = -1;
  }
  push(snap) {
    if (snap.n <= this.lastSeq) return; // drop out-of-order
    this.lastSeq = snap.n;
    this.buf.push(snap);
    if (this.buf.length > this.size) this.buf.shift();
  }
  wrapDelta(b, a) {
    const L = this.L;
    return ((b - a + 1.5 * L) % L) - 0.5 * L;
  }
  sampleAt(t, extrapCapMs = 250) {
    const b = this.buf;
    if (!b.length) return null;
    if (b.length === 1 || t <= b[0].tArr) return { ...b[0] };
    for (let i = b.length - 1; i >= 1; i--) {
      if (b[i - 1].tArr <= t && t <= b[i].tArr) {
        const a = b[i - 1], z = b[i];
        const f = (t - a.tArr) / Math.max(1, z.tArr - a.tArr);
        return {
          ...z,
          s: (a.s + this.wrapDelta(z.s, a.s) * f + this.L) % this.L,
          x: a.x + (z.x - a.x) * f,
        };
      }
    }
    // past the newest snapshot: extrapolate along the track, capped
    const z = b[b.length - 1];
    const dtMs = Math.min(t - z.tArr, extrapCapMs);
    return { ...z, s: (z.s + z.v * (dtMs / 1000) + this.L) % this.L, stale: t - z.tArr > extrapCapMs };
  }
}

// Resume record: written just before a track-change reload so the reloaded
// page can reclaim its seat. sessionStorage is per-tab, which is exactly
// the scope we want.
const RESUME_KEY = 'pp_mp_resume';
const RELOAD_GUARD_KEY = 'pp_mp_reload';

export function saveResume(rec) {
  try { sessionStorage.setItem(RESUME_KEY, JSON.stringify(rec)); } catch { /* blocked */ }
}
export function takeResume() {
  try {
    const raw = sessionStorage.getItem(RESUME_KEY);
    if (!raw) return null;
    sessionStorage.removeItem(RESUME_KEY);
    return JSON.parse(raw);
  } catch { return null; }
}

// Reload-loop guard: remember which track we already reloaded for. A second
// reload targeting the same track means storage is blocked — don't spin.
export function guardReload(track) {
  try {
    const raw = sessionStorage.getItem(RELOAD_GUARD_KEY);
    if (raw && JSON.parse(raw).track === track) return false;
    sessionStorage.setItem(RELOAD_GUARD_KEY, JSON.stringify({ track, ts: Date.now() }));
    return true;
  } catch { return false; }
}
export function clearReloadGuard() {
  try { sessionStorage.removeItem(RELOAD_GUARD_KEY); } catch { /* blocked */ }
}
