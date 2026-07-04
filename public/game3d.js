/* ============================================================
   POLE POSITION 3D — true-3D remake of the 1982 Namco/Atari
   arcade game. three.js renderer + 2D arcade HUD overlay.

   Arcade rules preserved (verified against period sources):
   - Qualifying lap <= 73.00 game seconds. Lap time sets grid
     position: 58.50 -> P1 (4000 pts) ... 73.00 -> P8 (200).
   - Race: 3 laps, 7 rivals + traffic, 90 game-second timer,
     time extension at the line each lap.
   - Scoring: distance (~10,000/lap), 50/car passed (tallied
     at the end), 200/second remaining at the finish.
   - Car or sign contact explodes the car; puddles + grass
     slow it. LO/HI gears, top speed 315 km/h. Timer ticks at
     ~2x real time ("game seconds").
   ============================================================ */
import * as THREE from './lib/three.module.js';

/* ---------------- canvases ---------------- */
const HW = 256, HH = 224;              // HUD logical resolution
const GLW = 512, GLH = 448;            // 3D internal resolution (8:7 arcade aspect)
const glCanvas = document.getElementById('gl');
const hudCanvas = document.getElementById('hud');
const ctx = hudCanvas.getContext('2d');

function fitCanvas() {
  const availH = window.innerHeight - 40, availW = window.innerWidth - 8;
  const s = Math.max(1, Math.floor(Math.min(availW / HW, availH / HH)));
  for (const c of [glCanvas, hudCanvas]) {
    c.style.width = (HW * s) + 'px';
    c.style.height = (HH * s) + 'px';
  }
}
window.addEventListener('resize', fitCanvas);
fitCanvas();

/* ---------------- palette ---------------- */
const C = {
  sky: '#3cbcfc',
  grass: 0x00a800, road: 0x8a8a8a,
  rumbleR: 0xd81800, rumbleW: 0xfcfcfc, lane: 0xfcfcfc,
  hudRed: '#f83800', hudYel: '#f8b800', hudWhite: '#fcfcfc',
  hudBlue: '#0058f8', hudCyan: '#3cbcfc', black: '#000000'
};

/* ---------------- 5x7 pixel font (HUD + textures) ---------------- */
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
  drawText(txt, Math.floor((HW - textW(txt, scale)) / 2), y, color, scale);
}
function pixelText(g, text, x, y, color, scale) { // draw block letters on any 2d ctx
  g.fillStyle = color;
  for (const ch of text) {
    const rows = (FONT[ch] || FONT[' ']).split(' ');
    for (let yy = 0; yy < 7; yy++)
      for (let xx = 0; xx < 5; xx++)
        if (rows[yy][xx] === '1') g.fillRect(x + xx * scale, y + yy * scale, scale, scale);
    x += 6 * scale;
  }
}

/* ---------------- audio (identical to classic version) ---------------- */
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
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 900;
    this.engineGain = this.ctx.createGain();
    this.engineGain.gain.value = 0;
    this.engineOsc = this.ctx.createOscillator();
    this.engineOsc.type = 'sawtooth'; this.engineOsc.frequency.value = 55;
    this.engineOsc2 = this.ctx.createOscillator();
    this.engineOsc2.type = 'square'; this.engineOsc2.frequency.value = 28;
    const g2 = this.ctx.createGain(); g2.gain.value = 0.5;
    this.engineOsc.connect(this.engineGain);
    this.engineOsc2.connect(g2); g2.connect(this.engineGain);
    this.engineGain.connect(lp); lp.connect(this.master);
    this.engineOsc.start(); this.engineOsc2.start();
    const len = this.ctx.sampleRate;
    this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  },
  engine(on, rpm) {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime;
    this.engineGain.gain.setTargetAtTime(on ? 0.12 : 0, t, 0.05);
    if (on) {
      const f = 45 + rpm * 190;
      this.engineOsc.frequency.setTargetAtTime(f, t, 0.03);
      this.engineOsc2.frequency.setTargetAtTime(f / 2, t, 0.03);
    }
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

/* ---------------- track: closed spline (stylized Fuji) ---------------- */
/* Layout drives like the arcade course: long start/finish straight,
   sharp right, easy left kink, sweeping right, a right leading into
   the hard left hairpin, then a long gradual right onto the straight. */
const LAP_TARGET = 2000;                 // meters
const HALF_W = 5.5;                      // road half width, meters
const N_SAMP = 1600;

/* x is negated vs the drawing-board sketch so the turns read correctly
   on screen (screen-right for a forward camera is world -x). */
const CP_RAW = [
  [0, -90], [0, 150], [0, 400], [0, 600],              // front straight
  [-30, 700], [-130, 730], [-230, 690],                // T1 sharp right
  [-330, 660], [-430, 680], [-530, 650],               // easy left kink
  [-640, 600], [-700, 480], [-650, 360], [-540, 320],  // sweeping right horseshoe
  [-430, 300], [-330, 310],                            // run back
  [-250, 350], [-215, 430],                            // right lead-in
  [-200, 510], [-165, 540], [-130, 500],               // LEFT HAIRPIN
  [-120, 420], [-150, 330],                            // exit
  [-170, 150], [-140, 20], [-70, -140], [0, -190]      // long gradual right onto straight
];   // [0,-190] -> [0,-90] -> [0,150] keeps the grid + start line dead straight

function buildTrackCurve() {
  const mk = (k) => new THREE.CatmullRomCurve3(
    CP_RAW.map(([x, z]) => new THREE.Vector3(x * k, 0, z * k)), true, 'catmullrom', 0.5);
  const scale = LAP_TARGET / mk(1).getLength();
  return mk(scale);
}
const trackCurve = buildTrackCurve();
const TRACK_LEN = trackCurve.getLength();

const PTS = [], TANG = [], RIGHT = [], KAPPA = [];
for (let i = 0; i < N_SAMP; i++) {
  PTS.push(trackCurve.getPointAt(i / N_SAMP));
  TANG.push(trackCurve.getTangentAt(i / N_SAMP).setY(0).normalize());
  // T x up = screen-right for a camera following the tangent
  RIGHT.push(new THREE.Vector3(-TANG[i].z, 0, TANG[i].x));
}
{ // signed curvature (>0 = right turn), lightly smoothed
  const raw = [];
  const ds = TRACK_LEN / N_SAMP;
  for (let i = 0; i < N_SAMP; i++) {
    const a = TANG[i], b = TANG[(i + 1) % N_SAMP];
    let dth = Math.atan2(b.x, b.z) - Math.atan2(a.x, a.z);
    if (dth > Math.PI) dth -= 2 * Math.PI;
    if (dth < -Math.PI) dth += 2 * Math.PI;
    raw.push(-dth / ds);   // kappa > 0 = right-hand turn as seen on screen
  }
  for (let i = 0; i < N_SAMP; i++) {
    let s = 0;
    for (let k = -4; k <= 4; k++) s += raw[(i + k + N_SAMP) % N_SAMP];
    KAPPA.push(s / 9);
  }
}
function wrapS(s) { return ((s % TRACK_LEN) + TRACK_LEN) % TRACK_LEN; }
function idxAt(s) { return wrapS(s) / TRACK_LEN * N_SAMP; }
function kappaAt(s) { return KAPPA[Math.floor(idxAt(s)) % N_SAMP]; }
const _v1 = new THREE.Vector3();
function posAt(s, x, out) {
  const f = idxAt(s);
  const i = Math.floor(f) % N_SAMP, j = (i + 1) % N_SAMP, t = f - Math.floor(f);
  out = out || new THREE.Vector3();
  out.copy(PTS[i]).lerp(PTS[j], t);
  _v1.copy(RIGHT[i]).lerp(RIGHT[j], t);
  return out.addScaledVector(_v1, x);
}
function headingAt(s) {
  const i = Math.floor(idxAt(s)) % N_SAMP;
  return Math.atan2(TANG[i].x, TANG[i].z);
}

/* ---------------- three.js scene ---------------- */
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas: glCanvas, antialias: false });
} catch (e) {
  document.getElementById('help').textContent = 'WebGL is not available in this browser.';
  throw e;
}
renderer.setSize(GLW, GLH, false);
const scene = new THREE.Scene();
scene.background = new THREE.Color(C.sky);
scene.fog = new THREE.Fog(C.sky, 1000, 2600);
const camera = new THREE.PerspectiveCamera(68, GLW / GLH, 1, 4000);
scene.add(new THREE.AmbientLight(0xffffff, 1.9));
const sun = new THREE.DirectionalLight(0xffffff, 1.4);
sun.position.set(300, 600, 200);
scene.add(sun);

