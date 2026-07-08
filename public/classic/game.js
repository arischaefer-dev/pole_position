/* ============================================================
   POLE POSITION — browser clone of the 1982 Namco/Atari arcade
   Pure canvas + WebAudio, no assets. 256x224 logical resolution.

   Mechanics follow the original arcade rules:
   - Qualifying lap must be <= 73.00 game seconds. Lap time sets
     grid position: 58.50->P1(4000) ... 73.00->P8(200).
   - Race: 3 laps, 7 rival cars, 90 game-second timer with a
     time extension at the start line each lap.
   - Scoring: distance (~10,000/lap), 50/car passed (tallied at
     end), 200/second remaining at the finish.
   - Hitting a car or roadside sign explodes the car; puddles and
     grass slow it down. Timer ticks at ~2x real time.
   ============================================================ */
'use strict';

/* ---------------- canvas setup ---------------- */
const W = 256, H = 224;
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
ctx.imageSmoothingEnabled = false;

const COARSE = window.matchMedia && matchMedia('(pointer: coarse)').matches;
function fitCanvas() {
  let availW, availH;
  if (COARSE) {
    // reserve room for the on-screen controls (touch.js): in portrait the
    // START bar above and the pedal zone below, in landscape the side columns
    if (window.innerWidth > window.innerHeight) {
      availW = window.innerWidth - 360; availH = window.innerHeight - 16;
    } else {
      availW = window.innerWidth - 8; availH = window.innerHeight - 254;
    }
  } else {
    availW = window.innerWidth - 8; availH = window.innerHeight - 40;
  }
  const raw = Math.min(availW / W, availH / H);
  const s = raw >= 2 ? Math.floor(raw) : Math.max(0.75, raw);
  canvas.style.width = Math.floor(W * s) + 'px';
  canvas.style.height = Math.floor(H * s) + 'px';
}
window.addEventListener('resize', fitCanvas);
fitCanvas();

/* ---------------- palette ---------------- */
const C = {
  sky: '#3cbcfc', cloud: '#fcfcfc',
  ridge: '#00841c', ridgeDark: '#005810',
  fuji: '#b8c0c8', fujiSnow: '#fcfcfc',
  grass: '#00a800', grassAlt: '#00b006',
  road: '#8c8c8c', roadAlt: '#868686',
  rumbleR: '#d81800', rumbleW: '#fcfcfc',
  lane: '#fcfcfc',
  hudRed: '#f83800', hudYel: '#f8b800', hudWhite: '#fcfcfc',
  hudBlue: '#0058f8', hudCyan: '#3cbcfc',
  black: '#000000'
};

/* ---------------- 5x7 pixel font ---------------- */
const FONT = {
  'A':'01110 10001 10001 11111 10001 10001 10001','B':'11110 10001 10001 11110 10001 10001 11110',
  'C':'01110 10001 10000 10000 10000 10001 01110','D':'11110 10001 10001 10001 10001 10001 11110',
  'E':'11111 10000 10000 11110 10000 10000 11111','F':'11111 10000 10000 11110 10000 10000 10000',
  'G':'01110 10001 10000 10111 10001 10001 01111','H':'10001 10001 10001 11111 10001 10001 10001',
  'I':'11111 00100 00100 00100 00100 00100 11111','J':'00111 00010 00010 00010 00010 10010 01100',
  'K':'10001 10010 10100 11000 10100 10010 10001','L':'10000 10000 10000 10000 10000 10000 11111',
  'M':'10001 11011 10101 10101 10001 10001 10001','N':'10001 11001 10101 10011 10001 10001 10001',
  'O':'01110 10001 10001 10001 10001 10001 01110','P':'11110 10001 10001 11110 10000 10000 10000',
  'Q':'01110 10001 10001 10001 10101 10010 01101','R':'11110 10001 10001 11110 10100 10010 10001',
  'S':'01111 10000 10000 01110 00001 00001 11110','T':'11111 00100 00100 00100 00100 00100 00100',
  'U':'10001 10001 10001 10001 10001 10001 01110','V':'10001 10001 10001 10001 10001 01010 00100',
  'W':'10001 10001 10001 10101 10101 11011 10001','X':'10001 01010 00100 00100 00100 01010 10001',
  'Y':'10001 01010 00100 00100 00100 00100 00100','Z':'11111 00001 00010 00100 01000 10000 11111',
  '0':'01110 10001 10011 10101 11001 10001 01110','1':'00100 01100 00100 00100 00100 00100 01110',
  '2':'01110 10001 00001 00110 01000 10000 11111','3':'11110 00001 00001 01110 00001 00001 11110',
  '4':'00010 00110 01010 10010 11111 00010 00010','5':'11111 10000 11110 00001 00001 10001 01110',
  '6':'01110 10000 10000 11110 10001 10001 01110','7':'11111 00001 00010 00100 01000 01000 01000',
  '8':'01110 10001 10001 01110 10001 10001 01110','9':'01110 10001 10001 01111 00001 00001 01110',
  '"':'01010 01010 01010 00000 00000 00000 00000','.':'00000 00000 00000 00000 00000 01100 01100',
  '-':'00000 00000 00000 11111 00000 00000 00000','!':'00100 00100 00100 00100 00100 00000 00100',
  '/':'00001 00010 00010 00100 01000 01000 10000',':':'00000 01100 01100 00000 01100 01100 00000',
  "'":'00100 00100 00100 00000 00000 00000 00000',' ':'00000 00000 00000 00000 00000 00000 00000'
};
const glyphCache = new Map();
function glyph(ch, color, scale) {
  const key = ch + '|' + color + '|' + scale;
  let g = glyphCache.get(key);
  if (g) return g;
  const rows = (FONT[ch] || FONT[' ']).split(' ');
  g = document.createElement('canvas');
  g.width = 5 * scale; g.height = 7 * scale;
  const gc = g.getContext('2d');
  gc.fillStyle = color;
  for (let y = 0; y < 7; y++)
    for (let x = 0; x < 5; x++)
      if (rows[y][x] === '1') gc.fillRect(x * scale, y * scale, scale, scale);
  glyphCache.set(key, g);
  return g;
}
function drawText(txt, x, y, color, scale) {
  scale = scale || 1;
  for (let i = 0; i < txt.length; i++) {
    const ch = txt[i].toUpperCase();
    if (ch !== ' ') ctx.drawImage(glyph(ch, color, scale), x, y);
    x += 6 * scale;
  }
}
function textW(txt, scale) { return txt.length * 6 * (scale || 1) - (scale || 1); }
function drawTextC(txt, y, color, scale) {
  drawText(txt, Math.floor((W - textW(txt, scale)) / 2), y, color, scale);
}

