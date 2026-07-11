const express = require('express');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));

// the 2D version was retired; keep old links working
app.get(['/classic', '/classic/*splat'], (req, res) => res.redirect(301, '/'));

const server = app.listen(PORT, () => {
  console.log(`Pole Position running on port ${PORT}`);
});

// ---------------------------------------------------------------------------
// Two-player rooms. The server is a relay only: it pairs two sockets, stores
// the host's race config, coordinates the synchronized start, and declares
// the winner from finish-message arrival order. It never simulates the game.
// ---------------------------------------------------------------------------
const wss = new WebSocketServer({ server, path: '/ws' });
const rooms = new Map(); // code -> room

// no 0/O/1/I/L: codes get read aloud and retyped
const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const RESUME_GRACE = 45e3;      // reconnect window during lobby/starting
const EXPIRE_UNJOINED = 15 * 60e3;
const EXPIRE_IDLE = 30 * 60e3;
const EXPIRE_DONE = 5 * 60e3;

const DEF_CONFIG = { track: 'fuji', laps: 3, cpus: 7 };
const TRACK_IDS = ['fuji', 'seaside', 'canyon', 'neon', 'alpine', 'jungle', 'peg'];

function newCode() {
  for (;;) {
    let c = '';
    for (let i = 0; i < 5; i++) c += CODE_CHARS[crypto.randomInt(CODE_CHARS.length)];
    if (!rooms.has(c)) return c;
  }
}

function cleanConfig(raw, base) {
  const c = { ...base };
  if (raw && typeof raw === 'object') {
    if (TRACK_IDS.includes(raw.track)) c.track = raw.track;
    if (Number.isInteger(raw.laps) && raw.laps >= 1 && raw.laps <= 6) c.laps = raw.laps;
    if (Number.isInteger(raw.cpus) && raw.cpus >= 0 && raw.cpus <= 7) c.cpus = raw.cpus;
  }
  return c;
}