/* ground */
{
  const g = new THREE.Mesh(
    new THREE.PlaneGeometry(9000, 9000),
    new THREE.MeshBasicMaterial({ color: C.grass }));
  g.rotation.x = -Math.PI / 2;
  g.position.y = -0.4;
  scene.add(g);
}

/* road ribbon with rumble strips, edge lines, dashes, start checkers */
function buildRoad() {
  const posArr = [], colArr = [];
  const col = new THREE.Color();
  const quad = (a, b, c, d, colorHex, y) => {
    col.setHex(colorHex);
    for (const p of [a, b, d, b, c, d]) {
      posArr.push(p.x, y, p.z);
      colArr.push(col.r, col.g, col.b);
    }
  };
  const step = Math.max(1, Math.floor(N_SAMP / 1000));
  const P = (i, x) => _road.copy(PTS[i % N_SAMP]).addScaledVector(RIGHT[i % N_SAMP], x).clone();
  const _road = new THREE.Vector3();
  const RUM = 1.5;                       // rumble width
  for (let i = 0; i < N_SAMP; i += step) {
    const j = (i + step) % N_SAMP;
    const s = i / N_SAMP * TRACK_LEN;
    const grp = Math.floor(s / 10) % 2;
    // road
    quad(P(i, -HALF_W), P(i, HALF_W), P(j, HALF_W), P(j, -HALF_W), C.road, 0);
    // rumble strips
    const rc = grp ? C.rumbleR : C.rumbleW;
    quad(P(i, -HALF_W - RUM), P(i, -HALF_W), P(j, -HALF_W), P(j, -HALF_W - RUM), rc, 0.02);
    quad(P(i, HALF_W), P(i, HALF_W + RUM), P(j, HALF_W + RUM), P(j, HALF_W), rc, 0.02);
    // edge lines
    quad(P(i, -HALF_W + 0.25), P(i, -HALF_W + 0.55), P(j, -HALF_W + 0.55), P(j, -HALF_W + 0.25), C.lane, 0.015);
    quad(P(i, HALF_W - 0.55), P(i, HALF_W - 0.25), P(j, HALF_W - 0.25), P(j, HALF_W - 0.55), C.lane, 0.015);
    // center dashes
    if (grp) quad(P(i, -0.15), P(i, 0.15), P(j, 0.15), P(j, -0.15), C.lane, 0.015);
    // start-line checkers (first ~6 m)
    if (s < 6) {
      for (let cxx = 0; cxx < 8; cxx++) {
        if ((cxx + Math.floor(s / 3)) % 2) continue;
        const x0 = -HALF_W + (2 * HALF_W) * cxx / 8, x1 = x0 + 2 * HALF_W / 8;
        quad(P(i, x0), P(i, x1), P(j, x1), P(j, x0), 0xfcfcfc, 0.03);
      }
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(posArr, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colArr, 3));
  const mesh = new THREE.Mesh(geo,
    new THREE.MeshBasicMaterial({
      vertexColors: true, side: THREE.DoubleSide,
      // pull the road toward the camera in depth so the huge ground
      // plane can never z-fight it away at distance
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2
    }));
  scene.add(mesh);
}
buildRoad();

/* scenery: Mt Fuji, mountain ring, clouds */
{
  const fuji = new THREE.Group();
  const cone = new THREE.Mesh(
    new THREE.ConeGeometry(420, 300, 24),
    new THREE.MeshLambertMaterial({ color: 0x9aa4b0, flatShading: true }));
  cone.position.y = 150;
  const snow = new THREE.Mesh(
    new THREE.ConeGeometry(150, 110, 24),
    new THREE.MeshLambertMaterial({ color: 0xfcfcfc, flatShading: true }));
  snow.position.y = 300 - 55 + 1;
  fuji.add(cone, snow);
  fuji.position.set(-700, 0, 1900);
  scene.add(fuji);

  const mtMat = new THREE.MeshLambertMaterial({ color: 0x00841c, flatShading: true });
  for (let i = 0; i < 12; i++) {
    const a = i / 12 * Math.PI * 2 + 0.26;
    const r = 1350 + (i % 3) * 260;
    const m = new THREE.Mesh(new THREE.ConeGeometry(260 + (i % 4) * 90, 110 + (i % 3) * 60, 7), mtMat);
    m.position.set(Math.cos(a) * r - 300, (110 + (i % 3) * 60) / 2 - 4, Math.sin(a) * r + 300);
    scene.add(m);
  }
  const cloudMat = new THREE.MeshBasicMaterial({ color: 0xfcfcfc });
  for (let i = 0; i < 10; i++) {
    const a = i / 10 * Math.PI * 2 + 1.1;
    const r = 1100 + (i % 4) * 330;
    const c = new THREE.Mesh(new THREE.BoxGeometry(90 + (i % 3) * 50, 10, 34), cloudMat);
    c.position.set(Math.cos(a) * r - 200, 330 + (i % 5) * 40, Math.sin(a) * r + 250);
    scene.add(c);
  }
}

/* procedural sign textures (same pixel art as the classic version) */
function canvasTexture(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  draw(g, w, h);
  const tex = new THREE.CanvasTexture(c);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
function billboardTex(text, bg, fg) {
  return canvasTexture(176, 88, (g) => {
    g.fillStyle = '#fcfcfc'; g.fillRect(0, 0, 176, 88);
    g.fillStyle = bg; g.fillRect(8, 8, 160, 72);
    const tw = text.length * 6 * 3 - 3;
    pixelText(g, text, Math.floor((176 - tw) / 2), 24, fg, 3);
  });
}
function arrowTex(dir) {
  return canvasTexture(120, 72, (g) => {
    g.fillStyle = '#fcfcfc'; g.fillRect(0, 0, 120, 72);
    g.save();
    if (dir < 0) { g.translate(120, 0); g.scale(-1, 1); }
    // curved arrow sweeping up and to the right, like the arcade boards
    g.strokeStyle = '#d81800';
    g.lineWidth = 14;
    g.beginPath();
    g.arc(72, 58, 34, Math.PI, Math.PI * 1.5);   // quarter arc: left -> top
    g.stroke();
    g.fillStyle = '#d81800';
    g.beginPath();                                // arrowhead pointing right
    g.moveTo(70, 10); g.lineTo(70, 38); g.lineTo(100, 24);
    g.closePath(); g.fill();
    g.restore();
  });
}
function makeSignMesh(tex, wM, hM, poleH) {
  const grp = new THREE.Group();
  const panel = new THREE.Mesh(
    new THREE.PlaneGeometry(wM, hM),
    new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide }));
  panel.position.y = poleH + hM / 2;
  grp.add(panel);
  const poleMat = new THREE.MeshLambertMaterial({ color: 0x7c5400 });
  for (const px of [-wM / 3, wM / 3]) {
    const pole = new THREE.Mesh(new THREE.BoxGeometry(0.25, poleH + 0.1, 0.25), poleMat);
    pole.position.set(px, (poleH + 0.1) / 2, 0);
    grp.add(pole);
  }
  return grp;
}