/* ---------------- audio ---------------- */
const AudioFX = {
  ctx: null, master: null, engineOsc: null, engineOsc2: null, engineGain: null,
  noiseBuf: null, muted: false,
  ensure() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.5;
    this.master.connect(this.ctx.destination);
    // engine: two oscillators through a lowpass
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 900;
    this.lp = lp;
    this.engineGain = this.ctx.createGain();
    this.engineGain.gain.value = 0;
    this.engineOsc = this.ctx.createOscillator();
    this.engineOsc.type = 'sawtooth'; this.engineOsc.frequency.value = 55;
    this.engineOsc2 = this.ctx.createOscillator();
    this.engineOsc2.type = 'square'; this.engineOsc2.frequency.value = 28;
    this.engineOsc3 = this.ctx.createOscillator();      // detuned growl layer
    this.engineOsc3.type = 'sawtooth'; this.engineOsc3.frequency.value = 55.8;
    const g2 = this.ctx.createGain(); g2.gain.value = 0.5;
    const g3 = this.ctx.createGain(); g3.gain.value = 0.35;
    this.engineOsc.connect(this.engineGain);
    this.engineOsc2.connect(g2); g2.connect(this.engineGain);
    this.engineOsc3.connect(g3); g3.connect(this.engineGain);
    this.engineGain.connect(lp); lp.connect(this.master);
    const lfo = this.ctx.createOscillator();
    lfo.frequency.value = 5.5;
    const lfoGain = this.ctx.createGain();
    lfoGain.gain.value = 90;
    lfo.connect(lfoGain); lfoGain.connect(lp.frequency);
    lfo.start();
    this.engineOsc.start(); this.engineOsc2.start(); this.engineOsc3.start();
    // noise buffer for crash / skid
    const len = this.ctx.sampleRate;
    this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  },
  engine(on, rpm, hiGear) {   // rpm 0..1
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime;
    this.engineGain.gain.setTargetAtTime(on ? 0.12 : 0, t, 0.05);
    if (on) {
      const f = 45 + rpm * 190;
      this.engineOsc.frequency.setTargetAtTime(f, t, 0.03);
      this.engineOsc2.frequency.setTargetAtTime(f / 2, t, 0.03);
      this.engineOsc3.frequency.setTargetAtTime(f * 1.013, t, 0.03);
      this.lp.frequency.setTargetAtTime(hiGear ? 1150 : 750, t, 0.1);
    }
  },
  whoosh() {                      // pass-by
    if (!this.ctx || this.muted) return;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.Q.value = 1.5;
    const t = this.ctx.currentTime;
    bp.frequency.setValueAtTime(350, t);
    bp.frequency.exponentialRampToValueAtTime(1900, t + 0.18);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.16, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.28);
    src.connect(bp); bp.connect(g); g.connect(this.master);
    src.start(t); src.stop(t + 0.3);
  },
  cheer() {                       // crowd at the finish
    if (!this.ctx || this.muted) return;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const lp2 = this.ctx.createBiquadFilter();
    lp2.type = 'lowpass'; lp2.frequency.value = 1300;
    const g = this.ctx.createGain(), t = this.ctx.currentTime;
    g.gain.setValueAtTime(0.001, t);
    g.gain.exponentialRampToValueAtTime(0.22, t + 0.35);
    g.gain.exponentialRampToValueAtTime(0.001, t + 2.4);
    src.connect(lp2); lp2.connect(g); g.connect(this.master);
    src.start(t); src.stop(t + 2.5);
  },
  beep(freq, dur, vol, type) {
    if (!this.ctx || this.muted) return;
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = type || 'square'; o.frequency.value = freq;
    g.gain.value = vol || 0.2;
    o.connect(g); g.connect(this.master);
    const t = this.ctx.currentTime;
    g.gain.setValueAtTime(vol || 0.2, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.start(t); o.stop(t + dur);
  },
  crash() {
    if (!this.ctx || this.muted) return;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const g = this.ctx.createGain(), t = this.ctx.currentTime;
    g.gain.setValueAtTime(0.5, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.9);
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.setValueAtTime(3000, t);
    lp.frequency.exponentialRampToValueAtTime(200, t + 0.9);
    src.connect(lp); lp.connect(g); g.connect(this.master);
    src.start(t); src.stop(t + 1);
    this.beep(60, 0.5, 0.4, 'sine');
  },
  skid() {
    if (!this.ctx || this.muted || this._skidding) return;
    this._skidding = true;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const g = this.ctx.createGain(), t = this.ctx.currentTime;
    g.gain.value = 0.06;
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = 1200;
    src.connect(bp); bp.connect(g); g.connect(this.master);
    src.start(t); src.stop(t + 0.15);
    setTimeout(() => this._skidding = false, 120);
  },
  jingle(notes, step, vol) {
    if (!this.ctx || this.muted) return;
    notes.forEach((f, i) => setTimeout(() => this.beep(f, step * 0.9 / 1000, vol || 0.18), i * step));
  },
  extend() { this.jingle([523, 659, 784, 1047], 90); },
  goal()   { this.jingle([523, 659, 784, 659, 784, 1047, 1319], 110); },
  fail()   { this.jingle([392, 330, 262, 196], 160, 0.2); }
};

/* announcer voice, approximating the arcade's digitized speech */
function speak(txt) {
  try {
    if (AudioFX.muted || !window.speechSynthesis) return;
    const u = new SpeechSynthesisUtterance(txt);
    u.rate = 0.95; u.pitch = 0.55; u.volume = 0.9;
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
  } catch (e) { /* no speech support */ }
}

/* ---------------- road / track ---------------- */
const SEG_LEN = 200;             // world units per segment
const ROAD_W = 2000;             // half road width, world units
const CAM_H = 1000;
const CAM_DEPTH = 1 / Math.tan((100 / 2) * Math.PI / 180); // fov 100
const DRAW_DIST = 75;            // segments
const HORIZON = 100;             // screen y of vanishing point
const RUMBLE = 3;                // segments per rumble stripe
const MAX_SPEED = SEG_LEN * 60;  // world units/sec  (= 315 km/h display)

let segments = [];
function addRoad(enter, hold, leave, curve) {
  const n0 = segments.length;
  const total = enter + hold + leave;
  for (let i = 0; i < total; i++) {
    let c;
    if (i < enter) c = curve * (i / enter);
    else if (i < enter + hold) c = curve;
    else c = curve * ((total - i) / leave);
    segments.push({ i: n0 + i, curve: c, sprites: [], cars: [] });
  }
}
function addSprite(segIdx, kind, offset) {
  const seg = segments[((segIdx % segments.length) + segments.length) % segments.length];
  seg.sprites.push({ kind, offset });
}

/* Stylized Fuji Speedway: long start straight, right, easy left,
   right, hard left hairpin, long gradual right, back to straight. */
function buildTrack() {
  segments = [];
  addRoad(1, 200, 1, 0);           // start/finish straight
  addRoad(40, 80, 40, 5);          // sharp right
  addRoad(1, 48, 1, 0);
  addRoad(40, 60, 40, -2);         // easy left
  addRoad(40, 80, 40, 4);          // medium right
  addRoad(1, 38, 1, 0);
  addRoad(50, 120, 50, -6);        // hairpin left (hardest)
  addRoad(1, 58, 1, 0);
  addRoad(60, 140, 60, 2);         // long gradual right
  addRoad(1, 8, 1, 0);             // final straight

  const N = segments.length;
  // curve warning arrow-boards before every bend (like the arcade)
  const warns = [
    [195, 1], [405, -1], [545, 1], [745, -1], [1025, 1]
  ];
  for (const [at, dir] of warns) {
    addSprite(at, dir > 0 ? 'arrowR' : 'arrowL', dir > 0 ? -1.45 : 1.45);
    addSprite(at + 8, dir > 0 ? 'arrowR' : 'arrowL', dir > 0 ? -1.45 : 1.45);
  }
  // billboards along the straights, alternating sides
  const boards = ['bbGP', 'bbCOLA', 'bbTIRE', 'bbOIL', 'bbRACE', 'bbGP', 'bbCOLA', 'bbTIRE'];
  const spots = [30, 70, 110, 150, 380, 725, 990, 1240];
  spots.forEach((s, i) => addSprite(s, boards[i], (i % 2 ? 1.6 : -1.6)));
  // start line flags
  addSprite(1, 'flagL', -1.35); addSprite(1, 'flagR', 1.35);
  // water puddles on the straights
  addSprite(120, 'puddle', 0.45);
  addSprite(385, 'puddle', -0.4);
  addSprite(1000, 'puddle', 0.3);
  return N * SEG_LEN;
}
let TRACK_LEN = buildTrack();
const N_SEGS = segments.length;
function segAt(z) {
  return segments[Math.floor(((z % TRACK_LEN) + TRACK_LEN) / SEG_LEN) % N_SEGS];
}

/* ---------------- sprites (procedural pixel art) ---------------- */
function makeSprite(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  g.imageSmoothingEnabled = false;
  draw(g, w, h);
  return c;
}
function px(g, x, y, w, h, col) { g.fillStyle = col; g.fillRect(x, y, w, h); }