function send(ws, msg) {
  if (ws && ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
}

function seatOf(room, ws) {
  if (room.seats.host.ws === ws) return 'host';
  if (room.seats.guest && room.seats.guest.ws === ws) return 'guest';
  return null;
}

function otherSeat(room, role) {
  return role === 'host' ? room.seats.guest : room.seats.host;
}

function touch(room) { room.lastActivity = Date.now(); }

function closeRoom(room, reason) {
  for (const role of ['host', 'guest']) {
    const seat = room.seats[role];
    if (seat && seat.ws) {
      send(seat.ws, { t: 'room_closed', reason });
      seat.ws.room = null;
    }
  }
  rooms.delete(room.code);
}

function finishRace(room, winnerRole, time, forfeit) {
  room.phase = 'done';
  room.winner = winnerRole;
  touch(room);
  const msg = { t: 'result', winner: winnerRole, time, forfeit: !!forfeit };
  send(room.seats.host.ws, msg);
  if (room.seats.guest) send(room.seats.guest.ws, msg);
}

function maybeGo(room) {
  const h = room.seats.host, g = room.seats.guest;
  if (room.phase !== 'starting' || !h.readyRace || !g || !g.readyRace) return;
  room.phase = 'racing';
  touch(room);
  // 1.4s to settle on the grid + 2.4s of start lights on the clients
  const goAt = Date.now() + 3800;
  send(h.ws, { t: 'go', goAt });
  send(g.ws, { t: 'go', goAt });
}

// A seat's socket died. Phase decides: grace in lobby/starting (track-change
// reloads look exactly like this), instant forfeit mid-race.
function seatDropped(room, role) {
  const seat = room.seats[role];
  if (!seat) return;
  seat.ws = null;
  seat.disconnectedAt = Date.now();
  touch(room);
  if (room.phase === 'racing') {
    const other = otherSeat(room, role);
    if (other && other.ws) {
      send(other.ws, { t: 'peer_left', phase: 'racing' });
      finishRace(room, role === 'host' ? 'guest' : 'host', null, true);
    } else {
      rooms.delete(room.code); // both gone
    }
  }
  // lobby/starting: leave the seat for `resume`; the sweep enforces grace
}

function graceExpired(room, role) {
  if (role === 'host') {
    closeRoom(room, 'host_left');
    return;
  }
  room.seats.guest = null;
  if (room.phase === 'starting') {
    room.phase = 'lobby';
    room.seats.host.readyRace = false;
  }
  send(room.seats.host.ws, { t: 'peer_left', phase: room.phase });
}

const HANDLERS = {
  create(ws, m) {
    if (ws.room) return send(ws, { t: 'error', code: 'in_room' });
    const code = newCode();
    const config = cleanConfig(m.config, DEF_CONFIG);
    const token = crypto.randomBytes(12).toString('hex');
    const room = {
      code, phase: 'lobby', config, winner: null,
      createdAt: Date.now(), lastActivity: Date.now(),
      seats: {
        host: { ws, token, readyRace: false, finished: null, disconnectedAt: null },
        guest: null,
      },
    };
    rooms.set(code, room);
    ws.room = room;
    send(ws, { t: 'created', code, token, config });
  },

  probe(ws, m) {
    const room = rooms.get(String(m.code || '').toUpperCase());
    if (!room) return send(ws, { t: 'join_error', reason: 'not_found' });
    send(ws, { t: 'room_info', config: room.config, phase: room.phase });
  },

  join(ws, m) {
    if (ws.room) return send(ws, { t: 'error', code: 'in_room' });
    const room = rooms.get(String(m.code || '').toUpperCase());
    if (!room) return send(ws, { t: 'join_error', reason: 'not_found' });
    if (room.phase !== 'lobby') return send(ws, { t: 'join_error', reason: 'in_progress' });
    if (room.seats.guest && (room.seats.guest.ws ||
        Date.now() - room.seats.guest.disconnectedAt < RESUME_GRACE)) {
      return send(ws, { t: 'join_error', reason: 'full' });
    }
    const token = crypto.randomBytes(12).toString('hex');
    room.seats.guest = { ws, token, readyRace: false, finished: null, disconnectedAt: null };
    ws.room = room;
    touch(room);
    send(ws, { t: 'joined', code: room.code, token, config: room.config });
    send(room.seats.host.ws, { t: 'peer_joined' });
  },

  resume(ws, m) {
    if (ws.room) return send(ws, { t: 'error', code: 'in_room' });
    const room = rooms.get(String(m.code || '').toUpperCase());
    const role = m.role === 'guest' ? 'guest' : 'host';
    const seat = room && room.seats[role];
    if (!room || !seat || seat.token !== m.token || seat.ws ||
        room.phase === 'racing' || room.phase === 'done') {
      return send(ws, { t: 'join_error', reason: 'not_found' });
    }
    seat.ws = ws;
    seat.disconnectedAt = null;
    ws.room = room;
    touch(room);
    send(ws, { t: 'resumed', config: room.config, phase: room.phase });
  },

  config(ws, m, room, role) {
    if (role !== 'host') return send(ws, { t: 'error', code: 'not_host' });
    if (room.phase !== 'lobby') return;
    room.config = cleanConfig(m.config, room.config);
    touch(room);
    if (room.seats.guest) send(room.seats.guest.ws, { t: 'config', config: room.config });
  },

  start_req(ws, m, room, role) {
    if (role !== 'host') return send(ws, { t: 'error', code: 'not_host' });
    if (room.phase !== 'lobby') return;
    if (!room.seats.guest || !room.seats.guest.ws) {
      return send(ws, { t: 'error', code: 'no_guest' });
    }
    room.phase = 'starting';
    room.seats.host.readyRace = false;
    room.seats.guest.readyRace = false;
    room.seats.host.finished = null;
    room.seats.guest.finished = null;
    room.winner = null;
    touch(room);
    const msg = { t: 'prep', config: room.config };
    send(room.seats.host.ws, msg);
    send(room.seats.guest.ws, msg);
  },

  ready_race(ws, m, room, role) {
    if (room.phase !== 'starting') return;
    room.seats[role].readyRace = true;
    touch(room);
    maybeGo(room);
  },

  state(ws, m, room, role) {
    if (room.phase !== 'racing' && room.phase !== 'starting') return;
    const other = otherSeat(room, role);
    if (other && other.ws) {
      send(other.ws, { t: 'peer', n: m.n, s: m.s, x: m.x, v: m.v,
                       st: m.st, cr: m.cr, lap: m.lap });
    }
  },

  cars(ws, m, room, role) {
    if (role !== 'host') return;
    if (room.phase !== 'racing' && room.phase !== 'starting') return;
    const g = room.seats.guest;
    if (g && g.ws) send(g.ws, { t: 'cars', n: m.n, a: m.a });
  },

  finished(ws, m, room, role) {
    if (room.phase !== 'racing') return;
    const time = typeof m.time === 'number' ? m.time : null;
    room.seats[role].finished = { time };
    finishRace(room, role, time, false); // first processed wins
  },

  again(ws, m, room, role) {
    if (role !== 'host' || room.phase !== 'done') return;
    room.phase = 'lobby';
    room.winner = null;
    touch(room);
    const g = room.seats.guest;
    if (g && g.ws) send(g.ws, { t: 'config', config: room.config });
  },

  leave(ws, m, room, role) {
    ws.room = null;
    if (role === 'host') {
      closeRoom(room, 'host_left');
    } else {
      room.seats.guest = null;
      if (room.phase === 'starting') {
        room.phase = 'lobby';
        room.seats.host.readyRace = false;
      }
      if (room.phase === 'racing') {
        send(room.seats.host.ws, { t: 'peer_left', phase: 'racing' });
        finishRace(room, 'host', null, true);
      } else {
        send(room.seats.host.ws, { t: 'peer_left', phase: room.phase });
      }
    }
  },
};

wss.on('connection', (ws) => {
  ws.quiet = 0;
  ws.room = null;
  ws.on('pong', () => { ws.quiet = 0; });
  ws.on('error', () => {});

  ws.on('message', (data) => {
    ws.quiet = 0;
    if (data.length > 4096) return;
    let m;
    try { m = JSON.parse(data); } catch { return; }
    if (!m || typeof m.t !== 'string') return;
    if (m.t === 'ping') return send(ws, { t: 'pong', ct: m.ct, st: Date.now() });
    const h = HANDLERS[m.t];
    if (!h) return;
    // room-scoped messages need a seat; create/probe/join/resume do not
    if (['create', 'probe', 'join', 'resume'].includes(m.t)) return h(ws, m);
    const room = ws.room;
    if (!room || !rooms.has(room.code)) return;
    const role = seatOf(room, ws);
    if (!role) return;
    h(ws, m, room, role);
  });

  ws.on('close', () => {
    const room = ws.room;
    ws.room = null;
    if (!room || !rooms.has(room.code)) return;
    if (room.seats.host.ws === ws) seatDropped(room, 'host');
    else if (room.seats.guest && room.seats.guest.ws === ws) seatDropped(room, 'guest');
  });
});

// liveness: any traffic (app messages, protocol pongs) resets the quiet
// counter; ~45s of total silence drops the socket. Clients keepalive at 8s.
const heartbeat = setInterval(() => {
  for (const ws of wss.clients) {
    if (++ws.quiet >= 3) { ws.terminate(); continue; }
    ws.ping();
  }
}, 15e3);

// room expiry + resume-grace enforcement
const sweep = setInterval(() => {
  const now = Date.now();
  for (const room of [...rooms.values()]) {
    for (const role of ['host', 'guest']) {
      const seat = room.seats[role];
      if (seat && !seat.ws && seat.disconnectedAt &&
          (room.phase === 'lobby' || room.phase === 'starting') &&
          now - seat.disconnectedAt > RESUME_GRACE) {
        graceExpired(room, role);
        if (!rooms.has(room.code)) break;
      }
    }
    if (!rooms.has(room.code)) continue;
    const idle = now - room.lastActivity;
    if ((room.phase === 'lobby' && !room.seats.guest && idle > EXPIRE_UNJOINED) ||
        (room.phase === 'done' && idle > EXPIRE_DONE) ||
        idle > EXPIRE_IDLE) {
      closeRoom(room, 'expired');
    }
  }
}, 60e3);

heartbeat.unref();
sweep.unref();