/* hazards: signs (deadly), puddles (slippery) — placed from the curvature map */
const hazards = [];   // {s, x, kind: 'sign'|'puddle'}
{
  // find curve zones
  const zones = [];
  let inZone = false, z0 = 0;
  for (let i = 0; i <= N_SAMP; i++) {
    const k = KAPPA[i % N_SAMP];
    if (!inZone && Math.abs(k) > 0.01) { inZone = true; z0 = i; }
    else if (inZone && Math.abs(k) <= 0.01) {
      inZone = false;
      const len = (i - z0) / N_SAMP * TRACK_LEN;
      if (len > 25) zones.push({ s: z0 / N_SAMP * TRACK_LEN, dir: Math.sign(KAPPA[z0 % N_SAMP]) });
    }
  }
  // merge zones closer than 60 m
  const merged = [];
  for (const z of zones) {
    const prev = merged[merged.length - 1];
    if (prev && wrapS(z.s - prev.s) < 60) continue;
    merged.push(z);
  }
  // arrow boards ~70/100 m before each curve, on the outside of the turn
  for (const z of merged) {
    const side = z.dir > 0 ? -(HALF_W + 3.2) : (HALF_W + 3.2);
    const tex = arrowTex(z.dir);
    for (const back of [70, 100]) {
      const s = wrapS(z.s - back);
      const m = makeSignMesh(tex, 5, 3, 1.2);
      posAt(s, side, m.position);
      m.rotation.y = headingAt(s) + Math.PI;   // face oncoming drivers
      scene.add(m);
      hazards.push({ s, x: side, kind: 'sign' });
    }
  }
  // billboards on straights
  const boards = [
    ['GP', '#0058f8', '#fcfcfc'], ['COLA', '#d81800', '#fcfcfc'],
    ['TIRE', '#000000', '#f8b800'], ['OIL', '#f8b800', '#000000'],
    ['RACE', '#00a800', '#fcfcfc'], ['GP', '#0058f8', '#fcfcfc'],
    ['COLA', '#d81800', '#fcfcfc'], ['TIRE', '#000000', '#f8b800']
  ];
  // pick straight spots: low curvature, spaced apart
  const spots = [];
  let sScan = 40;
  while (spots.length < boards.length && sScan < TRACK_LEN - 40) {
    let ok = true;
    for (let d = -30; d <= 60; d += 10)
      if (Math.abs(kappaAt(sScan + d)) > 0.004) { ok = false; break; }
    for (const h of hazards)
      if (Math.abs(wrapS(sScan - h.s + TRACK_LEN / 2) - TRACK_LEN / 2) < 55) { ok = false; break; }
    if (ok) { spots.push(sScan); sScan += 120; } else sScan += 15;
  }
  spots.forEach((s, i) => {
    const side = (i % 2 ? 1 : -1) * (HALF_W + 4.5);
    const [t, bg, fg] = boards[i];
    const m = makeSignMesh(billboardTex(t, bg, fg), 8, 4, 1.6);
    posAt(s, side, m.position);
    m.rotation.y = headingAt(s) + Math.PI;
    scene.add(m);
    hazards.push({ s, x: side, kind: 'sign' });
  });
  // puddles on straights
  const pudMat = new THREE.MeshBasicMaterial({ color: 0x0058f8 });
  const pudSpots = [[spots[1] + 45 || 150, 2.2], [spots[3] + 50 || 600, -2.0], [spots[6] + 40 || 1500, 1.4]];
  for (const [s, x] of pudSpots) {
    const p = new THREE.Mesh(new THREE.CircleGeometry(2.2, 12), pudMat);
    p.rotation.x = -Math.PI / 2;
    p.scale.y = 0.55;
    posAt(wrapS(s), x, p.position);
    p.position.y = 0.04;
    p.rotation.z = headingAt(wrapS(s));
    scene.add(p);
    hazards.push({ s: wrapS(s), x, kind: 'puddle' });
  }
  // start gantry
  const gant = new THREE.Group();
  const postMat = new THREE.MeshLambertMaterial({ color: 0xd81800 });
  for (const px of [-(HALF_W + 1.6), HALF_W + 1.6]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.5, 8, 0.5), postMat);
    post.position.set(px, 4, 0);
    gant.add(post);
  }
  const banner = new THREE.Mesh(
    new THREE.BoxGeometry(2 * HALF_W + 4.4, 1.8, 0.4),
    new THREE.MeshBasicMaterial({
      map: canvasTexture(352, 44, (g) => {
        for (let y = 0; y < 3; y++)
          for (let x = 0; x < 44; x++) {
            g.fillStyle = (x + y) % 2 ? '#fcfcfc' : '#000';
            g.fillRect(x * 8, y * 5, 8, 5);
          }
        g.fillStyle = '#000'; g.fillRect(88, 15, 176, 16);
        pixelText(g, 'START', 92, 16, '#fcfcfc', 2);
      })
    }));
  banner.position.y = 7.4;
  gant.add(banner);
  posAt(10, 0, gant.position);
  gant.rotation.y = headingAt(10);
  scene.add(gant);
  // start-line side flags
  const flagTex = canvasTexture(48, 32, (g) => {
    for (let y = 0; y < 4; y++)
      for (let x = 0; x < 6; x++) {
        g.fillStyle = (x + y) % 2 ? '#fcfcfc' : '#000';
        g.fillRect(x * 8, y * 8, 8, 8);
      }
  });
  for (const side of [-(HALF_W + 1.8), HALF_W + 1.8]) {
    const fl = new THREE.Group();
    const pole = new THREE.Mesh(new THREE.BoxGeometry(0.15, 4, 0.15),
      new THREE.MeshLambertMaterial({ color: 0xb0b0b0 }));
    pole.position.y = 2;
    const flag = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 1.2),
      new THREE.MeshBasicMaterial({ map: flagTex, side: THREE.DoubleSide }));
    flag.position.set(side < 0 ? 0.95 : -0.95, 3.3, 0);
    fl.add(pole, flag);
    posAt(0, side, fl.position);
    fl.rotation.y = headingAt(0) + Math.PI;
    scene.add(fl);
  }
}