// rear view F1 car, body/accent colors, shear -1|0|1 for steering
function carSprite(body, dark, accent, shear) {
  return makeSprite(40, 22, (g) => {
    const s = shear * 2;
    // rear tires
    px(g, 1 + s, 12, 8, 10, '#101010'); px(g, 31 - s, 12, 8, 10, '#101010');
    px(g, 3 + s, 15, 4, 4, '#d8d8d8');  px(g, 33 - s, 15, 4, 4, '#d8d8d8');
    // rear wing
    px(g, 5, 2, 30, 4, dark);
    px(g, 5, 2, 30, 1, accent);
    px(g, 8, 6, 2, 3, dark); px(g, 30, 6, 2, 3, dark);
    // body
    px(g, 10, 8, 20, 12, body);
    px(g, 12, 6, 16, 3, body);
    // engine cowl / cockpit
    px(g, 16, 5, 8, 6, dark);
    px(g, 18, 3, 4, 4, '#fcfcfc');   // helmet
    px(g, 18, 3, 4, 1, accent);
    // side pods
    px(g, 8, 12, 3, 7, body); px(g, 29, 12, 3, 7, body);
    // exhaust shading
    px(g, 13, 19, 14, 2, dark);
    // front tires peeking
    px(g, 6 + s * 2, 8, 4, 6, '#101010'); px(g, 30 - s * 2, 8, 4, 6, '#101010');
  });
}
function billboard(text, bg, fg) {
  return makeSprite(48, 30, (g) => {
    px(g, 0, 0, 48, 22, '#fcfcfc');
    px(g, 2, 2, 44, 18, bg);
    px(g, 6, 22, 3, 8, '#7c5400'); px(g, 39, 22, 3, 8, '#7c5400');
    g.fillStyle = fg;
    // tiny block letters
    const tw = text.length * 6 - 1;
    let x = Math.floor((48 - tw) / 2);
    for (const ch of text) {
      const rows = (FONT[ch] || FONT[' ']).split(' ');
      for (let y = 0; y < 7; y++)
        for (let xx = 0; xx < 5; xx++)
          if (rows[y][xx] === '1') g.fillRect(x + xx, 7 + y, 1, 1);
      x += 6;
    }
  });
}
function arrowBoard(dir) { // dir 1 = right curve
  return makeSprite(30, 26, (g) => {
    px(g, 0, 0, 30, 18, '#fcfcfc');
    px(g, 1, 1, 28, 16, '#fcfcfc');
    px(g, 13, 18, 4, 8, '#7c5400');
    g.save();
    if (dir < 0) { g.translate(30, 0); g.scale(-1, 1); }
    // curved arrow sweeping up-right
    g.strokeStyle = '#d81800';
    g.lineWidth = 4;
    g.beginPath();
    g.arc(18, 14, 8, Math.PI, Math.PI * 1.5);
    g.stroke();
    g.fillStyle = '#d81800';
    g.beginPath();
    g.moveTo(17, 2); g.lineTo(17, 10); g.lineTo(26, 6);
    g.closePath(); g.fill();
    g.restore();
  });
}
function flagSprite(flip) {
  return makeSprite(16, 30, (g) => {
    px(g, flip ? 13 : 1, 0, 2, 30, '#b0b0b0');
    for (let y = 0; y < 3; y++)
      for (let x = 0; x < 3; x++)
        px(g, (flip ? 1 : 3) + x * 4, 1 + y * 4, 4, 4, (x + y) % 2 ? '#fcfcfc' : '#000');
  });
}
const SPR = {
  playerL: carSprite('#d81800', '#7c0800', '#0058f8', -1),
  player:  carSprite('#d81800', '#7c0800', '#0058f8', 0),
  playerR: carSprite('#d81800', '#7c0800', '#0058f8', 1),
  car0: carSprite('#f8b800', '#7c5400', '#d81800', 0),
  car1: carSprite('#fcfcfc', '#787878', '#d81800', 0),
  car2: carSprite('#00a8f8', '#00407c', '#fcfcfc', 0),
  car3: carSprite('#00b800', '#005810', '#f8b800', 0),
  bbGP:   billboard('GP',   '#0058f8', '#fcfcfc'),
  bbCOLA: billboard('COLA', '#d81800', '#fcfcfc'),
  bbTIRE: billboard('TIRE', '#000000', '#f8b800'),
  bbOIL:  billboard('OIL',  '#f8b800', '#000000'),
  bbRACE: billboard('RACE', '#00a800', '#fcfcfc'),
  arrowR: arrowBoard(1),
  arrowL: arrowBoard(-1),
  flagL: flagSprite(false),
  flagR: flagSprite(true),
  puddle: makeSprite(44, 8, (g) => {
    px(g, 4, 2, 36, 4, '#0058f8');
    px(g, 0, 3, 44, 2, '#3cbcfc');
    px(g, 8, 1, 12, 1, '#3cbcfc');
  })
};
// paint the real sponsor / venue art onto the billboards once loaded
for (const [sprName, file] of [
  ['bbGP', 'pepsi'], ['bbCOLA', 'cola'], ['bbTIRE', 'michelin'],
  ['bbOIL', 'castrol'], ['bbRACE', 'fuji']
]) {
  const img = new Image();
  img.onload = () => {
    const g = SPR[sprName].getContext('2d');
    g.drawImage(img, 2, 2, 44, 18);
  };
  img.src = '/img/' + file + '.png';
}

const SPRITE_WORLD_W = {   // world-unit widths for projection
  playerL: 700, player: 700, playerR: 700,
  car0: 700, car1: 700, car2: 700, car3: 700,
  bbGP: 900, bbCOLA: 900, bbTIRE: 900, bbOIL: 900, bbRACE: 900,
  arrowR: 620, arrowL: 620, flagL: 300, flagR: 300, puddle: 900
};

/* ---------------- background layers ---------------- */
const BG_W = 512;
const bgRidge = makeSprite(BG_W, 40, (g) => {
  // rolling dark-green ridge, deterministic bumps
  g.fillStyle = C.ridge;
  let y = 22;
  for (let x = 0; x < BG_W; x++) {
    y = 22 + Math.round(8 * Math.sin(x * 0.045) + 4 * Math.sin(x * 0.013 + 2));
    g.fillRect(x, y, 1, 40 - y);
  }
  g.fillStyle = C.ridgeDark;
  for (let x = 0; x < BG_W; x++) {
    y = 30 + Math.round(5 * Math.sin(x * 0.03 + 5));
    g.fillRect(x, y, 1, 40 - y);
  }
  // Mt Fuji
  const fx = 150, fw = 90, fh = 30;
  for (let i = 0; i < fh; i++) {
    const half = Math.round((i / fh) * (fw / 2));
    g.fillStyle = i < 9 ? C.fujiSnow : C.fuji;
    g.fillRect(fx - half, 10 + i, half * 2, 1);
  }
});
const bgClouds = makeSprite(BG_W, 46, (g) => {
  const blobs = [[30,18],[90,8],[150,26],[228,12],[300,30],[360,6],[430,20],[480,32]];
  g.fillStyle = C.cloud;
  for (const [cx, cy] of blobs) {
    g.fillRect(cx - 12, cy + 3, 24, 5);
    g.fillRect(cx - 7, cy, 14, 4);
    g.fillRect(cx - 16, cy + 5, 32, 2);
  }
});

/* ---------------- game state ---------------- */
const QUAL_TABLE = [           // [max lap time, grid pos, bonus]
  [58.50, 1, 4000], [60.00, 2, 2000], [62.00, 3, 1400], [64.00, 4, 1000],
  [66.00, 5, 800], [68.00, 6, 600], [70.00, 7, 400], [73.00, 8, 200]
];
const GAME_TIME_RATE = 2;      // game seconds per real second (arcade ticks fast)
const QUAL_TIME = 90;          // game seconds on the qualifying clock
/* operator "dip switch" settings, same ranges as the arcade cabinet */
const DIP_CHOICES = { laps: [3, 4, 5, 6], time: [90, 120], ext: [45, 55, 60] };
const DIP = { laps: 3, time: 90, ext: 60 };
try {
  const d = JSON.parse(localStorage.getItem('pp_dip') || '{}');
  for (const k of Object.keys(DIP))
    if (DIP_CHOICES[k].includes(d[k])) DIP[k] = d[k];
} catch (e) {}
let RACE_TIME = DIP.time, EXT_TIME = DIP.ext, RACE_LAPS = DIP.laps;
function applyDip() {
  RACE_TIME = DIP.time; EXT_TIME = DIP.ext; RACE_LAPS = DIP.laps;
  try { localStorage.setItem('pp_dip', JSON.stringify(DIP)); } catch (e) {}
}
const PTS_PER_LAP = 10000;     // distance points per lap (50 pts / 5 m)