/* ---------------- cars ---------------- */
function buildF1(body, accent) {
  const grp = new THREE.Group();
  const bodyMat = new THREE.MeshLambertMaterial({ color: body });
  const darkMat = new THREE.MeshLambertMaterial({ color: 0x181818 });
  const accMat = new THREE.MeshLambertMaterial({ color: accent });
  const whiteMat = new THREE.MeshLambertMaterial({ color: 0xfcfcfc });
  const add = (geo, mat, x, y, z) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    grp.add(m);
    return m;
  };
  // +z is the direction of travel (three.js forward).
  // Rear view matches the arcade sprite: huge black rear tires, red
  // body + red wing, blue engine block in the middle, white helmet.
  add(new THREE.BoxGeometry(1.4, 0.5, 3.4), bodyMat, 0, 0.45, 0.1);        // tub
  add(new THREE.BoxGeometry(2.0, 0.32, 1.5), bodyMat, 0, 0.32, -0.5);      // wide side pods
  add(new THREE.BoxGeometry(0.65, 0.38, 1.5), bodyMat, 0, 0.4, 2.2);       // nose
  add(new THREE.BoxGeometry(2.1, 0.1, 0.55), bodyMat, 0, 0.28, 2.75);      // front wing
  add(new THREE.BoxGeometry(0.24, 0.16, 0.55), darkMat, -1.05, 0.28, 2.75);
  add(new THREE.BoxGeometry(0.24, 0.16, 0.55), darkMat, 1.05, 0.28, 2.75);
  add(new THREE.BoxGeometry(1.25, 0.6, 1.1), accMat, 0, 0.72, -0.95);      // blue engine block
  add(new THREE.BoxGeometry(0.55, 0.32, 0.06), whiteMat, 0, 0.72, -1.52);  // rear detail plate
  add(new THREE.BoxGeometry(0.5, 0.4, 0.5), whiteMat, 0, 1.02, 0.35);      // helmet
  add(new THREE.BoxGeometry(0.52, 0.12, 0.52), accMat, 0, 1.2, 0.35);      // helmet stripe
  add(new THREE.BoxGeometry(2.35, 0.13, 0.75), bodyMat, 0, 1.28, -1.65);   // red rear wing
  add(new THREE.BoxGeometry(0.14, 0.55, 0.75), darkMat, -1.12, 1.0, -1.65); // endplates
  add(new THREE.BoxGeometry(0.14, 0.55, 0.75), darkMat, 1.12, 1.0, -1.65);
  add(new THREE.BoxGeometry(0.16, 0.42, 0.16), darkMat, 0, 0.95, -1.65);   // wing pylon
  // wheels: [x, z, radius, width] — rear tires much bigger, like the sprite
  for (const [wx, wz, r, ww] of [[-1.02, 1.65, 0.4, 0.45], [1.02, 1.65, 0.4, 0.45],
                                 [-1.18, -1.25, 0.56, 0.7], [1.18, -1.25, 0.56, 0.7]]) {
    const w = add(new THREE.BoxGeometry(ww, r * 2, r * 2), darkMat, wx, r, wz);
    w.add(new THREE.Mesh(new THREE.BoxGeometry(ww + 0.02, r, r),
      new THREE.MeshLambertMaterial({ color: 0xd8d8d8 })));
  }
  return grp;
}
const CAR_COLORS = [
  [0xf8b800, 0xd81800], [0xfcfcfc, 0xd81800],
  [0x00a8f8, 0xfcfcfc], [0x00b800, 0xf8b800]
];
const playerMesh = buildF1(0xd81800, 0x0058f8);
scene.add(playerMesh);
playerMesh.visible = false;

/* explosion particles */
const boom = { group: new THREE.Group(), parts: [], t: 0 };
scene.add(boom.group);
function spawnExplosion(center) {
  clearExplosion();
  const cols = [0xf83800, 0xf8b800, 0xfcfcfc, 0xd81800];
  for (let i = 0; i < 34; i++) {
    const m = new THREE.Mesh(
      new THREE.BoxGeometry(0.35, 0.35, 0.35),
      new THREE.MeshBasicMaterial({ color: cols[i % 4] }));
    m.position.copy(center);
    const a = (i / 34) * Math.PI * 2, r = 4 + (i * 7) % 9;
    boom.parts.push({
      m, vx: Math.cos(a) * r, vz: Math.sin(a) * r,
      vy: 6 + (i * 13) % 10
    });
    boom.group.add(m);
  }
  boom.t = 0;
}
function clearExplosion() {
  for (const p of boom.parts) boom.group.remove(p.m);
  boom.parts.length = 0;
}
function updateExplosion(dt) {
  if (!boom.parts.length) return;
  boom.t += dt;
  for (const p of boom.parts) {
    p.vy -= 24 * dt;
    p.m.position.x += p.vx * dt;
    p.m.position.y = Math.max(0.15, p.m.position.y + p.vy * dt);
    p.m.position.z += p.vz * dt;
    const s = Math.max(0.05, 1 - boom.t * 0.8);
    p.m.scale.setScalar(s);
  }
  if (boom.t > 1.3) clearExplosion();
}

/* ---------------- game state (arcade rules) ---------------- */
const QUAL_TABLE = [
  [58.50, 1, 4000], [60.00, 2, 2000], [62.00, 3, 1400], [64.00, 4, 1000],
  [66.00, 5, 800], [68.00, 6, 600], [70.00, 7, 400], [73.00, 8, 200]
];
const GAME_TIME_RATE = 2;
const QUAL_TIME = 90;
const RACE_TIME = 90;
const EXT_TIME = 60;
const RACE_LAPS = 3;
const PTS_PER_LAP = 10000;
const MAX_SPEED = 87.5;                 // m/s = 315 km/h

let topScore = 12000;
try { topScore = Math.max(12000, parseInt(localStorage.getItem('pp_top') || '0', 10) || 0); } catch (e) {}

const G = {};
function resetPlayer() {
  G.pos = 0; G.playerX = 0; G.speed = 0;
  G.gear = 0; G.steer = 0; G.crashed = 0;
}
function initGame() {
  G.state = 'title';
  G.stateT = 0;
  G.score = 0; G.lapTime = 0; G.timer = 0;
  G.lap = 0; G.passed = 0;
  G.gridPos = 8; G.qualBonus = 0; G.qualTime = 0;
  G.banner = null; G.bannerT = 0;
  G.finTimeBonus = 0; G.finPassBonus = 0; G.finT = 0;
  G.lapArmed = false;
  for (const c of (G.cars || [])) scene.remove(c.mesh);
  G.cars = [];
  resetPlayer();
}
initGame();

function setState(s) { G.state = s; G.stateT = 0; }
function flash(msg, t) { G.banner = msg; G.bannerT = t || 2; }