/* high-score table (arcade-style ranking) */
const DEFAULT_SCORES = [
  { initials: 'NAM', score: 12000 }, { initials: 'ATA', score: 10000 },
  { initials: 'FUJ', score: 8000 }, { initials: 'GPX', score: 6000 },
  { initials: 'POL', score: 4000 }
];
let hiScores = DEFAULT_SCORES.slice();
let bestEver = 0;
try {
  const saved = JSON.parse(localStorage.getItem('pp_scores') || 'null');
  if (Array.isArray(saved) && saved.length) hiScores = saved;
  else {
    const old = parseInt(localStorage.getItem('pp_top') || '0', 10) || 0;
    if (old > hiScores[hiScores.length - 1].score) {
      hiScores.push({ initials: 'AAA', score: old });
      hiScores.sort((a, b) => b.score - a.score);
      hiScores = hiScores.slice(0, 5);
    }
  }
  bestEver = parseFloat(localStorage.getItem('pp_bestlap') || '0') || 0;
} catch (e) {}
function insertScore(initials, score) {
  hiScores.push({ initials, score });
  hiScores.sort((a, b) => b.score - a.score);
  hiScores = hiScores.slice(0, 5);
  try { localStorage.setItem('pp_scores', JSON.stringify(hiScores)); } catch (e) {}
}
function noteLap(t) {
  if (!G.bestLap || t < G.bestLap) G.bestLap = t;
  if (!bestEver || t < bestEver) {
    bestEver = t;
    try { localStorage.setItem('pp_bestlap', String(t)); } catch (e) {}
  }
}
let topScore = 12000;   // live HUD value; hiScores[0] is the persistent one

const G = {};                  // mutable game state
function resetPlayer() {
  G.pos = 0;              // world z along track
  G.playerX = 0;          // -1..1 = road edges
  G.speed = 0;
  G.gear = 0;             // 0 = LO, 1 = HI
  G.steer = 0;
  G.crashed = 0;          // >0 = crash timer (real seconds)
  G.blink = 0;
  G.invuln = 0; G.shiftCut = 0;
}
function initGame() {
  G.state = 'title';
  G.stateT = 0;
  G.score = 0;
  G.lapTime = 0;
  G.timer = 0;
  G.lap = 0;
  G.passed = 0;
  G.gridPos = 8;
  G.qualBonus = 0;
  G.qualTime = 0;
  G.cars = [];
  G.banner = null; G.bannerT = 0;
  G.bgOff = 0;
  G.finTimeBonus = 0; G.finPassBonus = 0; G.finT = 0;
  G.bestLap = 0;
  G.demo = false;
  G.paused = false;
  G.ini = null;
  topScore = hiScores[0].score;
  resetPlayer();
}
initGame();

function setState(s) { G.state = s; G.stateT = 0; }
function flash(msg, t) { G.banner = msg; G.bannerT = t || 2; }

/* rival + traffic cars */
function makeCar(z, offset, maxPct, spr) {
  return { z, offset, speed: 0, maxPct, spr, ahead: true, rival: true, phase: z * 0.001 + offset };
}
function setupRaceGrid() {
  G.cars = [];
  const line = TRACK_LEN;
  const slots = [];
  for (let k = 0; k < 8; k++)
    slots.push({ z: line - (k * 1.2 + 1) * SEG_LEN, off: k % 2 ? 0.42 : -0.42 });
  const mySlot = G.gridPos - 1;
  G.pos = ((slots[mySlot].z % TRACK_LEN) + TRACK_LEN) % TRACK_LEN;
  G.playerX = slots[mySlot].off;
  let s = 0;
  for (let k = 0; k < 8; k++) {
    if (k === mySlot) continue;
    const car = makeCar(slots[k].z % TRACK_LEN, slots[k].off,
      0.60 + 0.025 * (7 - k), SPR['car' + (s % 4)]);
    G.cars.push(car); s++;
  }
  // slower traffic spread around the lap
  for (let t = 0; t < 6; t++) {
    const car = makeCar((G.pos + (t + 1) * (TRACK_LEN / 7.3)) % TRACK_LEN,
      (t % 2 ? -0.5 : 0.5) + (t % 3) * 0.2, 0.44 + 0.04 * (t % 3), SPR['car' + (t % 4)]);
    car.rival = false;
    G.cars.push(car);
  }
  for (const c of G.cars) c.ahead = carAhead(c);
  G.speed = 0; G.gear = 0; G.crashed = 0; G.steer = 0;
  G.lapArmed = false;    // first line crossing starts lap 1, doesn't complete it
}
function carAhead(c) {
  let d = (c.z - G.pos + TRACK_LEN * 1.5) % TRACK_LEN - TRACK_LEN / 2;
  return d > 0;
}

/* ---------------- input ---------------- */
const keys = {};
const CHARSET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
function cycleInitial(dir) {
  const ini = G.ini;
  ini.chars[ini.slot] = (ini.chars[ini.slot] + dir + CHARSET.length) % CHARSET.length;
  AudioFX.beep(660, 0.03, 0.08);
}
function confirmInitial() {
  const ini = G.ini;
  AudioFX.beep(880, 0.06, 0.12);
  ini.slot++;
  if (ini.slot >= 3) {
    insertScore(ini.chars.map(c => CHARSET[c]).join(''), Math.floor(G.score / 10) * 10);
    setState('scores');
  }
}
function toggleGear() {
  if (G.state === 'qualify' || G.state === 'race') {
    G.gear = 1 - G.gear;
    G.shiftCut = 0.15;             // brief torque cut for mechanical feel
    AudioFX.beep(G.gear ? 220 : 150, 0.08, 0.1);
  }
}
const DIP_ROWS = [
  ['LAPS', 'laps'], ['GAME TIME', 'time'], ['EXTENDED TIME', 'ext']
];
function optionsInput(k) {
  if (k === 'arrowup') G.optSel = (G.optSel + 2) % 3;
  else if (k === 'arrowdown') G.optSel = (G.optSel + 1) % 3;
  else if (k === 'arrowleft' || k === 'arrowright') {
    const key = DIP_ROWS[G.optSel][1];
    const list = DIP_CHOICES[key];
    const dir = k === 'arrowright' ? 1 : -1;
    DIP[key] = list[(list.indexOf(DIP[key]) + dir + list.length) % list.length];
    AudioFX.beep(660, 0.03, 0.08);
  }
}
window.addEventListener('keydown', (e) => {
  if (['ArrowUp','ArrowDown','ArrowLeft','ArrowRight',' '].includes(e.key)) e.preventDefault();
  AudioFX.ensure();
  if (AudioFX.ctx && AudioFX.ctx.state === 'suspended') AudioFX.ctx.resume();
  if (e.repeat) return;
  const k = e.key.toLowerCase();
  if (G.state === 'options') {           // operator dip-switch menu
    if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) optionsInput(k);
    else if (e.key === 'Enter' || e.key === 'Escape' || k === 'o') {
      applyDip();
      setState('title');
    }
    return;
  }
  if (G.state === 'initials') {          // arcade initials entry
    if (k === 'arrowleft') cycleInitial(-1);
    else if (k === 'arrowright') cycleInitial(1);
    else if (e.key === 'Enter' || k === 'arrowup' || e.key === ' ') confirmInitial();
    else if (CHARSET.includes(e.key.toUpperCase())) {
      G.ini.chars[G.ini.slot] = CHARSET.indexOf(e.key.toUpperCase());
      confirmInitial();
    }
    return;
  }
  keys[k] = true;
  if (e.key === 'Shift' || k === 'z') toggleGear();
  if (k === 'm') {
    AudioFX.muted = !AudioFX.muted;
    if (AudioFX.muted && AudioFX.engineGain) AudioFX.engineGain.gain.value = 0;
  }
  if (k === 'p' || e.key === 'Escape') {
    if (['qualify', 'race', 'lightsQ', 'lightsR'].includes(G.state)) {
      G.paused = !G.paused;
      if (G.paused) AudioFX.engine(false, 0);
    }
  }
  if (k === 'o' && (G.state === 'title' || G.state === 'scores')) {
    G.demo = false;
    AudioFX.engine(false, 0);
    G.optSel = 0;
    setState('options');
  }
  if (e.key === 'Enter' || e.key === ' ') {
    if (G.state === 'title' || G.state === 'scores') startGame();
    else if (G.state === 'gameOver') leaveGameOver(true);   // quick restart
  }
});
window.addEventListener('keyup', (e) => { keys[e.key.toLowerCase()] = false; });

/* input hook for on-screen touch controls (touch.js) */
window.__ppInput = (k, down) => {
  AudioFX.ensure();
  if (AudioFX.ctx && AudioFX.ctx.state === 'suspended') AudioFX.ctx.resume();
  if (k === 'gear') { if (down) toggleGear(); return; }
  if (k === 'pause') {
    if (down && ['qualify', 'race', 'lightsQ', 'lightsR'].includes(G.state)) {
      G.paused = !G.paused;
      if (G.paused) AudioFX.engine(false, 0);
    }
    return;
  }
  if (k === 'enter') {
    if (down) {
      if (G.state === 'title' || G.state === 'scores') startGame();
      else if (G.state === 'gameOver') leaveGameOver(true);
      else if (G.state === 'initials') confirmInitial();
    }
    return;
  }
  if (G.state === 'initials' && down) {
    if (k === 'arrowleft') { cycleInitial(-1); return; }
    if (k === 'arrowright') { cycleInitial(1); return; }
    if (k === ' ') { confirmInitial(); return; }
  }
  keys[k] = down;
};

function startGame() {
  initGame();
  setState('prequal');
  flash('PREPARE TO QUALIFY', 2.4);
  AudioFX.jingle([784, 784, 659, 784, 1047], 130);
  speak('Prepare to qualify');
}
function leaveGameOver(quick) {
  if (Math.floor(G.score / 10) * 10 > hiScores[hiScores.length - 1].score) {
    G.ini = { chars: [0, 0, 0], slot: 0 };
    setState('initials');
  } else if (quick) startGame();
  else setState('scores');
}

/* attract-mode autopilot */
const demoKeys = {};
function key(k) { return G.demo ? demoKeys[k] : keys[k]; }
function demoInput() {
  const look = segAt((G.pos + 1400) % TRACK_LEN).curve;
  const here = segAt(G.pos).curve;
  const cur = Math.abs(look) > Math.abs(here) ? look : here;
  const sp = G.speed / MAX_SPEED;
  demoKeys['arrowup'] = true;
  demoKeys['arrowdown'] = (Math.abs(cur) > 4.5 && sp > 0.6) ||
                          (Math.abs(cur) > 2.5 && sp > 0.85);
  if (sp > 0.42 && G.gear === 0 && G.crashed <= 0) G.gear = 1;
  if (G.crashed > 0) G.gear = 0;
  const err = -G.playerX * 1.4 - cur * 0.5 * sp;
  demoKeys['arrowleft'] = err < -0.04;
  demoKeys['arrowright'] = err > 0.04;
}

/* ---------------- update ---------------- */
function accelFor(gear, speedPct) {
  const cap = gear ? 1 : 0.46;
  if (speedPct >= cap) return 0;
  const head = 1 - speedPct / cap;
  return (gear ? MAX_SPEED / 7 : MAX_SPEED / 3) * (0.3 + 0.7 * head);
}

function updateDriving(dt, racing) {
  const seg = segAt(G.pos);
  const speedPct = G.speed / MAX_SPEED;

  if (G.crashed > 0) {
    G.crashed -= dt;
    G.speed = Math.max(0, G.speed - MAX_SPEED * dt);
    if (G.crashed <= 0) {
      G.crashed = 0;
      G.playerX = Math.max(-0.8, Math.min(0.8, G.playerX));
      G.gear = 0;
      G.invuln = 2.0;              // blinking grace period after respawn
    }
  } else {
    if (G.invuln > 0) G.invuln -= dt;
    if (G.shiftCut > 0) G.shiftCut -= dt;
    // throttle / brake
    if ((key('arrowup') || key('w')) && G.shiftCut <= 0)
      G.speed += accelFor(G.gear, speedPct) * dt;
    else if (!(key('arrowup') || key('w'))) G.speed -= MAX_SPEED / 8 * dt;
    if (key('arrowdown') || key('s') || key(' ')) G.speed -= MAX_SPEED / 3 * dt;
    // gear caps
    const cap = (G.gear ? 1 : 0.46) * MAX_SPEED;
    if (G.speed > cap) G.speed = Math.max(cap, G.speed - MAX_SPEED / 4 * dt);
    // off-road drag
    const offRoad = Math.abs(G.playerX) > 1.0;
    if (offRoad) {
      if (G.speed > MAX_SPEED * 0.35) G.speed -= MAX_SPEED * 0.9 * dt;
      if ((frame & 7) === 0) AudioFX.skid();
    }
    G.speed = Math.max(0, Math.min(MAX_SPEED, G.speed));

    // steering
    const sp = G.speed / MAX_SPEED;
    let st = 0;
    if (key('arrowleft') || key('a')) st = -1;
    if (key('arrowright') || key('d')) st = 1;
    G.steer = st;
    const dx = dt * 2.2 * sp;
    G.playerX += st * dx;
    // centrifugal pull on curves
    G.playerX -= dx * sp * seg.curve * 0.26;
    if (Math.abs(seg.curve) > 3.5 && sp > 0.72 && (frame & 5) === 0) AudioFX.skid();
    G.playerX = Math.max(-2.2, Math.min(2.2, G.playerX));

    // sprite hazards (signs crash you off-road; puddles slow you)
    for (let n = 0; n < 2; n++) {
      const s2 = segments[(seg.i + n) % N_SEGS];
      for (const sp2 of s2.sprites) {
        const ww = SPRITE_WORLD_W[sp2.kind] / ROAD_W / 2;
        if (sp2.kind === 'puddle') {
          if (Math.abs(G.playerX - sp2.offset) < ww + 0.1 && G.speed > MAX_SPEED * 0.3) {
            G.speed *= (1 - 3 * dt);
            G.playerX += (G.playerX < sp2.offset ? -1 : 1) * 0.5 * dt; // slip
            AudioFX.skid();
          }
        } else if (sp2.kind !== 'flagL' && sp2.kind !== 'flagR') {
          if (Math.abs(G.playerX - sp2.offset) < ww + 0.12 && G.speed > MAX_SPEED * 0.05 &&
              G.invuln <= 0) {
            doCrash();
          }
        }
      }
    }
  }

  // move
  const prevPos = G.pos;
  G.pos = (G.pos + G.speed * dt) % TRACK_LEN;
  const crossed = G.pos < prevPos && G.speed > 0;
  // distance scoring
  if (racing || G.state === 'qualify')
    G.score += (G.speed * dt / TRACK_LEN) * PTS_PER_LAP;

  // background parallax with curves
  G.bgOff += seg.curve * (G.speed / MAX_SPEED) * dt * 18;

  // cars
  if (racing) updateCars(dt);

  // engine sound
  const cap = (G.gear ? 1 : 0.46);
  AudioFX.engine(G.crashed <= 0 && G.speed > 1,
    Math.min(1, (G.speed / MAX_SPEED) / cap) * (G.gear ? 0.85 : 1), G.gear === 1);

  return crossed;
}

function updateCars(dt) {
  const seg = segAt(G.pos);
  for (const c of G.cars) {
    const cseg = segAt(c.z);
    // rivals brake for corners, traffic just cruises
    const safe = 1 - Math.min(0.5, Math.abs(cseg.curve) * (c.rival ? 0.055 : 0.09));
    const surge = 1 + 0.04 * Math.sin(frame * 0.007 + (c.phase || 0));
    const target = MAX_SPEED * c.maxPct * safe * surge;
    c.speed += Math.min(1, dt * 0.5) * (target - c.speed);
    c.z = (c.z + c.speed * dt) % TRACK_LEN;
    // gentle drift toward a racing line
    const want = Math.max(-0.75, Math.min(0.75, c.offset + (cseg.curve > 0 ? -0.002 : cseg.curve < 0 ? 0.002 : 0)));
    c.offset = want;

    // pass detection
    const nowAhead = carAhead(c);
    if (c.ahead && !nowAhead && G.crashed <= 0) {
      G.passed++;
      AudioFX.beep(880, 0.05, 0.08);
      if (Math.abs(c.offset - G.playerX) < 0.8) AudioFX.whoosh();
    }
    c.ahead = nowAhead;

    // collision with player
    if (G.crashed <= 0 && G.invuln <= 0) {
      let dz = (c.z - G.pos + TRACK_LEN * 1.5) % TRACK_LEN - TRACK_LEN / 2;
      if (dz > -SEG_LEN && dz < SEG_LEN * 1.2 &&
          Math.abs(c.offset - G.playerX) < 0.3 && G.speed > MAX_SPEED * 0.08) {
        doCrash();
      }
    }
  }
}
function doCrash() {
  if (G.crashed > 0) return;
  G.crashed = 2.4;
  G.speed = 0;
  AudioFX.crash();
  AudioFX.engine(false, 0);
}