function makeCar(s, offset, maxPct, colorIdx, rival) {
  const mesh = buildF1(...CAR_COLORS[colorIdx % 4]);
  scene.add(mesh);
  return { s, offset, speed: 0, maxPct, mesh, ahead: true, rival };
}
function carAhead(c) {
  const d = (c.s - G.pos + TRACK_LEN * 1.5) % TRACK_LEN - TRACK_LEN / 2;
  return d > 0;
}
function setupRaceGrid() {
  for (const c of G.cars) scene.remove(c.mesh);
  G.cars = [];
  const slots = [];
  for (let k = 0; k < 8; k++)
    slots.push({ s: TRACK_LEN - (k * 9 + 7), off: k % 2 ? 2.2 : -2.2 });
  const mySlot = G.gridPos - 1;
  G.pos = wrapS(slots[mySlot].s);
  G.playerX = slots[mySlot].off;
  let n = 0;
  for (let k = 0; k < 8; k++) {
    if (k === mySlot) continue;
    G.cars.push(makeCar(wrapS(slots[k].s), slots[k].off, 0.60 + 0.025 * (7 - k), n, true));
    n++;
  }
  for (let t = 0; t < 4; t++) {
    const car = makeCar(wrapS(G.pos + (t + 1) * (TRACK_LEN / 5.2)),
      (t % 2 ? -2.6 : 2.6) + (t % 3), 0.44 + 0.04 * (t % 3), t, false);
    G.cars.push(car);
  }
  for (const c of G.cars) c.ahead = carAhead(c);
  G.speed = 0; G.gear = 0; G.crashed = 0; G.steer = 0;
  G.lapArmed = false;
}

/* ---------------- input ---------------- */
const keys = {};
window.addEventListener('keydown', (e) => {
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' '].includes(e.key)) e.preventDefault();
  AudioFX.ensure();
  if (AudioFX.ctx && AudioFX.ctx.state === 'suspended') AudioFX.ctx.resume();
  if (e.repeat) return;
  keys[e.key.toLowerCase()] = true;
  if (e.key === 'Shift' || e.key.toLowerCase() === 'z') {
    if (G.state === 'qualify' || G.state === 'race') {
      G.gear = 1 - G.gear;
      AudioFX.beep(G.gear ? 220 : 150, 0.08, 0.1);
    }
  }
  if (e.key.toLowerCase() === 'm') {
    AudioFX.muted = !AudioFX.muted;
    if (AudioFX.muted && AudioFX.engineGain) AudioFX.engineGain.gain.value = 0;
  }
  if ((e.key === 'Enter' || e.key === ' ') && G.state === 'title') startGame();
});
window.addEventListener('keyup', (e) => { keys[e.key.toLowerCase()] = false; });

function startGame() {
  initGame();
  setState('prequal');
  flash('PREPARE TO QUALIFY', 2.4);
  AudioFX.jingle([784, 784, 659, 784, 1047], 130);
}

/* ---------------- simulation ---------------- */
let frame = 0;
function accelFor(gear, speedPct) {
  const cap = gear ? 1 : 0.46;
  if (speedPct >= cap) return 0;
  const head = 1 - speedPct / cap;
  return (gear ? MAX_SPEED / 7 : MAX_SPEED / 3) * (0.3 + 0.7 * head);
}
function doCrash() {
  if (G.crashed > 0) return;
  G.crashed = 2.4;
  G.speed = 0;
  spawnExplosion(posAt(G.pos, G.playerX).setY(0.6));
  AudioFX.crash();
  AudioFX.engine(false, 0);
}

function updateDriving(dt, racing) {
  const speedPct = G.speed / MAX_SPEED;

  if (G.crashed > 0) {
    G.crashed -= dt;
    G.speed = Math.max(0, G.speed - MAX_SPEED * dt);
    if (G.crashed <= 0) {
      G.crashed = 0;
      G.playerX = Math.max(-HALF_W + 1.2, Math.min(HALF_W - 1.2, G.playerX));
      G.gear = 0;
    }
  } else {
    if (keys['arrowup'] || keys['w']) G.speed += accelFor(G.gear, speedPct) * dt;
    else G.speed -= MAX_SPEED / 8 * dt;
    if (keys['arrowdown'] || keys['s'] || keys[' ']) G.speed -= MAX_SPEED / 3 * dt;
    const cap = (G.gear ? 1 : 0.46) * MAX_SPEED;
    if (G.speed > cap) G.speed = Math.max(cap, G.speed - MAX_SPEED / 4 * dt);
    const offRoad = Math.abs(G.playerX) > HALF_W;
    if (offRoad) {
      if (G.speed > MAX_SPEED * 0.35) G.speed -= MAX_SPEED * 0.9 * dt;
      if ((frame & 7) === 0) AudioFX.skid();
    }
    G.speed = Math.max(0, Math.min(MAX_SPEED, G.speed));

    const sp = G.speed / MAX_SPEED;
    let st = 0;
    if (keys['arrowleft'] || keys['a']) st = -1;
    if (keys['arrowright'] || keys['d']) st = 1;
    G.steer = st;
    G.playerX += st * 13 * sp * dt;
    // centrifugal drift, from true curvature
    const k = kappaAt(G.pos + G.speed * 0.25);
    G.playerX -= k * G.speed * G.speed * 0.1 * dt;
    if (Math.abs(k) > 0.02 && sp > 0.7 && (frame & 5) === 0) AudioFX.skid();
    G.playerX = Math.max(-HALF_W * 2.2, Math.min(HALF_W * 2.2, G.playerX));

    // hazards
    for (const h of hazards) {
      const dz = (h.s - G.pos + TRACK_LEN * 1.5) % TRACK_LEN - TRACK_LEN / 2;
      if (dz < -3 || dz > 5) continue;
      if (h.kind === 'puddle') {
        if (Math.abs(G.playerX - h.x) < 2.4 && G.speed > MAX_SPEED * 0.3) {
          G.speed *= (1 - 3 * dt);
          G.playerX += (G.playerX < h.x ? -1 : 1) * 4 * dt;
          AudioFX.skid();
        }
      } else if (Math.abs(G.playerX - h.x) < 2.6 && G.speed > MAX_SPEED * 0.05) {
        doCrash();
      }
    }
  }

  const prevPos = G.pos;
  G.pos = wrapS(G.pos + G.speed * dt);
  const crossed = G.pos < prevPos && G.speed > 0;
  if (racing || G.state === 'qualify')
    G.score += (G.speed * dt / TRACK_LEN) * PTS_PER_LAP;

  if (racing) updateCars(dt);

  const capPct = (G.gear ? 1 : 0.46);
  AudioFX.engine(G.crashed <= 0 && G.speed > 0.5,
    Math.min(1, (G.speed / MAX_SPEED) / capPct) * (G.gear ? 0.85 : 1));
  return crossed;
}