function update(dt) {
  G.stateT += dt;
  if (G.bannerT > 0) { G.bannerT -= dt; if (G.bannerT <= 0) G.banner = null; }
  frame++;

  switch (G.state) {
    case 'title':
      G.bgOff += dt * 4;
      // attract mode: after a moment the game drives itself
      if (!G.demo && G.stateT > 2) {
        G.demo = true;
        resetPlayer();
      }
      if (G.demo) {
        demoInput();
        updateDriving(dt, false);
      }
      G._jingleT = (G._jingleT || 0) + dt;
      if (G._jingleT > 8 && AudioFX.ctx) {
        G._jingleT = 0;
        AudioFX.jingle([659, 784, 880, 784, 1047, 880, 1319], 130, 0.1);
      }
      if (G.stateT > 14) {
        G.demo = false;
        AudioFX.engine(false, 0);
        setState('scores');
      }
      break;

    case 'scores':
      if (G.stateT > 6) {
        G.cars = [];
        setState('title');
      }
      break;

    case 'initials':
    case 'options':
      break;

    case 'prequal':
      if (G.stateT > 2.6) {
        setState('lightsQ');
        G.timer = QUAL_TIME; G.lapTime = 0;
        resetPlayer();
      }
      break;

    case 'lightsQ':
    case 'lightsR': {
      // red red green over 2.4s
      const step = Math.floor(G.stateT / 0.8);
      if (step !== G._lstep) {
        G._lstep = step;
        AudioFX.beep(step >= 3 ? 880 : 440, step >= 3 ? 0.4 : 0.18, 0.22);
      }
      if (G.stateT > 2.4) {
        G._lstep = -1;
        setState(G.state === 'lightsQ' ? 'qualify' : 'race');
      }
      break;
    }

    case 'qualify': {
      G.timer -= dt * GAME_TIME_RATE;
      G.lapTime += dt * GAME_TIME_RATE;
      const crossed = updateDriving(dt, false);
      if (crossed) {
        G.qualTime = G.lapTime;
        noteLap(G.qualTime);
        AudioFX.engine(false, 0);
        if (G.qualTime <= 73.0) {
          for (const [t, p, b] of QUAL_TABLE)
            if (G.qualTime <= t) { G.gridPos = p; G.qualBonus = b; break; }
          G.score += G.qualBonus;
          setState('qualDone');
          AudioFX.goal();
        } else {
          setState('qualFail');
          AudioFX.fail();
        }
      } else if (G.timer <= 0) {
        G.timer = 0;
        AudioFX.engine(false, 0);
        setState('qualFail');
        AudioFX.fail();
      }
      break;
    }

    case 'qualDone':
      if (G.stateT > 3.4) {
        setupRaceGrid();
        G.timer = RACE_TIME; G.lap = 1; G.lapTime = 0; G.passed = 0;
        setState('lightsR');
        speak('Prepare to race');
      }
      break;

    case 'qualFail':
      if (G.stateT > 3.2) gameOver();
      break;

    case 'race': {
      G.timer -= dt * GAME_TIME_RATE;
      G.lapTime += dt * GAME_TIME_RATE;
      const crossed = updateDriving(dt, true);
      if (crossed) {
        if (!G.lapArmed) {           // grid sits behind the line: first
          G.lapArmed = true;         // crossing starts lap 1
          G.lapTime = 0;
        } else if (G.lap >= RACE_LAPS) {
          noteLap(G.lapTime);
          finishRace();
          break;
        } else {
          noteLap(G.lapTime);
          G.lap++;
          G.lapTime = 0;
          G.timer += EXT_TIME;
          if (G.lap === RACE_LAPS) {
            flash('FINAL LAP!', 2);
            speak('Final lap');
          } else {
            flash('EXTENDED PLAY!', 1.6);
          }
          AudioFX.extend();
        }
      }
      if (G.timer <= 0) {
        G.timer = 0;
        AudioFX.engine(false, 0);
        setState('timeUp');
        AudioFX.fail();
      }
      break;
    }

    case 'timeUp':
      G.speed = Math.max(0, G.speed - MAX_SPEED * dt * 0.5);
      G.pos = (G.pos + G.speed * dt) % TRACK_LEN;
      if (G.stateT > 3.2) gameOver();
      break;

    case 'finish': {
      // roll down the car, then tally bonuses
      G.speed = Math.max(0, G.speed - MAX_SPEED * dt * 0.4);
      G.pos = (G.pos + G.speed * dt) % TRACK_LEN;
      AudioFX.engine(G.speed > 1, G.speed / MAX_SPEED);
      G.finT += dt;
      if (G.finT > 1.5 && G.finTimeBonus < Math.floor(G.timer) * 200) {
        G.finTimeBonus = Math.min(Math.floor(G.timer) * 200, G.finTimeBonus + 1200 * dt * 6);
        if ((frame & 3) === 0) AudioFX.beep(1200, 0.03, 0.07);
      }
      if (G.finT > 3.2 && G.finPassBonus < G.passed * 50) {
        G.finPassBonus = Math.min(G.passed * 50, G.finPassBonus + 50 * Math.ceil(dt * 20));
        if ((frame & 3) === 0) AudioFX.beep(900, 0.03, 0.07);
      }
      if (G.stateT > 7) {
        G.score += Math.floor(G.timer) * 200 + G.passed * 50;
        gameOver();
      }
      break;
    }

    case 'gameOver':
      if (G.stateT > 3.4) leaveGameOver(false);
      break;
  }

  if (G.score > topScore) topScore = Math.floor(G.score);
}
function finishRace() {
  setState('finish');
  G.finT = 0; G.finTimeBonus = 0; G.finPassBonus = 0;
  flash('GOAL!', 2.2);
  AudioFX.goal();
  AudioFX.cheer();
  speak('Congratulations');
}
function gameOver() {
  AudioFX.engine(false, 0);
  setState('gameOver');
}

/* ---------------- rendering ---------------- */
let frame = 0;

function project(worldX, camX, z) {
  const scale = CAM_DEPTH / (z / SEG_LEN);       // z in world units
  // NOTE: keep z in world units; scale = CAM_DEPTH * SEG_LEN / z
  return scale;
}

function renderBackground() {
  ctx.fillStyle = C.sky;
  ctx.fillRect(0, 0, W, HORIZON);
  const o1 = ((Math.round(-G.bgOff * 0.5) % BG_W) + BG_W) % BG_W;
  ctx.drawImage(bgRidge, o1 - BG_W, HORIZON - 40);
  ctx.drawImage(bgRidge, o1, HORIZON - 40);
  const o2 = ((Math.round(-G.bgOff * 0.25) % BG_W) + BG_W) % BG_W;
  ctx.drawImage(bgClouds, o2 - BG_W, 24);
  ctx.drawImage(bgClouds, o2, 24);
  ctx.fillStyle = C.grass;
  ctx.fillRect(0, HORIZON, W, H - HORIZON);
}

function poly(x1, y1, x2, y2, x3, y3, x4, y4, col) {
  ctx.fillStyle = col;
  ctx.beginPath();
  ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.lineTo(x3, y3); ctx.lineTo(x4, y4);
  ctx.closePath(); ctx.fill();
}

function renderRoad() {
  const baseSeg = segAt(G.pos);
  const basePct = (G.pos % SEG_LEN) / SEG_LEN;
  const camX = G.playerX * ROAD_W;
  const sprites = [];   // deferred: {x, y, scale, img, worldW}
  let maxY = H;
  let x = 0, dx = -(baseSeg.curve * basePct);

  let p1 = null;
  for (let n = 0; n < DRAW_DIST; n++) {
    const seg = segments[(baseSeg.i + n) % N_SEGS];
    const z1 = n * SEG_LEN + (SEG_LEN - (G.pos % SEG_LEN));
    const z0 = z1 - SEG_LEN;

    const curveX0 = x, curveX1 = x + dx;
    x += dx; dx += seg.curve;

    if (z0 < SEG_LEN * 0.3) { p1 = null; continue; }

    const s0 = CAM_DEPTH * SEG_LEN / z0;
    const s1 = CAM_DEPTH * SEG_LEN / z1;
    const y0 = Math.round(HORIZON + s0 * CAM_H * 0.11);
    const y1 = Math.round(HORIZON + s1 * CAM_H * 0.11);
    const cx0 = Math.round(W / 2 + (curveX0 - camX) * s0 * 0.064);
    const cx1 = Math.round(W / 2 + (curveX1 - camX) * s1 * 0.064);
    const w0 = Math.round(ROAD_W * s0 * 0.064);
    const w1 = Math.round(ROAD_W * s1 * 0.064);

    if (y1 < maxY && y0 > y1) {
      const grp = Math.floor(seg.i / RUMBLE) % 2;
      // grass strip (subtle alternation for speed feel)
      ctx.fillStyle = grp ? C.grass : C.grassAlt;
      ctx.fillRect(0, y1, W, y0 - y1);
      // rumble strips
      const r0 = Math.max(2, Math.round(w0 * 0.14)), r1 = Math.max(1, Math.round(w1 * 0.14));
      poly(cx0 - w0 - r0, y0, cx0 + w0 + r0, y0, cx1 + w1 + r1, y1, cx1 - w1 - r1, y1,
        grp ? C.rumbleR : C.rumbleW);
      // road surface
      poly(cx0 - w0, y0, cx0 + w0, y0, cx1 + w1, y1, cx1 - w1, y1,
        grp ? C.road : C.roadAlt);
      // white edge lines
      const e0 = Math.max(1, Math.round(w0 * 0.035)), e1 = Math.max(1, Math.round(w1 * 0.035));
      poly(cx0 - w0, y0, cx0 - w0 + e0, y0, cx1 - w1 + e1, y1, cx1 - w1, y1, C.lane);
      poly(cx0 + w0 - e0, y0, cx0 + w0, y0, cx1 + w1, y1, cx1 + w1 - e1, y1, C.lane);
      // center dashes
      if (grp) {
        const l0 = Math.max(1, Math.round(w0 * 0.03)), l1 = Math.max(1, Math.round(w1 * 0.03));
        poly(cx0 - l0, y0, cx0 + l0, y0, cx1 + l1, y1, cx1 - l1, y1, C.lane);
      }
      // start / finish checkers
      if (seg.i < 2 || seg.i === N_SEGS - 1) {
        const rows = 2, cols = 8;
        for (let ry = 0; ry < rows; ry++)
          for (let cxx = 0; cxx < cols; cxx++) {
            if ((ry + cxx) % 2) continue;
            const fy0 = y0 + (y1 - y0) * (ry / rows), fy1 = y0 + (y1 - y0) * ((ry + 1) / rows);
            const t0 = cxx / cols, t1 = (cxx + 1) / cols;
            poly(
              cx0 - w0 + 2 * w0 * t0, fy0, cx0 - w0 + 2 * w0 * t1, fy0,
              cx1 - w1 + 2 * w1 * t1, fy1, cx1 - w1 + 2 * w1 * t0, fy1, '#fcfcfc');
          }
      }
      maxY = y1;
    }

    // queue this segment's sprites + cars (project at segment start)
    const drawList = [];
    for (const sp of seg.sprites) {
      // checkered flags blink on the final lap
      if ((sp.kind === 'flagL' || sp.kind === 'flagR') &&
          (G.state === 'race' || G.state === 'finish') &&
          G.lap === RACE_LAPS && frame % 16 < 8) continue;
      drawList.push({ off: sp.offset, kind: sp.kind, pct: 0 });
    }
    for (const c of G.cars) {
      const cSegI = Math.floor(((c.z % TRACK_LEN) + TRACK_LEN) / SEG_LEN) % N_SEGS;
      if (cSegI === seg.i)
        drawList.push({ off: c.offset, kind: null, img: c.spr, pct: (c.z % SEG_LEN) / SEG_LEN });
    }
    for (const d of drawList) {
      const zz = z0 + d.pct * SEG_LEN;
      if (zz < SEG_LEN * 0.4) continue;
      const ss = CAM_DEPTH * SEG_LEN / zz;
      const yy = HORIZON + ss * CAM_H * 0.11;
      const cxx = W / 2 + ((curveX0 + d.pct * dx) - camX) * ss * 0.064;
      const img = d.img || SPR[d.kind];
      const ww = (d.kind ? SPRITE_WORLD_W[d.kind] : 700) * ss * 0.064;
      sprites.push({
        x: cxx + (d.off * ROAD_W) * ss * 0.064,
        y: yy, w: ww, img, z: zz
      });
    }
  }

  // far-to-near sprite draw
  sprites.sort((a, b) => b.z - a.z);
  for (const s of sprites) {
    const h = s.w * s.img.height / s.img.width;
    if (s.w < 2) continue;
    ctx.drawImage(s.img, Math.round(s.x - s.w / 2), Math.round(s.y - h), Math.round(s.w), Math.round(h));
  }
}

function renderPlayer() {
  const driving = ['qualify', 'race', 'finish', 'timeUp', 'lightsQ', 'lightsR'].includes(G.state) ||
    (G.state === 'title' && G.demo);
  if (!driving) return;
  const bounce = G.speed > MAX_SPEED * 0.1 ? (frame % 6 < 3 ? 0 : 1) : 0;
  const px0 = Math.round(W / 2 - 20);
  const py = 212 + bounce;
  if (G.crashed > 0) {
    renderExplosion(px0 + 20, py - 10);
    return;
  }
  if (G.invuln > 0 && frame % 6 < 3) return;   // respawn blink
  let spr = SPR.player;
  if (G.steer < 0) spr = SPR.playerL;
  else if (G.steer > 0) spr = SPR.playerR;
  // flashing car on the grid before start
  if ((G.state === 'lightsQ' || G.state === 'lightsR') && frame % 16 < 8) return;
  ctx.drawImage(spr, px0, py - 22);
}
function renderExplosion(cx, cy) {
  const t = 2.4 - G.crashed;                 // 0..2.4
  if (t < 1.1) {
    const r = 8 + t * 30;
    const cols = ['#f83800', '#f8b800', '#fcfcfc', '#f83800'];
    for (let i = 0; i < 10; i++) {
      const a = (i * 197 + frame * 31) % 360 * Math.PI / 180;
      const rr = r * (0.4 + ((i * 73 + frame * 13) % 60) / 100);
      const s = 5 + ((i * 37) % 10);
      ctx.fillStyle = cols[(i + (frame >> 2)) % 4];
      ctx.fillRect(Math.round(cx + Math.cos(a) * rr - s / 2), Math.round(cy + Math.sin(a) * rr * 0.6 - s / 2), s, s);
    }
  } else if (frame % 10 < 5) {
    // smoulder + blink before respawn
    ctx.fillStyle = '#787878';
    ctx.fillRect(cx - 8, cy - 8, 16, 10);
    ctx.fillStyle = '#f83800';
    ctx.fillRect(cx - 4, cy - 2, 8, 5);
  }
}

function renderLights() {
  if (G.state !== 'lightsQ' && G.state !== 'lightsR') return;
  const step = Math.floor(G.stateT / 0.8);   // 0,1,2 red -> 3 green (never hit; state flips at 2.4)
  const cx = W / 2, y = 116;
  ctx.fillStyle = '#000';
  ctx.fillRect(cx - 26, y - 6, 52, 16);
  for (let i = 0; i < 3; i++) {
    const on = step >= i;
    const last = G.stateT > 2.15;
    ctx.fillStyle = last ? '#00d800' : (on ? '#f83800' : '#480000');
    ctx.fillRect(cx - 20 + i * 15, y - 2, 10, 8);
  }
}

function fmtLap(t) {
  const s = Math.floor(t), c = Math.floor((t - s) * 100);
  return String(s) + '"' + String(c).padStart(2, '0');
}