function updateCars(dt) {
  for (const c of G.cars) {
    const kAhead = Math.abs(kappaAt(c.s + c.speed * 0.9));
    const safe = 1 - Math.min(0.55, kAhead * (c.rival ? 14 : 22));
    const target = MAX_SPEED * c.maxPct * safe;
    c.speed += Math.min(1, dt * 0.5) * (target - c.speed);
    c.s = wrapS(c.s + c.speed * dt);
    // drift toward the inside of the corner
    const k = kappaAt(c.s);
    const want = Math.max(-3.4, Math.min(3.4, c.offset + (k > 0.004 ? 0.5 : k < -0.004 ? -0.5 : 0)));
    c.offset += (want - c.offset) * Math.min(1, dt * 0.6);

    const nowAhead = carAhead(c);
    if (c.ahead && !nowAhead && G.crashed <= 0) { G.passed++; AudioFX.beep(880, 0.05, 0.08); }
    c.ahead = nowAhead;

    if (G.crashed <= 0) {
      const dz = (c.s - G.pos + TRACK_LEN * 1.5) % TRACK_LEN - TRACK_LEN / 2;
      if (dz > -4.5 && dz < 5.5 && Math.abs(c.offset - G.playerX) < 1.9 &&
          G.speed > MAX_SPEED * 0.08) {
        doCrash();
      }
    }
  }
}