function renderHUD() {
  ctx.fillStyle = C.black;
  ctx.fillRect(0, 0, W, 20);
  // row 1
  drawText('TOP', 6, 2, C.hudRed);
  drawText(String(Math.floor(topScore)), 32, 2, C.hudWhite);
  drawText('TIME', 100, 2, C.hudYel);
  // lap-time box (row 1 only, like the arcade)
  ctx.fillStyle = C.hudBlue;
  ctx.fillRect(168, 0, 88, 10);
  const inRace = ['qualify', 'race', 'finish', 'timeUp'].includes(G.state);
  drawText('LAP', 174, 2, C.hudWhite);
  drawText(inRace ? fmtLap(G.lapTime) : '0"00', 200, 2, C.hudWhite);
  if (G.state === 'race' || G.state === 'finish')
    drawText(G.lap + '/' + RACE_LAPS, 232, 11, C.hudCyan);
  else if (G.state === 'qualify')
    drawText('QUAL', 232, 11, C.hudCyan);
  if (G.bestLap && inRace)
    drawText('B ' + fmtLap(G.bestLap), 174, 11, C.hudWhite);
  // row 2
  drawText('SCORE', 6, 11, C.hudYel);
  drawText(String(Math.floor(G.score / 10) * 10), 42, 11, C.hudWhite);
  const showTimer = ['qualify', 'race', 'lightsQ', 'lightsR', 'finish', 'timeUp'].includes(G.state);
  drawText(showTimer ? String(Math.max(0, Math.ceil(G.timer))) : '', 106, 11,
    G.timer < 15 && (frame % 20 < 10) ? C.hudRed : C.hudWhite);
  const kmh = Math.round(G.speed / MAX_SPEED * 315);
  drawText('SPEED', 128, 11, C.hudYel);
  drawText(String(kmh) + 'KM', 166, 11, C.hudWhite);
  // gear indicator, bottom right like the arcade
  if (['qualify', 'race', 'finish', 'timeUp', 'lightsQ', 'lightsR'].includes(G.state))
    drawText(G.gear ? 'HI' : 'LO', W - 18, H - 10, C.hudWhite);
}

function renderBanner() {
  if (G.banner && (frame % 14 < 9)) {
    const y = 78;
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    const w = textW(G.banner, 1) + 10;
    ctx.fillRect((W - w) / 2, y - 3, w, 13);
    drawTextC(G.banner, y, C.hudYel);
  }
}

function renderStateOverlays() {
  switch (G.state) {
    case 'title': {
      // road perspective (or attract demo) behind title
      drawTextC('POLE', 44, C.hudRed, 3);
      drawTextC('POSITION', 70, C.hudRed, 3);
      drawTextC('TOP SCORE ' + topScore, 108, C.hudYel);
      if (bestEver) drawTextC('BEST LAP ' + fmtLap(bestEver), 120, C.hudYel);
      if (frame % 40 < 26) drawTextC('PRESS ENTER TO RACE', 136, C.hudWhite);
      drawTextC('QUALIFY IN UNDER 73"00', 158, C.hudCyan);
      drawTextC('THEN RACE ' + RACE_LAPS + ' LAPS  - O OPTIONS', 170, C.hudCyan);
      break;
    }
    case 'scores': {
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillRect(24, 52, W - 48, 122);
      drawTextC('HIGH SCORES', 58, C.hudRed, 2);
      hiScores.forEach((s, i) => {
        const y = 84 + i * 14;
        drawText(String(i + 1), 62, y, C.hudYel);
        drawText(s.initials, 86, y, C.hudWhite);
        drawText(String(s.score), 190 - textW(String(s.score)), y, C.hudCyan);
      });
      if (frame % 40 < 26) drawTextC('PRESS ENTER TO RACE', 160, C.hudWhite);
      break;
    }
    case 'options': {
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillRect(24, 52, W - 48, 122);
      drawTextC('OPTIONS', 58, C.hudRed, 2);
      DIP_ROWS.forEach(([label, key], i) => {
        const y = 90 + i * 16;
        const sel = i === G.optSel;
        drawText((sel ? '>' : ' ') + label, 48, y, sel ? C.hudYel : C.hudWhite);
        drawText(String(DIP[key]), 186, y, sel ? C.hudYel : C.hudCyan);
      });
      drawTextC('ARROWS CHANGE - ENTER OK', 152, C.hudWhite);
      break;
    }
    case 'initials': {
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillRect(24, 60, W - 48, 110);
      drawTextC('GREAT SCORE!', 66, C.hudYel, 2);
      drawTextC(String(Math.floor(G.score / 10) * 10), 88, C.hudWhite);
      drawTextC('ENTER YOUR INITIALS', 104, C.hudCyan);
      const x0 = W / 2 - 27;
      for (let i = 0; i < 3; i++) {
        const cur = i === G.ini.slot;
        const ch = CHARSET[G.ini.chars[i]];
        if (!cur || frame % 16 < 10)
          drawText(ch, x0 + i * 20, 122, cur ? C.hudRed : C.hudWhite, 2);
        ctx.fillStyle = cur ? C.hudRed : '#555';
        ctx.fillRect(x0 + i * 20, 138, 11, 2);
      }
      drawTextC('ARROWS CHANGE - ENTER OK', 152, C.hudWhite);
      break;
    }
    case 'qualDone': {
      drawTextC('QUALIFIED!', 84, C.hudYel, 2);
      drawTextC('TIME ' + fmtLap(G.qualTime), 110, C.hudWhite);
      drawTextC('GRID POSITION ' + G.gridPos, 124, C.hudWhite);
      drawTextC('BONUS ' + G.qualBonus + ' PTS', 138, C.hudCyan);
      if (G.stateT > 1.6) drawTextC('GET READY...', 160, C.hudRed);
      break;
    }
    case 'qualFail': {
      drawTextC('YOU FAILED', 90, C.hudRed, 2);
      drawTextC('TO QUALIFY', 110, C.hudRed, 2);
      if (G.qualTime > 0) drawTextC('TIME ' + fmtLap(G.qualTime), 136, C.hudWhite);
      break;
    }
    case 'timeUp': {
      drawTextC('TIME UP', 96, C.hudRed, 2);
      break;
    }
    case 'finish': {
      if (G.finT > 1.2) {
        drawTextC('TIME BONUS', 104, C.hudYel);
        drawTextC(Math.floor(G.timer) + ' SEC X 200 = ' + Math.floor(G.finTimeBonus / 100) * 100, 116, C.hudWhite);
      }
      if (G.finT > 3.0) {
        drawTextC('PASS BONUS', 132, C.hudYel);
        drawTextC(G.passed + ' CARS X 50 = ' + Math.floor(G.finPassBonus / 50) * 50, 144, C.hudWhite);
      }
      break;
    }
    case 'gameOver': {
      drawTextC('GAME OVER', 96, C.hudRed, 2);
      drawTextC('SCORE ' + Math.floor(G.score / 10) * 10, 124, C.hudWhite);
      if (Math.floor(G.score) >= topScore) drawTextC('NEW TOP SCORE!', 140, C.hudYel);
      break;
    }
    case 'prequal': {
      // handled by banner
      break;
    }
  }
}

function render() {
  renderBackground();
  renderRoad();
  renderPlayer();
  renderLights();
  renderHUD();
  renderBanner();
  renderStateOverlays();
  if (G.paused && Math.floor(performance.now() / 350) % 2 === 0) {
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(W / 2 - 40, 100, 80, 16);
    drawTextC('PAUSED', 104, C.hudYel);
  }
}

/* ---------------- main loop ---------------- */
let last = performance.now(), acc = 0;
const STEP = 1 / 60;
function loop(now) {
  let dt = (now - last) / 1000;
  last = now;
  if (dt > 0.1) dt = 0.1;
  acc += dt;
  while (acc >= STEP) { if (!G.paused) update(STEP); acc -= STEP; }
  render();
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

/* debug hooks for automated testing */
window.__pp = {
  get G() { return G; },
  keys, segAt, TRACK_LEN, MAX_SPEED,
  setState, setupRaceGrid, flash,
  warpRace(pos) {
    initGame();
    G.gridPos = pos || 4; G.qualBonus = 1000; G.qualTime = 63.2;
    setupRaceGrid();
    G.timer = RACE_TIME; G.lap = 1; G.lapTime = 0;
    setState('race');
  },
  warpQualify() {
    initGame();
    G.timer = QUAL_TIME; G.lapTime = 0;
    resetPlayer();
    setState('qualify');
  }
};