function update(dt) {
  G.stateT += dt;
  if (G.bannerT > 0) { G.bannerT -= dt; if (G.bannerT <= 0) G.banner = null; }
  frame++;
  updateExplosion(dt);

  switch (G.state) {
    case 'title':
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
        if (!G.lapArmed) {
          G.lapArmed = true;
          G.lapTime = 0;
        } else if (G.lap >= RACE_LAPS) {
          finishRace();
          break;
        } else {
          G.lap++;
          G.lapTime = 0;
          G.timer += EXT_TIME;
          flash('EXTENDED PLAY!', 1.6);
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
      G.pos = wrapS(G.pos + G.speed * dt);
      if (G.stateT > 3.2) gameOver();
      break;

    case 'finish': {
      G.speed = Math.max(0, G.speed - MAX_SPEED * dt * 0.4);
      G.pos = wrapS(G.pos + G.speed * dt);
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
      if (G.stateT > 3.4) setState('title');
      break;
  }

  if (G.score > topScore) {
    topScore = Math.floor(G.score);
    try { localStorage.setItem('pp_top', String(topScore)); } catch (e) {}
  }
}
function finishRace() {
  setState('finish');
  G.finT = 0; G.finTimeBonus = 0; G.finPassBonus = 0;
  flash('GOAL!', 2.2);
  AudioFX.goal();
}
function gameOver() {
  AudioFX.engine(false, 0);
  setState('gameOver');
}

/* ---------------- 3D view ---------------- */
const _eye = new THREE.Vector3(), _look = new THREE.Vector3();
function updateView() {
  const driving = ['qualify', 'race', 'finish', 'timeUp', 'lightsQ', 'lightsR',
    'qualDone', 'qualFail'].includes(G.state);

  // player car
  playerMesh.visible = driving && G.crashed <= 0 &&
    !((G.state === 'lightsQ' || G.state === 'lightsR') && frame % 16 < 8);
  if (driving) {
    posAt(G.pos, G.playerX, playerMesh.position);
    playerMesh.rotation.y = headingAt(G.pos) - G.steer * 0.14 * (0.3 + 0.7 * G.speed / MAX_SPEED);
    playerMesh.position.y = G.speed > 5 ? (frame % 6 < 3 ? 0 : 0.05) : 0;
  }

  // rivals
  for (const c of G.cars) {
    posAt(c.s, c.offset, c.mesh.position);
    c.mesh.rotation.y = headingAt(c.s);
  }

  if (window.__ppTopView) {
    posAt(G.pos, 0, _eye);
    camera.position.set(_eye.x, 900, _eye.z);
    camera.lookAt(_eye.x, 0, _eye.z + 0.01);
    renderer.render(scene, camera);
    return;
  }
  if (driving) {
    // chase camera
    posAt(G.pos - 11, G.playerX * 0.72, _eye);
    _eye.y = 4.6;
    posAt(G.pos + 10, G.playerX * 0.4, _look);
    _look.y = 1.3;
    if (G.crashed > 1.3) {                    // shake during the blast
      _eye.x += Math.sin(frame * 1.7) * 0.35;
      _eye.y += Math.cos(frame * 2.3) * 0.3;
    }
    camera.position.copy(_eye);
    camera.lookAt(_look);
  } else {
    // title / game-over: slow flyover around the circuit
    const s = (performance.now() / 1000 * 22) % TRACK_LEN;
    posAt(s, 0, _eye);
    _eye.y = 15;
    posAt(s + 55, 0, _look);
    _look.y = 2;
    camera.position.copy(_eye);
    camera.lookAt(_look);
  }
  renderer.render(scene, camera);
}

/* ---------------- HUD (2D overlay, arcade layout) ---------------- */
function fmtLap(t) {
  const s = Math.floor(t), c = Math.floor((t - s) * 100);
  return String(s) + '"' + String(c).padStart(2, '0');
}
function renderHUD() {
  ctx.fillStyle = C.black;
  ctx.fillRect(0, 0, HW, 20);
  drawText('TOP', 6, 2, C.hudRed);
  drawText(String(Math.floor(topScore)), 32, 2, C.hudWhite);
  drawText('TIME', 100, 2, C.hudYel);
  ctx.fillStyle = C.hudBlue;
  ctx.fillRect(168, 0, 88, 10);
  const inRace = ['qualify', 'race', 'finish', 'timeUp'].includes(G.state);
  drawText('LAP', 174, 2, C.hudWhite);
  drawText(inRace ? fmtLap(G.lapTime) : '0"00', 200, 2, C.hudWhite);
  if (G.state === 'race' || G.state === 'finish')
    drawText(G.lap + '/' + RACE_LAPS, 232, 11, C.hudCyan);
  else if (G.state === 'qualify')
    drawText('QUAL', 232, 11, C.hudCyan);
  drawText('SCORE', 6, 11, C.hudYel);
  drawText(String(Math.floor(G.score / 10) * 10), 42, 11, C.hudWhite);
  const showTimer = ['qualify', 'race', 'lightsQ', 'lightsR', 'finish', 'timeUp'].includes(G.state);
  drawText(showTimer ? String(Math.max(0, Math.ceil(G.timer))) : '', 106, 11,
    G.timer < 15 && (frame % 20 < 10) ? C.hudRed : C.hudWhite);
  const kmh = Math.round(G.speed / MAX_SPEED * 315);
  drawText('SPEED', 128, 11, C.hudYel);
  drawText(String(kmh) + 'KM', 166, 11, C.hudWhite);
  if (['qualify', 'race', 'finish', 'timeUp', 'lightsQ', 'lightsR'].includes(G.state))
    drawText(G.gear ? 'HI' : 'LO', HW - 18, HH - 10, C.hudWhite);
}
function renderLights() {
  if (G.state !== 'lightsQ' && G.state !== 'lightsR') return;
  const step = Math.floor(G.stateT / 0.8);
  const cx = HW / 2, y = 110;
  ctx.fillStyle = '#000';
  ctx.fillRect(cx - 26, y - 6, 52, 16);
  for (let i = 0; i < 3; i++) {
    const on = step >= i;
    const last = G.stateT > 2.15;
    ctx.fillStyle = last ? '#00d800' : (on ? '#f83800' : '#480000');
    ctx.fillRect(cx - 20 + i * 15, y - 2, 10, 8);
  }
}
function renderBanner() {
  if (G.banner && (frame % 14 < 9)) {
    const y = 70;
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    const w = textW(G.banner, 1) + 10;
    ctx.fillRect((HW - w) / 2, y - 3, w, 13);
    drawTextC(G.banner, y, C.hudYel);
  }
}
function shade(y0, h) {
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillRect(24, y0, HW - 48, h);
}
function renderStateOverlays() {
  switch (G.state) {
    case 'title': {
      shade(36, 56);
      drawTextC('POLE', 44, C.hudRed, 3);
      drawTextC('POSITION', 68, C.hudRed, 3);
      shade(102, 84);
      drawTextC('TOP SCORE ' + topScore, 108, C.hudYel);
      if (frame % 40 < 26) drawTextC('PRESS ENTER TO RACE', 130, C.hudWhite);
      drawTextC('QUALIFY IN UNDER 73"00', 154, C.hudCyan);
      drawTextC('THEN RACE ' + RACE_LAPS + ' LAPS', 166, C.hudCyan);
      break;
    }
    case 'qualDone': {
      shade(78, 90);
      drawTextC('QUALIFIED!', 84, C.hudYel, 2);
      drawTextC('TIME ' + fmtLap(G.qualTime), 108, C.hudWhite);
      drawTextC('GRID POSITION ' + G.gridPos, 122, C.hudWhite);
      drawTextC('BONUS ' + G.qualBonus + ' PTS', 136, C.hudCyan);
      if (G.stateT > 1.6) drawTextC('GET READY...', 154, C.hudRed);
      break;
    }
    case 'qualFail': {
      shade(84, 66);
      drawTextC('YOU FAILED', 90, C.hudRed, 2);
      drawTextC('TO QUALIFY', 110, C.hudRed, 2);
      if (G.qualTime > 0) drawTextC('TIME ' + fmtLap(G.qualTime), 134, C.hudWhite);
      break;
    }
    case 'timeUp': {
      shade(90, 26);
      drawTextC('TIME UP', 96, C.hudRed, 2);
      break;
    }
    case 'finish': {
      if (G.finT > 1.2) {
        shade(98, 56);
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
      shade(90, 60);
      drawTextC('GAME OVER', 96, C.hudRed, 2);
      drawTextC('SCORE ' + Math.floor(G.score / 10) * 10, 124, C.hudWhite);
      if (Math.floor(G.score) >= topScore) drawTextC('NEW TOP SCORE!', 140, C.hudYel);
      break;
    }
  }
}
function renderHud2D() {
  ctx.clearRect(0, 0, HW, HH);
  renderHUD();
  renderLights();
  renderBanner();
  renderStateOverlays();
}

/* ---------------- main loop ---------------- */
let last = performance.now(), acc = 0;
const STEP = 1 / 60;
function loop(now) {
  let dt = (now - last) / 1000;
  last = now;
  if (dt > 0.1) dt = 0.1;
  acc += dt;
  while (acc >= STEP) { update(STEP); acc -= STEP; }
  updateView();
  renderHud2D();
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

/* debug hooks for automated testing */
window.__pp = {
  get G() { return G; },
  keys, kappaAt, posAt, TRACK_LEN, MAX_SPEED, scene, camera, renderer,
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
