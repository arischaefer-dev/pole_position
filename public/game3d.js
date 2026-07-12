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
   - Sign contact explodes the car; other cars can be bumped
     and traded paint with; puddles + grass slow it. LO/HI
     gears, top 315 km/h. Timer ticks at ~2x real time.
   ============================================================ */
import * as THREE from 'three';
import { EffectComposer } from './lib/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from './lib/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from './lib/jsm/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from './lib/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from './lib/jsm/postprocessing/OutputPass.js';
import { NET, SnapshotBuffer, saveResume, takeResume, guardReload,
         clearReloadGuard } from './net.js?v=1';

/* ---------------- canvases ---------------- */
const HW = 256, HH = 224;              // HUD logical resolution
const GLW = 1024, GLH = 896;           // 3D internal resolution (8:7 arcade aspect)
const glCanvas = document.getElementById('gl');
const hudCanvas = document.getElementById('hud');
const ctx = hudCanvas.getContext('2d');

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
  const raw = Math.min(availW / HW, availH / HH);
  // integer scale for crisp pixels on big screens, fractional on small ones
  const s = raw >= 2 ? Math.floor(raw) : Math.max(0.75, raw);
  for (const c of [glCanvas, hudCanvas]) {
    c.style.width = Math.floor(HW * s) + 'px';
    c.style.height = Math.floor(HH * s) + 'px';
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
    // slow LFO breathes the filter for a living idle
    const lfo = this.ctx.createOscillator();
    lfo.frequency.value = 5.5;
    const lfoGain = this.ctx.createGain();
    lfoGain.gain.value = 90;
    lfo.connect(lfoGain); lfoGain.connect(lp.frequency);
    lfo.start();
    this.engineOsc.start(); this.engineOsc2.start(); this.engineOsc3.start();
    const len = this.ctx.sampleRate;
    this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  },
  engine(on, rpm, hiGear) {
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

/* ---------------- track: closed spline (stylized Fuji) ---------------- */
/* Layout drives like the arcade course: long start/finish straight,
   sharp right, easy left kink, sweeping right, a right leading into
   the hard left hairpin, then a long gradual right onto the straight. */
const LAP_TARGET = 2000;                 // meters
const HALF_W = 5.5;                      // road half width, meters
const N_SAMP = 1600;

/* x is negated vs the drawing-board sketch so the turns read correctly
   on screen (screen-right for a forward camera is world -x).
   Tight corners are generated as true circular arcs — hand-placed
   Catmull-Rom points overshoot badly at hairpin-scale curvature. */
function arcPts(cx, cz, r, a0deg, a1deg, n) {
  const out = [];
  for (let i = 0; i <= n; i++) {
    const a = (a0deg + (a1deg - a0deg) * i / n) * Math.PI / 180;
    out.push([cx + r * Math.cos(a), cz + r * Math.sin(a)]);
  }
  return out;
}
const TRACKS = {
  fuji: {
    name: 'FUJI SPEEDWAY', theme: 'fuji',
    boards: [{ img: 'pepsi' }, { img: 'cola' }, { img: 'michelin' }, { img: 'castrol' },
             { img: 'fuji' }, { img: 'pepsi' }, { img: 'cola' }, { img: 'michelin' }],
    cp: [
      [0, -90], [0, 150], [0, 400], [0, 600],              // front straight
      [-30, 700], [-130, 730], [-230, 690],                // T1 sharp right
      [-330, 660], [-430, 680], [-530, 650],               // easy left kink
      [-640, 600], [-700, 480], [-650, 360], [-540, 320],  // sweeping right horseshoe
      [-430, 300], [-380, 302],                            // run back
      ...arcPts(-330, 400, 90, 270, 360, 4),               // right lead-in quarter arc
      [-238, 445],
      ...arcPts(-168, 490, 66, 180, 0, 6),                 // LEFT HAIRPIN (min r ~24m)
      [-104, 452], [-114, 412], [-135, 362],               // graduated exit
      [-170, 230], [-195, 60], [-206, -80],                // descent to the cap
      [-210, -150], [-210, -192],
      ...arcPts(-105, -235, 105, 180, 360, 6),             // wide cap arc onto the straight
      [0, -160]
    ]
  },
  seaside: {
    name: 'SEASIDE RUN', theme: 'seaside',
    boards: [{ img: 'cola' }, { text: 'SURF SHACK', bg: '#0058f8', fg: '#fcfcfc' },
             { img: 'michelin' }, { text: 'GELATO', bg: '#fc74b4', fg: '#fcfcfc' },
             { img: 'pepsi' }, { text: 'MARINA', bg: '#00a8a8', fg: '#fcfcfc' },
             { img: 'castrol' }, { img: 'cola' }],
    cp: [
      [0, -90], [0, 10], [0, 95], [0, 140],             // grid straight (palm boulevard)
      ...arcPts(-95, 175, 95, 0, 90, 6),                // T1 flat-out sweeper to the coast
      [-130, 270], [-158, 270],                         // graduated west link
      ...arcPts(-180, 330, 60, 270, 160, 6),            // climbing carousel (~41m)
      [-230, 368],                                      // inflection breather
      ...arcPts(-263, 400.6, 42, -20, 180, 10),         // LIGHTHOUSE HAIRPIN (~30m)
      [-305.5, 384], [-306, 367], [-305, 330], [-305, 190], // coast road along the beach
      [-292, 105], [-256, 40], [-249, -60], [-244, -150],   // beach esses drifting inland
      ...arcPts(-122, -226, 122, 180, 360, 6),          // fast final cap onto the grid
      [0, -158]                                         // collinear grid anchor
    ]
  },
  canyon: {
    name: 'CANYON RUN', theme: 'canyon',
    boards: [{ text: 'ROUTE 66', bg: '#181818', fg: '#fcfcfc' },
             { text: 'RED ROCK DINER', bg: '#d81800', fg: '#ffe9c8' },
             { text: 'DESERT GAS', bg: '#f8b800', fg: '#181818' },
             { text: 'MOTEL SAGUARO', bg: '#00887c', fg: '#fcfcfc' },
             { img: 'michelin' }, { img: 'cola' },
             { text: 'ROUTE 66', bg: '#181818', fg: '#fcfcfc' }],
    cp: [
      [0, -150], [0, -20], [0, 120], [0, 165], [0, 195], // grid straight, graduated
      ...arcPts(-80, 220, 80, 0, 90, 5),                // T1 sweeper
      [-108, 300], [-138, 300], [-180, 300], [-240, 300], [-268, 300], // mesa run
      ...arcPts(-290, 250, 50, 90, 180, 5),             // T2 onto the drag strip
      [-340, 218], [-340, 182], [-340, 120], [-340, 20], [-340, -120], [-340, -260], // MONSTER straight (narrows)
      [-340, -330], [-340, -360], [-340, -372],         // graduated braking approach
      ...arcPts(-304, -384, 36, 180, 270, 6),           // T3 brutal right-angle (~28m)
      [-292, -420], [-278, -420], [-258, -420], [-228, -420], [-160, -420], [-95, -420], // canyon floor
      ...arcPts(-72, -348, 72, 270, 360, 5),            // T4 back onto the grid
      [0, -318], [0, -288], [0, -252]                   // collinear grid anchors
    ]
  },
  neon: {
    name: 'NEON CITY', theme: 'neon',
    boards: [{ neon: 'ULTRA ARCADE', color: '#ff2bd6' },
             { neon: 'HOTEL NEON', color: '#2be8ff' },
             { neon: 'SUSHI BAR', color: '#ffe22b' },
             { neon: 'CLUB 88', color: '#8f4bff' },
             { img: 'pepsi' },
             { neon: 'LATE DINER', color: '#ff7a2b' },
             { neon: 'KARAOKE', color: '#2bff8a' }],
    cp: [
      [0, -190], [0, -60], [0, 90], [0, 145],           // grid boulevard
      ...arcPts(-60, 185, 60, 0, 90, 5),                // block corner 1
      [-90, 245], [-122, 245], [-160, 245], [-205, 245], // uptown block, graduated
      ...arcPts(-230, 193, 52, 90, 180, 5),             // block corner 2
      [-282, 172], [-282, 150], [-282, 118], [-282, 60], // avenue, graduated
      [-287, 20], [-322, -15], [-324, -80],             // CHICANE (underpass jog)
      [-322, -150], [-322, -230], [-322, -300], [-322, -328], // downtown avenue
      ...arcPts(-270, -345, 52, 180, 270, 5),           // block corner 3
      [-243, -397], [-212, -397], [-175, -397], [-135, -397], // crosstown block
      ...arcPts(-85, -312, 85, 270, 360, 5),            // sweeper onto the grid
      [0, -255]                                         // collinear grid anchor
    ]
  },
  alpine: {
    name: 'ALPINE PASS', theme: 'alpine',
    boards: [{ text: 'EDELWEISS', bg: '#7c2c14', fg: '#ffe9c8' },
             { text: 'ST MORITZ SKI', bg: '#0058f8', fg: '#fcfcfc' },
             { text: 'GLACIER WATER', bg: '#2bb8e8', fg: '#08303c' },
             { text: 'ALPENHOTEL', bg: '#186428', fg: '#ffe9c8' },
             { img: 'castrol' }, { img: 'michelin' },
             { text: 'CHOCOLAT', bg: '#5c3a1e', fg: '#ffe9c8' }],
    cp: [
      [0, -120], [0, -10], [0, 100], [0, 138],          // grid straight
      ...arcPts(-70, 170, 70, 0, 90, 5),                // T1 into the valley
      [-98, 240], [-128, 240], [-165, 240], [-193, 240], [-206, 240], // valley run
      ...arcPts(-220, 270, 30, 270, 90, 8),             // SWITCHBACK A (~20m)
      [-204, 300], [-186, 300], [-160, 300], [-125, 300], [-105, 300], [-93, 300], // climb ledge
      ...arcPts(-80, 330, 30, 270, 450, 8),             // SWITCHBACK B (~20m)
      [-93, 360], [-108, 360], [-132, 360], [-170, 360], [-220, 360], [-275, 360], [-292, 360], // high road
      ...arcPts(-305, 305, 55, 90, 180, 5),             // crest corner
      [-360, 282], [-360, 256], [-360, 200], [-360, 90], [-360, -40], [-360, -160], // descent
      [-360, -208], [-360, -228],                       // graduated sweeper approach
      ...arcPts(-305, -245, 55, 180, 270, 5),           // valley sweeper
      [-288, -300], [-272, -300], [-246, -300], [-210, -300], [-165, -300], [-128, -300], // lake shore
      ...arcPts(-82, -218, 82, 270, 360, 5),            // final corner onto the grid
      [0, -186], [0, -155]                              // collinear grid anchors
    ]
  },
  jungle: {
    name: 'JUNGLE RAPIDS', theme: 'jungle',
    boards: [{ text: 'CAFE RIO', bg: '#5c3a1e', fg: '#ffe9c8' },
             { text: 'AERO BRASIL', bg: '#00a800', fg: '#f8e848' },
             { text: 'CARNAVAL', bg: '#fc00a8', fg: '#f8e848' },
             { text: 'RIO RADIO', bg: '#f8b800', fg: '#181818' },
             { img: 'cola' }, { img: 'michelin' },
             { text: 'GUARANA', bg: '#00887c', fg: '#fcfcfc' }],
    cp: [
      [0, -140], [0, -30], [0, 90], [0, 135],           // grid straight
      ...arcPts(-90, 160, 90, 0, 90, 6),                // T1 onto the ridge
      [-124, 254], [-158, 258], [-215, 242], [-272, 258], [-329, 242], [-372, 254], // CHAINED ESSES
      ...arcPts(-400, 195, 60, 90, 180, 5),             // bend down to the river
      [-460, 162], [-460, 132], [-460, 80], [-460, -20], [-460, -120], [-460, -220], // RIVERSIDE straight
      [-460, -262], [-460, -286],                       // graduated sweeper approach
      ...arcPts(-402, -304, 58, 180, 270, 5),           // river sweeper
      [-386, -362], [-368, -362], [-340, -362], [-296, -362], [-248, -362], [-205, -362], // clearing run
      ...arcPts(-112, -250, 112, 270, 360, 5),          // BIG final carousel
      [0, -196]                                         // collinear grid anchor
    ]
  },
  peg: {
    name: 'WINNIPEG', theme: 'peg',
    boards: [{ img: 'canada' }, { img: 'manitoba' },
             { text: 'PORTAGE MAIN', bg: '#181818', fg: '#fcfcfc' },
             { text: 'THE FORKS', bg: '#00887c', fg: '#fcfcfc' },
             { text: 'PRAIRIE CHIPS', bg: '#f8b800', fg: '#181818' },
             { text: 'RED RIVER ALE', bg: '#7c2c14', fg: '#ffe9c8' },
             { text: 'WPG HOCKEY', bg: '#041e42', fg: '#fcfcfc' },
             { text: 'NESTAWEYA', bg: '#0058f8', fg: '#fcfcfc' }],
    cp: [
      [0, -190], [0, -60], [0, 90], [0, 180],           // Broadway grid straight (Legislature)
      ...arcPts(-95, 240, 95, 0, 90, 5),                // T1 fast sweeper
      [-150, 335], [-200, 335], [-228, 335],            // downtown link
      ...arcPts(-250, 290, 45, 90, 180, 6),             // PORTAGE & MAIN (hard 90, ~35m)
      [-295, 268], [-295, 246], [-295, 214], [-295, 140], // Main Street south, graduated
      [-303, 80], [-345, 30], [-350, -40],              // Exchange District esses
      [-348, -120], [-348, -200], [-348, -245], [-348, -270], // run down to the river
      ...arcPts(-293, -298, 55, 180, 270, 5),           // river bend
      [-268, -353], [-248, -353], [-215, -353], [-175, -353], [-135, -353], // RIVERSIDE straight
      ...arcPts(-105, -248, 105, 270, 360, 5),          // CONFLUENCE sweeper onto the grid
      [0, -222]                                         // collinear grid anchor
    ]
  }
};
let TRACK_ID = 'fuji';
try {
  const d = JSON.parse(localStorage.getItem('pp_dip') || '{}');
  if (TRACKS[d.track]) TRACK_ID = d.track;
} catch (e) {}
const CP_RAW = TRACKS[TRACK_ID].cp;
const THEME = TRACKS[TRACK_ID].theme;

/* per-theme environment: sky gradient, lighting, ground, mountains, water */
const ENVS = {
  fuji: {
    bg: 0x3cbcfc, fog: [0xaedcf7, 700, 2300],
    sky: ['#155fc4', '#4fb2f0', '#a8ddff', '#ffe6c4'],
    hemi: [0xbfe0ff, 0x3f7d2f, 0.7], amb: 0.22, sun: [0xfff2dd, 3.0],
    envSky: 0x86c8f2, envGnd: 0x3f8f3f,
    grass: ['#278c31', ['#237e2b', '#2f9a39', '#289232', '#1f7527']],
    mt: [0x2e7d3a, 0x7fa8bf], pud: [0x35506a, 0x4a6a8a]
  },
  canyon: {
    bg: 0x7fb4e8, fog: [0xf0d2a0, 650, 2200],
    sky: ['#3a78c9', '#7fb4e8', '#f5cf9a', '#ffb46a'],
    hemi: [0xffe8c0, 0x9a6f42, 0.65], amb: 0.24, sun: [0xffe9c8, 3.0],
    envSky: 0xf0c890, envGnd: 0xc09a5f,
    grass: ['#d8b070', ['#cda45f', '#e0bc7e', '#d2a869', '#c69c58']],
    mt: [0xb05a34, 0xd89a6a], pud: [0x35506a, 0x4a6a8a]
  },
  neon: {
    bg: 0x0a0a18, fog: [0x0d0d20, 450, 1700], night: true,
    sky: ['#03030a', '#080a1a', '#101430', '#241a3c'],
    hemi: [0x2a3a6a, 0x0c0c16, 0.4], amb: 0.18, sun: [0x9ab8ff, 1.1],
    envSky: 0x10142a, envGnd: 0x0a0a12,
    grass: ['#16161e', ['#12121a', '#1a1a24', '#141420', '#101018']],
    mt: [0x11131c, 0x1c2030], pud: [0x24335a, 0x36497a]
  },
  alpine: {
    bg: 0xcfe8f8, fog: [0xe8f4fc, 650, 2300],
    sky: ['#4a86d8', '#9cc8ee', '#e8f4fc', '#ffffff'],
    hemi: [0xeaf4ff, 0xcfd8de, 0.75], amb: 0.26, sun: [0xfff8ee, 3.1],
    envSky: 0xbfe0f4, envGnd: 0xd8e4ea,
    grass: ['#e8eef2', ['#dde6ec', '#f2f6f8', '#d2dce4', '#e4ecf0']],
    mt: [0x7d8894, 0xc4d2de], pud: [0x9fc4e0, 0xc4e2f4]   // ICE
  },
  jungle: {
    bg: 0x6cc0e0, fog: [0xc8ecd0, 550, 2000],
    sky: ['#2a7ec4', '#6cc0e0', '#c4ecd8', '#f4ffd8'],
    hemi: [0xd8f4e0, 0x1e5c28, 0.7], amb: 0.22, sun: [0xfff6d8, 2.8],
    envSky: 0x9adcc8, envGnd: 0x2a6e34,
    grass: ['#1d6e26', ['#175c1e', '#238032', '#1a6822', '#14521c']],
    mt: [0x1e6c30, 0x6aa89c], pud: [0x35506a, 0x4a6a8a]
  }
,
  peg: {
    bg: 0x59b0f0, fog: [0xcfe8fa, 700, 2400],
    sky: ['#1b64c8', '#59b0f0', '#bfe4ff', '#ffe9c0'],   // big prairie sky
    hemi: [0xdceeff, 0x557a34, 0.72], amb: 0.22, sun: [0xfff2dd, 3.0],
    envSky: 0x9fd0f0, envGnd: 0x6f9a3f,
    grass: ['#7ba03c', ['#6f9436', '#8fae4a', '#c9a84c', '#5f8830']],
    mt: null,                                            // pancake-flat prairie
    pud: [0x35506a, 0x4a6a8a]
  }
};
ENVS.seaside = ENVS.fuji;
const ENV = ENVS[THEME];

let TRACK_SCALE = 1;   // CP_RAW units -> meters, for placing scenery by CP coords
function buildTrackCurve() {
  const mk = (k) => new THREE.CatmullRomCurve3(
    CP_RAW.map(([x, z]) => new THREE.Vector3(x * k, 0, z * k)), true, 'catmullrom', 0.5);
  TRACK_SCALE = LAP_TARGET / mk(1).getLength();
  return mk(TRACK_SCALE);
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

/* minimap: track outline scaled into a small HUD box (mirrored so
   screen-right on the map matches steering right) */
const MINI = { pts: [], w: 0, h: 0 };
{
  let minX = 1e9, maxX = -1e9, minZ = 1e9, maxZ = -1e9;
  for (const p of PTS) {
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
    minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z);
  }
  const k = 46 / Math.max(maxX - minX, maxZ - minZ);
  MINI.w = (maxX - minX) * k; MINI.h = (maxZ - minZ) * k;
  MINI.map = (p) => [(maxX - p.x) * k, (maxZ - p.z) * k];
  for (let i = 0; i < N_SAMP; i += 10) MINI.pts.push(MINI.map(PTS[i]));
}
const _mini = new THREE.Vector3();

/* ---------------- three.js scene ---------------- */
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas: glCanvas, antialias: true });
} catch (e) {
  document.getElementById('help').textContent = 'WebGL is not available in this browser.';
  throw e;
}
renderer.setSize(GLW, GLH, false);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const scene = new THREE.Scene();
scene.background = new THREE.Color(ENV.bg);
scene.fog = new THREE.Fog(ENV.fog[0], ENV.fog[1], ENV.fog[2]);
const camera = new THREE.PerspectiveCamera(68, GLW / GLH, 1, 4000);
scene.add(new THREE.HemisphereLight(ENV.hemi[0], ENV.hemi[1], ENV.hemi[2]));
scene.add(new THREE.AmbientLight(0xffffff, ENV.amb));
// shadow-casting sun (moon on night tracks); frustum follows the player
const SUN_DIR = new THREE.Vector3(0.49, 0.52, 0.7).normalize();
const sun = new THREE.DirectionalLight(ENV.sun[0], ENV.sun[1]);
sun.position.copy(SUN_DIR).multiplyScalar(220);
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
sun.shadow.camera.left = -70; sun.shadow.camera.right = 70;
sun.shadow.camera.top = 70; sun.shadow.camera.bottom = -70;
sun.shadow.camera.near = 10; sun.shadow.camera.far = 600;
sun.shadow.bias = -0.0005;
scene.add(sun);
scene.add(sun.target);
// environment reflections from a tiny sky+ground scene
{
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envScene = new THREE.Scene();
  envScene.add(new THREE.Mesh(
    new THREE.SphereGeometry(40, 16, 8),
    new THREE.MeshBasicMaterial({ color: ENV.envSky, side: THREE.BackSide })));
  const envGround = new THREE.Mesh(
    new THREE.PlaneGeometry(80, 80),
    new THREE.MeshBasicMaterial({ color: ENV.envGnd }));
  envGround.rotation.x = -Math.PI / 2;
  envGround.position.y = -2;
  envScene.add(envGround);
  scene.environment = pmrem.fromScene(envScene, 0.05).texture;
  pmrem.dispose();
}
/* post-processing: bloom + vignette/saturation */
const composer = new EffectComposer(renderer);
composer.setSize(GLW, GLH);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(GLW, GLH), 0.45, 0.4, 2.6);
composer.addPass(bloom);
const gradePass = new ShaderPass({
  uniforms: { tDiffuse: { value: null } },
  vertexShader: `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    varying vec2 vUv;
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      float g = dot(c.rgb, vec3(0.299, 0.587, 0.114));
      c.rgb = mix(vec3(g), c.rgb, 1.08);                  // gentle saturation
      float d = distance(vUv, vec2(0.5));
      c.rgb *= 1.0 - smoothstep(0.42, 0.85, d) * 0.32;    // vignette
      gl_FragColor = c;
    }`
});
composer.addPass(gradePass);
composer.addPass(new OutputPass());

/* ground */
{
  const grassTex = canvasTexture(128, 128, (g) => {
    g.fillStyle = ENV.grass[0]; g.fillRect(0, 0, 128, 128);
    for (let i = 0; i < 1400; i++) {
      g.fillStyle = ENV.grass[1][i % 4];
      g.fillRect(Math.floor(Math.random() * 128), Math.floor(Math.random() * 128), 2, 2);
    }
  });
  grassTex.magFilter = THREE.LinearFilter;
  grassTex.minFilter = THREE.LinearMipmapLinearFilter;
  grassTex.wrapS = grassTex.wrapT = THREE.RepeatWrapping;
  grassTex.repeat.set(700, 700);
  const g = new THREE.Mesh(
    new THREE.PlaneGeometry(9000, 9000),
    new THREE.MeshStandardMaterial({ map: grassTex, roughness: 1, metalness: 0 }));
  g.rotation.x = -Math.PI / 2;
  g.position.y = -0.4;
  g.receiveShadow = true;
  scene.add(g);
}

/* road ribbon with rumble strips, edge lines, dashes, start checkers */
function buildRoad() {
  const posArr = [], colArr = [], uvArr = [];
  const col = new THREE.Color();
  // ys: single height or [ya, yb, yc, yd] (raised curb edges); v0/v1 tile
  // the asphalt texture along the track
  const quad = (a, b, c, d, colorHex, ys, v0, v1) => {
    col.setHex(colorHex);
    const y = Array.isArray(ys) ? ys : [ys, ys, ys, ys];
    const vtx = [[a, y[0], 0, v0], [b, y[1], 1, v0], [c, y[2], 1, v1], [d, y[3], 0, v1]];
    for (const k of [0, 1, 3, 1, 2, 3]) {
      const [p, py, u, v] = vtx[k];
      posArr.push(p.x, py, p.z);
      colArr.push(col.r, col.g, col.b);
      uvArr.push(u, v);
    }
  };
  const step = Math.max(1, Math.floor(N_SAMP / 1000));
  const P = (i, x) => _road.copy(PTS[i % N_SAMP]).addScaledVector(RIGHT[i % N_SAMP], x).clone();
  const _road = new THREE.Vector3();
  const RUM = 1.5;                       // rumble width
  const CURB = 0.14;                     // raised outer curb edge
  for (let i = 0; i < N_SAMP; i += step) {
    const j = (i + step) % N_SAMP;
    const s = i / N_SAMP * TRACK_LEN;
    const v0 = s / 7, v1 = ((i + step) / N_SAMP * TRACK_LEN) / 7;
    const grp = Math.floor(s / 10) % 2;
    // road, split into three strips so the racing line reads rubbered-in
    const lo0 = Math.max(-2.6, Math.min(2.6, KAPPA[i % N_SAMP] * 300));
    const lo1 = Math.max(-2.6, Math.min(2.6, KAPPA[(i + step) % N_SAMP] * 300));
    const RUB = 0x777777;                  // darker tint over the asphalt tex
    quad(P(i, -HALF_W), P(i, lo0 - 1.3), P(j, lo1 - 1.3), P(j, -HALF_W), C.road, 0, v0, v1);
    quad(P(i, lo0 - 1.3), P(i, lo0 + 1.3), P(j, lo1 + 1.3), P(j, lo0 - 1.3), RUB, 0, v0, v1);
    quad(P(i, lo0 + 1.3), P(i, HALF_W), P(j, HALF_W), P(j, lo1 + 1.3), C.road, 0, v0, v1);
    // rumble strips, outer edge raised like a real curb
    const rc = grp ? C.rumbleR : C.rumbleW;
    quad(P(i, -HALF_W - RUM), P(i, -HALF_W), P(j, -HALF_W), P(j, -HALF_W - RUM),
      rc, [CURB, 0.02, 0.02, CURB], v0, v1);
    quad(P(i, HALF_W), P(i, HALF_W + RUM), P(j, HALF_W + RUM), P(j, HALF_W),
      rc, [0.02, CURB, CURB, 0.02], v0, v1);
    // edge lines
    quad(P(i, -HALF_W + 0.25), P(i, -HALF_W + 0.55), P(j, -HALF_W + 0.55), P(j, -HALF_W + 0.25), C.lane, 0.015, v0, v1);
    quad(P(i, HALF_W - 0.55), P(i, HALF_W - 0.25), P(j, HALF_W - 0.25), P(j, HALF_W - 0.55), C.lane, 0.015, v0, v1);
    // center dashes
    if (grp) quad(P(i, -0.15), P(i, 0.15), P(j, 0.15), P(j, -0.15), C.lane, 0.015, v0, v1);
    // start-line checkers (first ~6 m)
    if (s < 6) {
      for (let cxx = 0; cxx < 8; cxx++) {
        if ((cxx + Math.floor(s / 3)) % 2) continue;
        const x0 = -HALF_W + (2 * HALF_W) * cxx / 8, x1 = x0 + 2 * HALF_W / 8;
        quad(P(i, x0), P(i, x1), P(j, x1), P(j, x0), 0xfcfcfc, 0.03, v0, v1);
      }
    }
  }
  // near-white asphalt speckle so vertex-color tints stay true
  const asphaltTex = canvasTexture(256, 256, (g) => {
    g.fillStyle = '#f2f2f2'; g.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 5200; i++) {
      const shade = 205 + Math.floor(Math.random() * 50);
      g.fillStyle = 'rgb(' + shade + ',' + shade + ',' + shade + ')';
      g.fillRect(Math.floor(Math.random() * 256), Math.floor(Math.random() * 256), 2, 2);
    }
  });
  asphaltTex.magFilter = THREE.LinearFilter;
  asphaltTex.minFilter = THREE.LinearMipmapLinearFilter;
  asphaltTex.wrapS = asphaltTex.wrapT = THREE.RepeatWrapping;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(posArr, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colArr, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvArr, 2));
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo,
    new THREE.MeshStandardMaterial({
      map: asphaltTex, vertexColors: true, roughness: 0.94, metalness: 0,
      side: THREE.DoubleSide,
      // pull the road toward the camera in depth so the huge ground
      // plane can never z-fight it away at distance
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2
    }));
  mesh.receiveShadow = true;
  scene.add(mesh);
}
buildRoad();

/* scenery: per-theme world dressing */
if (THEME === 'seaside') {
  const S = TRACK_SCALE;
  // ocean + sandy shore hugging the west side (the coast road runs along it)
  const sea = new THREE.Mesh(
    new THREE.PlaneGeometry(6000, 9000),
    new THREE.MeshStandardMaterial({ color: 0x1a6fc4, roughness: 0.22, metalness: 0.55 }));
  sea.rotation.x = -Math.PI / 2;
  sea.position.set(-3475, -0.25, 0);
  scene.add(sea);
  const beach = new THREE.Mesh(
    new THREE.PlaneGeometry(160, 9000),
    new THREE.MeshStandardMaterial({ color: 0xe6d5a0, roughness: 1 }));
  beach.rotation.x = -Math.PI / 2;
  beach.position.set(-400, -0.32, 0);
  scene.add(beach);
  // foam lines where the surf meets the sand
  for (const [w, off, op] of [[6, 0, 0.6], [4, 9, 0.38], [3, 19, 0.22]]) {
    const foam = new THREE.Mesh(
      new THREE.PlaneGeometry(w, 9000),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: op }));
    foam.rotation.x = -Math.PI / 2;
    foam.position.set(-478 - off, -0.18, 0);
    scene.add(foam);
  }

  // palm trees: curved trunk + frond crown + coconuts
  const trunkMat = new THREE.MeshLambertMaterial({ color: 0x8a6a42 });
  const frondMats = [new THREE.MeshLambertMaterial({ color: 0x2c8a3e, side: THREE.DoubleSide }),
    new THREE.MeshLambertMaterial({ color: 0x3da24d, side: THREE.DoubleSide })];
  const cocoMat = new THREE.MeshLambertMaterial({ color: 0x5a4326 });
  function buildPalm(seed) {
    const g = new THREE.Group();
    const h = 6.5 + (seed % 5) * 0.7, lean = 0.10 + (seed % 3) * 0.05;
    let px = 0;
    for (let i = 0; i < 5; i++) {
      const seg = new THREE.Mesh(
        new THREE.CylinderGeometry(0.22 - i * 0.015, 0.26 - i * 0.015, h / 5, 6), trunkMat);
      px += lean * (i / 4);
      seg.position.set(px, h / 10 + i * h / 5, 0);
      seg.castShadow = true;
      g.add(seg);
    }
    for (let i = 0; i < 8; i++) {
      const frond = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.05, 0.6), frondMats[i % 2]);
      frond.position.set(px, h + 0.15, 0);
      frond.rotation.y = i / 8 * Math.PI * 2 + seed;
      frond.rotation.z = -0.5;                     // droop
      frond.translateX(1.5);                       // reach outward from the trunk
      frond.castShadow = true;
      g.add(frond);
    }
    for (let i = 0; i < 3; i++) {
      const nut = new THREE.Mesh(new THREE.SphereGeometry(0.2, 6, 5), cocoMat);
      nut.position.set(px + Math.cos(i * 2.1) * 0.35, h - 0.15, Math.sin(i * 2.1) * 0.35);
      g.add(nut);
    }
    g.rotation.y = seed * 2.4;
    return g;
  }
  // along the coast road (beach side full length; inland side only where
  // the road still hugs the shore — further south the esses drift east)
  let pi = 0;
  for (let z = 400; z > -140; z -= 46) {
    for (const x of [-283 * S, -330 * S]) {
      if (x > -300 && z < 210) continue;
      const p = buildPalm(pi++);
      p.position.set(x + ((pi * 37) % 11) - 5, 0, z * S + ((pi * 53) % 17) - 8);
      scene.add(p);
    }
  }
  // palm boulevard down the grid straight (clear of the start-line armco)
  for (let z = -40; z < 135; z += 44) {
    for (const x of [-16.5, 16.5]) {
      const p = buildPalm(pi++);
      p.position.set(x, 0, z * S);
      scene.add(p);
    }
  }

  // lighthouse on the headland, inside the hairpin
  {
    const lh = new THREE.Group();
    const white = new THREE.MeshStandardMaterial({ color: 0xf4f4f4, roughness: 0.6 });
    const red = new THREE.MeshStandardMaterial({ color: 0xd81800, roughness: 0.6 });
    const tower = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 3.4, 15, 12), white);
    tower.position.y = 7.5;
    tower.castShadow = true;
    lh.add(tower);
    for (const y of [4, 9]) {
      const band = new THREE.Mesh(new THREE.CylinderGeometry(3.06 - y * 0.052, 3.16 - y * 0.052, 2.2, 12), red);
      band.position.y = y;
      lh.add(band);
    }
    const gallery = new THREE.Mesh(new THREE.CylinderGeometry(3.4, 3.4, 0.5, 12), red);
    gallery.position.y = 15.3;
    lh.add(gallery);
    const lampMat = new THREE.MeshBasicMaterial({ color: new THREE.Color().setRGB(9, 7.5, 5) });
    const lamp = new THREE.Mesh(new THREE.CylinderGeometry(1.7, 1.7, 2.2, 10), lampMat);
    lamp.position.y = 16.6;
    lh.add(lamp);
    const roof = new THREE.Mesh(new THREE.ConeGeometry(2.4, 2.1, 10), red);
    roof.position.y = 18.8;
    lh.add(roof);
    const rockMat = new THREE.MeshLambertMaterial({ color: 0x777d82, flatShading: true });
    for (let i = 0; i < 6; i++) {
      const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(1.6 + (i % 3) * 0.9, 0), rockMat);
      rock.position.set(Math.cos(i * 1.15) * (4.5 + (i % 2) * 2.5), 0.4,
        Math.sin(i * 1.15) * (4.5 + (i % 2) * 2.5));
      rock.castShadow = true;
      lh.add(rock);
    }
    // on the headland point NW of the hairpin: framed dead-ahead through the
    // carousel and the hairpin entry (at the circle center it would sit
    // permanently abeam of the chase camera and never be seen)
    lh.position.set(-352, 0, 448);
    lh.scale.setScalar(1.35);
    scene.add(lh);
  }

  // wooden pier reaching into the surf
  {
    const pier = new THREE.Group();
    const wood = new THREE.MeshStandardMaterial({ color: 0x9a7a50, roughness: 0.9 });
    const deck = new THREE.Mesh(new THREE.BoxGeometry(170, 0.5, 7), wood);
    deck.position.set(-85, 1.8, 0);
    deck.castShadow = true;
    pier.add(deck);
    for (let x = -160; x <= 0; x += 16) {
      for (const z of [-2.6, 2.6]) {
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 2.6, 6), wood);
        post.position.set(x, 0.5, z);
        pier.add(post);
      }
    }
    const hut = new THREE.Mesh(new THREE.BoxGeometry(8, 4.4, 5.6),
      new THREE.MeshStandardMaterial({ color: 0xd8d0c0, roughness: 0.8 }));
    hut.position.set(-158, 4, 0);
    hut.castShadow = true;
    pier.add(hut);
    const hutRoof = new THREE.Mesh(new THREE.ConeGeometry(6.4, 2.6, 4),
      new THREE.MeshStandardMaterial({ color: 0xc44b28, roughness: 0.85 }));
    hutRoof.position.set(-158, 7.5, 0);
    hutRoof.rotation.y = Math.PI / 4;
    pier.add(hutRoof);
    pier.position.set(-390, 0, 60 * S);
    scene.add(pier);
  }

  // beach umbrellas + towels
  const brolly = [0xf83800, 0x0058f8, 0xf8b800, 0x00a800, 0xfc74b4];
  for (let i = 0; i < 12; i++) {
    const u = new THREE.Group();
    const canopy = new THREE.Mesh(new THREE.ConeGeometry(2.1, 1.0, 8),
      new THREE.MeshLambertMaterial({ color: brolly[i % 5], side: THREE.DoubleSide }));
    canopy.position.y = 2.1;
    canopy.castShadow = true;
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 2.2, 5),
      new THREE.MeshLambertMaterial({ color: 0xe8e8e8 }));
    pole.position.y = 1.1;
    u.add(canopy, pole);
    u.rotation.z = 0.12;
    u.position.set(-355 - (i * 41 % 80), 0, ((i * 89) % 640) - 290);
    scene.add(u);
    const towel = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 1.3),
      new THREE.MeshLambertMaterial({ color: brolly[(i + 2) % 5] }));
    towel.rotation.x = -Math.PI / 2;
    towel.rotation.z = i * 0.9;
    towel.position.set(u.position.x + 3, -0.25, u.position.z + 2);
    scene.add(towel);
  }

  // sailboats out on the water
  for (let i = 0; i < 5; i++) {
    const boat = new THREE.Group();
    const hull = new THREE.Mesh(new THREE.BoxGeometry(5.4, 1.1, 1.8),
      new THREE.MeshLambertMaterial({ color: i % 2 ? 0xfcfcfc : 0x0058f8 }));
    hull.position.y = 0.5;
    boat.add(hull);
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 7, 5),
      new THREE.MeshLambertMaterial({ color: 0xdddddd }));
    mast.position.y = 4;
    boat.add(mast);
    const sailGeo = new THREE.BufferGeometry();
    sailGeo.setAttribute('position', new THREE.Float32BufferAttribute(
      [0, 1.2, 0, 0, 7.2, 0, 2.6, 1.2, 0], 3));
    sailGeo.computeVertexNormals();
    const sail = new THREE.Mesh(sailGeo,
      new THREE.MeshLambertMaterial({ color: 0xffffff, side: THREE.DoubleSide }));
    boat.add(sail);
    boat.position.set(-560 - (i * 137) % 420, 0, ((i * 263) % 900) - 430);
    boat.rotation.y = i * 1.7;
    scene.add(boat);
  }
}
if (THEME === 'canyon') {
  const S = TRACK_SCALE;
  // red-rock mesas and buttes on the horizon
  const rockMats = [0xb05a34, 0xc26a3e, 0x9c4e2c].map(
    c => new THREE.MeshLambertMaterial({ color: c, flatShading: true }));
  const capMat = new THREE.MeshLambertMaterial({ color: 0xd8956a, flatShading: true });
  const mesaSpots = [[380, 430], [620, -140], [-780, 560], [-860, -320],
    [230, -840], [-300, 900], [-980, 140], [760, 320]];
  mesaSpots.forEach(([mx, mz], i) => {
    const r = 70 + (i * 37) % 60, h = 34 + (i * 23) % 26;
    const base = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.82, r, h, 9), rockMats[i % 3]);
    base.position.set(mx, h / 2 - 1, mz);
    scene.add(base);
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.62, r * 0.8, 10, 9), capMat);
    cap.position.set(mx, h + 4, mz);
    scene.add(cap);
  });
  // the NARROWS: rock walls flanking the monster straight
  for (let s = 830; s < 1340; s += 24) {
    for (const sideSign of [-1, 1]) {
      const w = 7 + (s * 7 % 5), h = 9 + ((s + sideSign * 40) * 13 % 8);
      const wall = new THREE.Mesh(new THREE.BoxGeometry(w, h, 21), rockMats[(s / 24 | 0) % 3]);
      posAt(s + (sideSign > 0 ? 11 : 0), sideSign * (HALF_W + 8.5 + (s * 11 % 4)), wall.position);
      wall.position.y = h / 2 - 0.5;
      wall.rotation.y = headingAt(s) + (s * 17 % 10) * 0.03;
      wall.castShadow = true;
      scene.add(wall);
    }
  }
  // scattered boulders + a couple of tumbleweeds
  const bMat = new THREE.MeshLambertMaterial({ color: 0xa86a48, flatShading: true });
  for (let i = 0; i < 12; i++) {
    const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(0.9 + (i * 7) % 3 * 0.55, 0), bMat);
    posAt((i * 167.3) % TRACK_LEN, (i % 2 ? 1 : -1) * (HALF_W + 8 + (i * 11) % 15), rock.position);
    rock.position.y = 0.4;
    rock.rotation.set(i, i * 2.1, 0);
    rock.castShadow = true;
    scene.add(rock);
  }
}
if (THEME === 'neon') {
  // skyline of lit towers ringing the circuit
  const winTexes = [];
  for (let t = 0; t < 3; t++) {
    winTexes.push(canvasTexture(64, 128, (g) => {
      g.fillStyle = '#0b0d16'; g.fillRect(0, 0, 64, 128);
      for (let y = 4; y < 124; y += 7) {
        for (let x = 4; x < 60; x += 6) {
          if (Math.random() < 0.42) {
            g.fillStyle = ['#ffd982', '#b8d8ff', '#ffe9c0', '#9fc4ff'][(x + y + t) % 4];
            g.fillRect(x, y, 3, 4);
          }
        }
      }
    }));
    winTexes[t].magFilter = THREE.LinearFilter;
  }
  for (let i = 0; i < 30; i++) {
    const s = i * (TRACK_LEN / 30);
    const side = (i % 2 ? 1 : -1) * (58 + (i * 29) % 75);
    const w = 15 + (i * 7) % 12, d = 15 + (i * 11) % 12, h = 30 + (i * 37) % 58;
    const tower = new THREE.Mesh(new THREE.BoxGeometry(w, h, d),
      new THREE.MeshBasicMaterial({ map: winTexes[i % 3] }));
    posAt(s, side, tower.position);
    // the street circuit doubles back on itself — never drop a tower on
    // (or hard against) another leg of the road
    let clear = true;
    for (let j = 0; j < N_SAMP; j += 12) {
      const dx = PTS[j].x - tower.position.x, dz = PTS[j].z - tower.position.z;
      if (dx * dx + dz * dz < (w / 2 + HALF_W + 6) ** 2) { clear = false; break; }
    }
    if (!clear) continue;
    tower.position.y = h / 2 - 1;
    tower.rotation.y = (i * 13) % 7 * 0.22;
    scene.add(tower);
    if (i % 5 === 0) {   // rooftop beacon
      const bcn = new THREE.Mesh(new THREE.SphereGeometry(0.7, 6, 5),
        new THREE.MeshBasicMaterial({ color: new THREE.Color(6, 0.6, 0.6) }));
      bcn.position.set(tower.position.x, h + 0.4, tower.position.z);
      scene.add(bcn);
    }
  }
}
if (THEME === 'alpine') {
  const S = TRACK_SCALE;
  // close snowy peaks looming over the pass
  const rockMat2 = new THREE.MeshLambertMaterial({ color: 0x7d8894, flatShading: true });
  const snowMat2 = new THREE.MeshLambertMaterial({ color: 0xf6fafc, flatShading: true });
  const peaks = [[520, 620], [-900, 700], [-1050, -250], [420, -700], [-200, 1050], [900, -60]];
  peaks.forEach(([px, pz], i) => {
    const r = 300 + (i * 67) % 180, h = 240 + (i * 91) % 160;
    const cone = new THREE.Mesh(new THREE.ConeGeometry(r, h, 9), rockMat2);
    cone.position.set(px, h / 2 - 6, pz);
    scene.add(cone);
    const cap = new THREE.Mesh(new THREE.ConeGeometry(r * 0.38, h * 0.34, 9), snowMat2);
    cap.position.set(px, h - h * 0.17, pz);
    scene.add(cap);
  });
  // chalets in the valley
  const wallMat = new THREE.MeshLambertMaterial({ color: 0xe8dcc8 });
  const roofMat = new THREE.MeshLambertMaterial({ color: 0x6e4a2c });
  const winMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(3.4, 2.6, 1.2) });
  for (let i = 0; i < 5; i++) {
    const ch = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(9, 4, 6.5), wallMat);
    body.position.y = 2;
    body.castShadow = true;
    ch.add(body);
    const roof = new THREE.Mesh(new THREE.ConeGeometry(6.4, 3.2, 4), roofMat);
    roof.position.y = 5.6;
    roof.rotation.y = Math.PI / 4;
    roof.scale.z = 0.78;
    roof.castShadow = true;
    ch.add(roof);
    const win = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 1.1), winMat);
    win.position.set(2.2, 2.1, 3.28);
    ch.add(win);
    const spots2 = [[240, 26], [640, -24], [1180, 30], [1520, -26], [1900, 24]];
    posAt(spots2[i][0], (spots2[i][1] > 0 ? 1 : -1) * (HALF_W + Math.abs(spots2[i][1])), ch.position);
    ch.rotation.y = headingAt(spots2[i][0]) + (i % 2 ? 0.6 : -0.6);
    scene.add(ch);
  }
  // snowbanks walling the switchback corridor
  const bankMat = new THREE.MeshLambertMaterial({ color: 0xf2f6f8, flatShading: true });
  for (const [s0, s1] of [[462, 596], [664, 800]]) {
    for (let s = s0; s < s1; s += 7) {
      for (const sideSign of [-1, 1]) {
        const bank = new THREE.Mesh(new THREE.BoxGeometry(3.4, 1.0, 6.4), bankMat);
        posAt(s + (sideSign > 0 ? 3 : 0), sideSign * (HALF_W + 2.4), bank.position);
        bank.position.y = 0.28;
        bank.rotation.y = headingAt(s);
        bank.rotation.z = (s * 13 % 7) * 0.02;
        scene.add(bank);
      }
    }
  }
}
if (THEME === 'jungle') {
  const S = TRACK_SCALE;
  // the river running beside the long straight, with a waterfall at its head
  const water = new THREE.Mesh(
    new THREE.PlaneGeometry(36, 640),
    new THREE.MeshStandardMaterial({ color: 0x1f8a96, roughness: 0.2, metalness: 0.5 }));
  water.rotation.x = -Math.PI / 2;
  water.position.set(-492 * S, -0.22, -60 * S);
  scene.add(water);
  for (const [w, off, op] of [[3, 0, 0.5], [2, 7, 0.3]]) {   // bank foam
    const foam = new THREE.Mesh(
      new THREE.PlaneGeometry(w, 640),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: op }));
    foam.rotation.x = -Math.PI / 2;
    foam.position.set(-476 * S - off, -0.16, -60 * S);
    scene.add(foam);
  }
  {  // waterfall cliff at the north head of the river
    const cliff = new THREE.Mesh(new THREE.BoxGeometry(42, 18, 16),
      new THREE.MeshLambertMaterial({ color: 0x4e5e46, flatShading: true }));
    cliff.position.set(-492 * S, 8, 275 * S);
    cliff.castShadow = true;
    scene.add(cliff);
    const fallMat = new THREE.MeshBasicMaterial({
      color: 0xeafcff, transparent: true, opacity: 0.85 });
    for (const fx of [-10, 0, 11]) {
      const fall = new THREE.Mesh(new THREE.PlaneGeometry(8 - Math.abs(fx) * 0.2, 16), fallMat);
      fall.position.set(-492 * S + fx, 8, 275 * S - 8.2);
      scene.add(fall);
    }
    // mist at the plunge pool
    const mistTex = canvasTexture(64, 64, (g) => {
      const grad = g.createRadialGradient(32, 32, 3, 32, 32, 32);
      grad.addColorStop(0, 'rgba(255,255,255,0.8)');
      grad.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grad;
      g.fillRect(0, 0, 64, 64);
      flattenTexRGB(g, 64, 64, 255, 255, 255);
    });
    for (let i = 0; i < 4; i++) {
      const mist = new THREE.Sprite(new THREE.SpriteMaterial({
        map: mistTex, transparent: true, opacity: 0.4, depthWrite: false }));
      mist.position.set(-492 * S + (i - 1.5) * 9, 2.4, 275 * S - 12);
      mist.scale.setScalar(9 + (i % 2) * 4);
      scene.add(mist);
    }
  }
}
if (THEME === 'peg') {
  const S = TRACK_SCALE;
  // Red River along the riverside straight, Assiniboine joining from the
  // west — the two meet at the confluence (The Forks) by the river bend
  const waterMat = new THREE.MeshStandardMaterial({
    color: 0x4a6a52, roughness: 0.24, metalness: 0.5 });   // prairie-river green-brown
  const red = new THREE.Mesh(new THREE.PlaneGeometry(640, 46), waterMat);
  red.rotation.x = -Math.PI / 2;
  red.position.set(-115 * S, -0.22, -402 * S);
  scene.add(red);
  const assiniboine = new THREE.Mesh(new THREE.PlaneGeometry(38, 500), waterMat);
  assiniboine.rotation.x = -Math.PI / 2;
  assiniboine.position.set(-402 * S, -0.22, -140 * S);
  scene.add(assiniboine);
  for (const [dx, dz, w, l, rot] of [[-115 * S, -381 * S, 640, 3, 0], [-383 * S, -140 * S, 3, 500, 0]]) {
    const foam = new THREE.Mesh(new THREE.PlaneGeometry(w, l),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.3 }));
    foam.rotation.x = -Math.PI / 2;
    foam.position.set(dx, -0.16, dz);
    scene.add(foam);
  }

  // Esplanade Riel: side-spar cable-stayed footbridge over the Red River
  {
    const er = new THREE.Group();
    const white = new THREE.MeshStandardMaterial({ color: 0xf2f2f0, roughness: 0.5 });
    const deck = new THREE.Mesh(new THREE.BoxGeometry(4.5, 0.7, 58), white);
    deck.position.y = 6.5;
    deck.castShadow = true;
    er.add(deck);
    for (const dz of [-24, 24]) {                       // approach piers
      const pier = new THREE.Mesh(new THREE.BoxGeometry(3, 6.5, 1.6), white);
      pier.position.set(0, 3.25, dz);
      er.add(pier);
    }
    const pylon = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 1.0, 30, 8), white);
    pylon.position.set(0, 6.5 + 13.5, 2);
    pylon.rotation.x = 0.34;                            // the signature inclined spar
    pylon.castShadow = true;
    er.add(pylon);
    for (let c = 0; c < 6; c++) {                       // cable fan
      const t = c / 5;
      const ax = 0, ay = 6.5 + 26 - t * 5, az = 2 - Math.tan(0.34) * (26 - t * 5);
      const bx = 0, by = 6.9, bz = -22 + t * 42;
      const len = Math.hypot(ay - by, az - bz);
      const cable = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, len, 4), white);
      cable.position.set(0, (ay + by) / 2, (az + bz) / 2);
      cable.rotation.x = Math.atan2(bz - az, ay - by);
      er.add(cable);
    }
    er.position.set(-160 * S, 0, -402 * S);
    scene.add(er);
  }

  // Canadian Museum for Human Rights — per photo reference: a mountain of
  // angular Tyndall-limestone slabs at the back, a swooping banded glass
  // "cloud" wrapping the track-facing side, and the Tower of Hope as an
  // angular glass spike topped by an open steel lattice mast
  {
    const cmhr = new THREE.Group();
    const stone = new THREE.MeshLambertMaterial({ color: 0xd6c9a8, flatShading: true });
    const stoneDk = new THREE.MeshLambertMaterial({ color: 0xc2b490, flatShading: true });
    const glass = new THREE.MeshStandardMaterial({
      color: 0x9fb8c8, roughness: 0.15, metalness: 0.6,
      transparent: true, opacity: 0.85, flatShading: true });
    const steel = new THREE.MeshStandardMaterial({ color: 0x8a9298, roughness: 0.4, metalness: 0.7 });
    // limestone mountain: stacked faceted prisms, tallest at the back
    const slabs = [[16, 10, 18, 5, -4, 0], [21, 9, 26, 6, 4, 0.4],
                   [26, 7, 20, 5, -7, 0.9], [12, 6, 13, 6, 10, 1.6], [30, 5, 12, 5, -13, 2.2]];
    for (let i = 0; i < slabs.length; i++) {
      const [x, r, h, sides, dz2, rot] = slabs[i];
      const slab = new THREE.Mesh(
        new THREE.CylinderGeometry(r * 0.72, r, h, sides), i % 2 ? stone : stoneDk);
      slab.position.set(x - 4, h / 2, 3 + dz2 * 0.35);
      slab.rotation.y = rot;
      slab.castShadow = true;
      cmhr.add(slab);
    }
    // glass cloud: three tilted, staggered shell bands draped beside the stone
    for (let b = 0; b < 3; b++) {
      const shell = new THREE.Mesh(new THREE.SphereGeometry(9.5 - b * 1.6, 12, 8), glass);
      shell.position.set(-6 - b * 3.2, 8 + b * 3.4, -4 - b * 0.8);
      shell.scale.set(1.35, 0.78, 0.7);
      shell.rotation.z = 0.28 + b * 0.12;               // the swoop
      shell.rotation.y = -0.25;
      shell.castShadow = true;
      cmhr.add(shell);
    }
    // Tower of Hope: angular glass spike + open lattice mast above
    const spike = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 2.6, 16, 4), glass);
    spike.position.set(3, 26, -1);
    spike.rotation.y = Math.PI / 4;
    spike.castShadow = true;
    cmhr.add(spike);
    for (const [mx, mz] of [[-0.5, 0], [0.5, 0.3], [0, -0.5]]) {   // lattice legs
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.13, 12, 4), steel);
      leg.position.set(3 + mx, 39, -1 + mz);
      leg.rotation.z = mx * 0.06;
      cmhr.add(leg);
    }
    const mastTip = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.09, 5, 4), steel);
    mastTip.position.set(3, 47, -1);
    cmhr.add(mastTip);
    const tip = new THREE.Mesh(new THREE.SphereGeometry(0.55, 6, 5),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(3.2, 3.2, 3.4) }));
    tip.position.set(3, 49.2, -1);
    cmhr.add(tip);
    cmhr.position.set(-135 * S, 0, -310 * S);           // dead ahead off the river bend
    scene.add(cmhr);
  }

  // Manitoba Legislature — per photo reference: long limestone wings with
  // window rows and end pavilions, a six-column portico under a triangular
  // pediment, a colonnaded drum, and the NEAR-BLACK dome carrying the boy
  {
    const leg = new THREE.Group();
    const stone = new THREE.MeshStandardMaterial({ color: 0xd8ccb2, roughness: 0.8 });
    const stoneDk = new THREE.MeshStandardMaterial({ color: 0xc4b696, roughness: 0.85 });
    const winMat2 = new THREE.MeshLambertMaterial({ color: 0x2c3440 });
    const base = new THREE.Mesh(new THREE.BoxGeometry(46, 9, 13), stone);   // long wings
    base.position.y = 4.5;
    base.castShadow = true;
    leg.add(base);
    const plinth = new THREE.Mesh(new THREE.BoxGeometry(46.6, 2.2, 13.6), stoneDk);
    plinth.position.y = 1.1;                            // rusticated ground band
    leg.add(plinth);
    for (const px of [-20.5, 20.5]) {                   // end pavilions
      const pav = new THREE.Mesh(new THREE.BoxGeometry(6.5, 10, 14), stone);
      pav.position.set(px, 5, 0);
      pav.castShadow = true;
      leg.add(pav);
    }
    for (let w = 0; w < 9; w++) {                       // two window rows per side
      for (const wy of [3.4, 6.6]) {
        for (const wz of [6.6, -6.6]) {
          const win = new THREE.Mesh(new THREE.BoxGeometry(1.3, 2.0, 0.15), winMat2);
          win.position.set(-14 + w * 3.5, wy, wz);
          leg.add(win);
        }
      }
    }
    const cornice = new THREE.Mesh(new THREE.BoxGeometry(46.8, 0.7, 13.8), stoneDk);
    cornice.position.y = 9.3;                           // roofline balustrade band
    leg.add(cornice);
    // portico: projecting porch, 6 columns, triangular pediment
    const porch = new THREE.Mesh(new THREE.BoxGeometry(13, 9, 3), stone);
    porch.position.set(0, 4.5, 7);
    porch.castShadow = true;
    leg.add(porch);
    for (let c = 0; c < 6; c++) {
      const col = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.55, 7.6, 8), stone);
      col.position.set(-5.5 + c * 2.2, 3.8, 8.9);
      leg.add(col);
    }
    const pedGeo = new THREE.CylinderGeometry(7.4, 7.4, 2.6, 3);
    pedGeo.rotateX(Math.PI / 2);                        // prism axis -> depth
    pedGeo.rotateZ(Math.PI);                            // triangle point -> up
    pedGeo.scale(1, 0.42, 1);                           // flatten to pediment pitch
    const pediment = new THREE.Mesh(pedGeo, stoneDk);
    pediment.position.set(0, 10.4, 8.2);
    pediment.castShadow = true;
    leg.add(pediment);
    const steps = new THREE.Mesh(new THREE.BoxGeometry(14, 1.4, 4.5), stoneDk);
    steps.position.set(0, 0.7, 11);
    leg.add(steps);
    // tower: square stage, colonnaded drum, dark ribbed dome, lantern
    const stage = new THREE.Mesh(new THREE.BoxGeometry(8.5, 4.5, 8.5), stone);
    stage.position.y = 11.6;
    stage.castShadow = true;
    leg.add(stage);
    const drum = new THREE.Mesh(new THREE.CylinderGeometry(3.6, 3.9, 4.6, 12), stone);
    drum.position.y = 16.2;
    leg.add(drum);
    for (let c = 0; c < 10; c++) {                      // drum colonnade ring
      const a = c / 10 * Math.PI * 2;
      const col = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 4.4, 6), stone);
      col.position.set(Math.cos(a) * 4.3, 16.2, Math.sin(a) * 4.3);
      leg.add(col);
    }
    const dome = new THREE.Mesh(new THREE.SphereGeometry(4.0, 14, 9, 0, Math.PI * 2, 0, Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: 0x23282e, roughness: 0.45, metalness: 0.5 }));
    dome.position.y = 18.5;
    dome.castShadow = true;
    leg.add(dome);
    const lantern = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.9, 1.6, 8), stone);
    lantern.position.y = 23.0;
    leg.add(lantern);
    // the GOLDEN BOY — gilded, softly glowing so he reads from the track
    const gold = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.9, 2.2, 0.5) });
    const boy = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.3, 2.0, 6), gold);
    boy.position.y = 24.9;
    leg.add(boy);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.34, 6, 5), gold);
    head.position.y = 26.1;
    leg.add(head);
    const torch = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 1.5, 4), gold);
    torch.position.set(0.5, 26.3, 0);
    torch.rotation.z = -0.7;
    leg.add(torch);
    leg.position.set(38, 0, 40 * S);
    leg.rotation.y = -Math.PI / 2;                      // portico faces the track
    scene.add(leg);
  }

  // Forks Market tower + sheds at the confluence, inside the river bend
  {
    const forks = new THREE.Group();
    const glass2 = new THREE.MeshStandardMaterial({
      color: 0xb8d8d0, roughness: 0.2, metalness: 0.5 });
    const tower = new THREE.Mesh(new THREE.BoxGeometry(7, 17, 7), glass2);
    tower.position.y = 8.5;
    tower.castShadow = true;
    forks.add(tower);
    const pyr = new THREE.Mesh(new THREE.ConeGeometry(5.6, 4.2, 4),
      new THREE.MeshStandardMaterial({ color: 0x3f6a52, roughness: 0.6 }));
    pyr.position.y = 19.1;
    pyr.rotation.y = Math.PI / 4;
    forks.add(pyr);
    for (const [sx, sz] of [[-13, 3], [12, -2]]) {      // market sheds
      const shed = new THREE.Mesh(new THREE.BoxGeometry(12, 4.5, 8),
        new THREE.MeshStandardMaterial({ color: 0xa8886a, roughness: 0.85 }));
      shed.position.set(sx, 2.25, sz);
      shed.castShadow = true;
      forks.add(shed);
      const roof = new THREE.Mesh(new THREE.ConeGeometry(8.2, 2.4, 4),
        new THREE.MeshStandardMaterial({ color: 0x6a4a32, roughness: 0.9 }));
      roof.position.set(sx, 5.6, sz);
      roof.rotation.y = Math.PI / 4;
      roof.scale.z = 0.66;
      forks.add(roof);
    }
    forks.position.set(-286 * S, 0, -300 * S);
    scene.add(forks);
  }

  // Portage & Main office towers at the hard corner (kept off every road leg)
  {
    const dayWin = canvasTexture(64, 128, (g) => {
      g.fillStyle = '#8fa3b4'; g.fillRect(0, 0, 64, 128);
      g.fillStyle = '#42566a';
      for (let y = 4; y < 124; y += 7)
        for (let x = 4; x < 60; x += 6) g.fillRect(x, y, 3, 4);
    });
    const spots3 = [[-215, 370], [-268, 372], [-306, 330], [-312, 262], [-200, 300]];
    spots3.forEach(([bx, bz], i) => {
      const w = 13 + (i * 5) % 8, h = 26 + (i * 17) % 22;
      const tw = new THREE.Mesh(new THREE.BoxGeometry(w, h, w),
        new THREE.MeshBasicMaterial({ map: dayWin }));
      tw.position.set(bx * S, h / 2 - 1, bz * S);
      let clear = true;
      for (let j = 0; j < N_SAMP; j += 12) {
        const dx = PTS[j].x - tw.position.x, dz = PTS[j].z - tw.position.z;
        if (dx * dx + dz * dz < (w / 2 + HALF_W + 5) ** 2) { clear = false; break; }
      }
      if (clear) scene.add(tw);
    });
  }

  // grain elevators on the flat horizon
  const elevWood = new THREE.MeshLambertMaterial({ color: 0x9a5f43, flatShading: true });
  for (const [ex, ez] of [[520, 620], [780, -220], [300, -780], [-140, 820]]) {
    const el = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(16, 34, 12), elevWood);
    body.position.y = 17;
    el.add(body);
    const roof = new THREE.Mesh(new THREE.ConeGeometry(11, 7, 4), elevWood);
    roof.position.y = 37.5;
    roof.rotation.y = Math.PI / 4;
    roof.scale.z = 0.75;
    el.add(roof);
    const cupola = new THREE.Mesh(new THREE.BoxGeometry(5, 7, 5), elevWood);
    cupola.position.y = 42;
    el.add(cupola);
    el.position.set(ex, 0, ez);
    scene.add(el);
  }

}
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
  if (THEME === 'fuji') scene.add(fuji);   // the volcano is Fuji-only

  const mtNear = new THREE.Color(ENV.mt ? ENV.mt[0] : 0), mtFar = new THREE.Color(ENV.mt ? ENV.mt[1] : 0);
  for (let i = 0; i < (ENV.mt ? 12 : 0); i++) {
    const a = i / 12 * Math.PI * 2 + 0.26;
    const r = 1350 + (i % 3) * 260;
    const mtMat = new THREE.MeshLambertMaterial({
      color: mtNear.clone().lerp(mtFar, (i % 3) / 2.4), flatShading: true });
    const m = new THREE.Mesh(new THREE.ConeGeometry(260 + (i % 4) * 90, 110 + (i % 3) * 60, 7), mtMat);
    m.position.set(Math.cos(a) * r - 300, (110 + (i % 3) * 60) / 2 - 4, Math.sin(a) * r + 300);
    if (THEME === 'seaside' && m.position.x < 150) continue;   // ocean side stays open
    if (THEME === 'jungle' && m.position.x < -300) continue;     // river side stays open
    scene.add(m);
  }
  // gradient sky dome + sun (stars + moon on night tracks)
  const skyTex = canvasTexture(ENV.night ? 512 : 16, 256, (g, w) => {
    const grad = g.createLinearGradient(0, 0, 0, 256);
    grad.addColorStop(0, ENV.sky[0]);
    grad.addColorStop(0.5, ENV.sky[1]);
    grad.addColorStop(0.82, ENV.sky[2]);
    grad.addColorStop(1, ENV.sky[3]);
    g.fillStyle = grad;
    g.fillRect(0, 0, w, 256);
    if (ENV.night) {
      for (let i = 0; i < 340; i++) {
        const y = Math.random() * 190;
        g.fillStyle = 'rgba(255,255,255,' + (0.35 + Math.random() * 0.65).toFixed(2) + ')';
        g.fillRect(Math.floor(Math.random() * w), Math.floor(y), Math.random() < 0.15 ? 2 : 1, 1);
      }
    }
  });
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(3300, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2),
    new THREE.MeshBasicMaterial({ map: skyTex, side: THREE.BackSide, fog: false }));
  scene.add(dome);
  const sunDisc = new THREE.Mesh(
    new THREE.CircleGeometry(ENV.night ? 90 : 120, 24),
    new THREE.MeshBasicMaterial({ color: ENV.night
      ? new THREE.Color(3.2, 3.4, 3.8) : new THREE.Color(5, 4.8, 3.9), fog: false }));
  sunDisc.position.copy(SUN_DIR).multiplyScalar(2700);
  sunDisc.lookAt(0, 0, 0);
  scene.add(sunDisc);
  const glowTex = canvasTexture(128, 128, (g) => {
    const grad = g.createRadialGradient(64, 64, 4, 64, 64, 64);
    grad.addColorStop(0, 'rgba(255,248,220,0.9)');
    grad.addColorStop(0.4, 'rgba(255,244,200,0.35)');
    grad.addColorStop(1, 'rgba(255,244,200,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 128);
    flattenTexRGB(g, 128, 128, 255, 246, 210);
  });
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glowTex, transparent: true, depthWrite: false, fog: false,
    opacity: ENV.night ? 0.5 : 1 }));
  glow.position.copy(SUN_DIR).multiplyScalar(2650);
  glow.scale.setScalar(ENV.night ? 480 : 900);
  scene.add(glow);
  // soft cloud sprites (always face the camera)
  const cloudTex = canvasTexture(128, 64, (g) => {
    for (const [cx, cy, r] of [[40, 36, 24], [68, 28, 28], [96, 38, 22]]) {
      const grad = g.createRadialGradient(cx, cy, 2, cx, cy, r);
      grad.addColorStop(0, 'rgba(255,255,255,1)');
      grad.addColorStop(0.7, 'rgba(255,255,255,0.9)');
      grad.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grad;
      g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.fill();
    }
    flattenTexRGB(g, 128, 64, 255, 255, 255);
  });
  for (let i = 0; i < (ENV.night ? 0 : 12); i++) {
    const spr = new THREE.Sprite(new THREE.SpriteMaterial({
      map: cloudTex, transparent: true, depthWrite: false, fog: false }));
    const a = i / 12 * Math.PI * 2 + 0.7;
    const r = 1100 + (i % 4) * 380;
    spr.position.set(Math.cos(a) * r - 200, 340 + (i % 5) * 55, Math.sin(a) * r + 250);
    spr.scale.set(300 + (i % 3) * 90, 120 + (i % 3) * 30, 1);
    scene.add(spr);
  }
}

/* Canvas 2D stores pixels premultiplied by alpha; the un-premultiply that
   happens on texture upload amplifies per-channel rounding in low-alpha
   pixels into random COLORED speckles (very visible on iOS GPUs). For any
   soft-alpha texture with a constant tint, flatten RGB after drawing so
   rounding noise stays monochrome and invisible. */
function flattenTexRGB(g, w, h, r, gr, b) {
  const d = g.getImageData(0, 0, w, h);
  for (let i = 0; i < d.data.length; i += 4) {
    d.data[i] = r; d.data[i + 1] = gr; d.data[i + 2] = b;
  }
  g.putImageData(d, 0, 0);
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
    const sc = text.length * 6 * 3 - 3 <= 156 ? 3 : 2;   // auto-fit long names
    const tw = text.length * 6 * sc - sc;
    pixelText(g, text, Math.floor((176 - tw) / 2), 44 - sc * 7, fg, sc);
  });
}
function neonTex(text, color) {
  return canvasTexture(176, 88, (g) => {
    g.fillStyle = '#07070d'; g.fillRect(0, 0, 176, 88);
    g.strokeStyle = color; g.lineWidth = 3;
    g.strokeRect(6, 6, 164, 76);
    const sc = text.length * 6 * 3 - 3 <= 148 ? 3 : 2;
    const tw = text.length * 6 * sc - sc;
    pixelText(g, text, Math.floor((176 - tw) / 2), 44 - sc * 7, color, sc);
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
  panel.castShadow = true;
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
const finishFlags = [];   // start-line flag groups, waggled on the final lap
const curveZones = [];    // {s, dir} per corner, filled by the scenery scan
const startLights = [];   // gantry light materials, synced with the countdown
let puddleMat = null;     // shared puddle material (shimmers)
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
  curveZones.push(...merged);
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
  // billboards on straights — real sponsor / venue art
  const boardTexCache = {};
  const loader = new THREE.TextureLoader();
  const boardTex = (name) => {
    if (!boardTexCache[name]) {
      boardTexCache[name] = loader.load('img/' + name + '.png');
      boardTexCache[name].colorSpace = THREE.SRGBColorSpace;
    }
    return boardTexCache[name];
  };
  const boards = TRACKS[TRACK_ID].boards;
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
    const b = boards[i];
    const tex = b.img ? boardTex(b.img)
      : b.neon ? neonTex(b.neon, b.color)
      : billboardTex(b.text, b.bg, b.fg);
    const m = makeSignMesh(tex, 8, 4, 1.6);
    if (b.neon) {   // HDR-boost the panel so the tubes bloom at night
      const panel = m.children[0];
      panel.material.color.setRGB(3.4, 3.4, 3.4);
    }
    posAt(s, side, m.position);
    m.rotation.y = headingAt(s) + Math.PI;
    scene.add(m);
    hazards.push({ s, x: side, kind: 'sign' });
  });
  // green highway-style KM milestone markers around the Winnipeg lap
  if (THEME === 'peg') {
    for (const [ms, label] of [[500, 'KM 1'], [1000, 'KM 2'], [1500, 'KM 3']]) {
      const m = makeSignMesh(billboardTex(label, '#186428', '#fcfcfc'), 2.2, 1.3, 0.8);
      posAt(ms, HALF_W + 2.6, m.position);
      m.rotation.y = headingAt(ms) + Math.PI;
      scene.add(m);
      hazards.push({ s: ms, x: HALF_W + 2.6, kind: 'sign' });
    }
  }
  // puddles on straights
  // metalness < 1 keeps a blue tint at grazing angles — a perfect mirror
  // reflects the pale horizon from afar and camouflages into the road.
  // polygonOffset beats the road's -2 (car shadow at -4 still wins).
  puddleMat = new THREE.MeshStandardMaterial({
    color: ENV.pud[0], metalness: 0.75, roughness: 0.12,
    polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
  const pudMat = puddleMat;
  const pudSpots = [[spots[1] + 45 || 150, 2.2], [spots[3] + 50 || 600, -2.0], [spots[6] + 40 || 1500, 1.4]];
  for (const [s, x] of pudSpots) {
    const p = new THREE.Mesh(new THREE.CircleGeometry(2.0, 16), pudMat);
    p.rotation.x = -Math.PI / 2;
    // elongated ALONG the road (~10m streak): a flat decal only a couple of
    // meters long is a 1-2px sliver from the chase camera at 60m+ and seems
    // to pop into existence as you reach it
    p.scale.y = 2.6;
    posAt(wrapS(s), x, p.position);
    p.position.y = 0.04;
    p.rotation.z = headingAt(wrapS(s));
    scene.add(p);
    hazards.push({ s: wrapS(s), x, kind: 'puddle' });
  }
  // start gantry
  const gant = new THREE.Group();
  // unlit bright red: Lambert shading made the posts read as black
  // slabs when sweeping past the camera at the start line
  const postMat = new THREE.MeshBasicMaterial({ color: 0xd81800 });
  for (const px of [-(HALF_W + 1.6), HALF_W + 1.6]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.5, 8, 0.5), postMat);
    post.position.set(px, 4, 0);
    gant.add(post);
  }
  const bannerTexMap = canvasTexture(352, 44, (g) => {
    for (let y = 0; y < 3; y++)
      for (let x = 0; x < 44; x++) {
        g.fillStyle = (x + y) % 2 ? '#fcfcfc' : '#000';
        g.fillRect(x * 8, y * 5, 8, 5);
      }
    g.fillStyle = '#000'; g.fillRect(88, 15, 176, 16);
    pixelText(g, 'START', 92, 16, '#fcfcfc', 2);
  });
  // two front-facing planes so START reads correctly from both directions
  for (const flip of [0, Math.PI]) {
    const banner = new THREE.Mesh(
      new THREE.PlaneGeometry(2 * HALF_W + 4.4, 1.8),
      new THREE.MeshBasicMaterial({ map: bannerTexMap }));
    banner.position.y = 7.4;
    banner.rotation.y = flip;
    gant.add(banner);
  }
  // countdown lights sit on TOP of the banner — hanging them below put
  // them at lens height, where they loomed as huge blobs during passage
  for (let i = 0; i < 3; i++) {
    const lm = new THREE.MeshBasicMaterial({ color: 0x3a0000 });
    const box = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.9, 0.5), lm);
    box.position.set((i - 1) * 2.2, 8.8, 0);
    gant.add(box);
    startLights.push(lm);
  }
  posAt(10, 0, gant.position);
  gant.rotation.y = headingAt(10);
  gant.traverse(o => { if (o.isMesh) o.castShadow = true; });
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
    finishFlags.push(fl);
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

  // grandstands along the start straight
  const standTex = canvasTexture(256, 96, (g) => {
    g.fillStyle = '#c8c8c8'; g.fillRect(0, 0, 256, 96);
    const crowd = ['#f83800', '#f8b800', '#fcfcfc', '#0058f8', '#00b800', '#f878b8'];
    for (let i = 0; i < 900; i++) {
      g.fillStyle = crowd[i % 6];
      g.fillRect((i * 37) % 253, 10 + (i * 53) % 58, 3, 3);
    }
    g.fillStyle = '#d81800'; g.fillRect(0, 0, 256, 9);
    g.fillStyle = '#fcfcfc';
    for (let x = 0; x < 256; x += 32) g.fillRect(x, 0, 16, 9);
    g.fillStyle = '#686868'; g.fillRect(0, 74, 256, 22);
  });
  const standGray = new THREE.MeshLambertMaterial({ color: 0x9a9a9a });
  const standRed = new THREE.MeshLambertMaterial({ color: 0xd81800 });
  for (const [s0, side] of [[55, -1], [135, -1], [95, 1], [1950, 1]]) {
    // proper 3D bleachers: tilted crowd face, walls, roof on posts
    const stand = new THREE.Group();
    const crowd = new THREE.Mesh(
      new THREE.PlaneGeometry(64, 10),
      new THREE.MeshBasicMaterial({ map: standTex }));
    crowd.rotation.x = -0.55;                 // seats lean back away from the road
    crowd.position.y = 4.4;
    stand.add(crowd);
    const back = new THREE.Mesh(new THREE.BoxGeometry(64, 8.7, 0.4), standGray);
    back.position.set(0, 4.3, -2.9);
    stand.add(back);
    for (const sx of [-32.1, 32.1]) {
      const wall = new THREE.Mesh(new THREE.BoxGeometry(0.4, 8.7, 5.8), standGray);
      wall.position.set(sx, 4.3, -0.2);
      stand.add(wall);
    }
    const roof = new THREE.Mesh(new THREE.BoxGeometry(66, 0.5, 7.4), standGray);
    roof.position.set(0, 9.2, -0.3);
    stand.add(roof);
    const fascia = new THREE.Mesh(new THREE.BoxGeometry(66, 0.7, 0.5), standRed);
    fascia.position.set(0, 9.2, 3.3);
    stand.add(fascia);
    const bannerTexS = canvasTexture(512, 32, (g) => {
      g.fillStyle = '#d81800'; g.fillRect(0, 0, 512, 32);
      const txt = TRACKS[TRACK_ID].name;
      const tw = txt.length * 6 * 3 - 3;
      pixelText(g, txt, Math.floor((512 - tw) / 2), 6, '#fcfcfc', 3);
    });
    const roofBanner = new THREE.Mesh(
      new THREE.PlaneGeometry(40, 1.7),
      new THREE.MeshBasicMaterial({ map: bannerTexS }));
    roofBanner.position.set(0, 10.3, 3.35);
    stand.add(roofBanner);
    for (const px of [-30, 30]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.4, 9, 0.4), standGray);
      post.position.set(px, 4.5, 3.1);
      stand.add(post);
    }
    posAt(s0, side * (HALF_W + 19), stand.position);
    stand.rotation.y = headingAt(s0) + side * Math.PI / 2;
    stand.traverse(o => { if (o.isMesh) o.castShadow = true; });
    scene.add(stand);
  }
  // trackside vegetation / street furniture, themed per locale
  const leafMat = new THREE.MeshLambertMaterial({ color: 0x00841c, flatShading: true });
  const trunkMat = new THREE.MeshLambertMaterial({ color: 0x7c5400 });
  if (THEME === 'canyon') {
    // saguaro cacti
    const cacMat = new THREE.MeshLambertMaterial({ color: 0x4f8d3a, flatShading: true });
    for (let i = 0; i < 26; i++) {
      const s = 200 + (i * 71.7) % (TRACK_LEN - 320);
      const side = (i % 2 ? 1 : -1) * (HALF_W + 11 + (i * 7) % 12);
      const cac = new THREE.Group();
      const h = 3.6 + (i * 13) % 3;
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.5, h, 7), cacMat);
      trunk.position.y = h / 2;
      trunk.castShadow = true;
      cac.add(trunk);
      for (const sx of [-1, 1]) {
        if ((i + (sx + 1) / 2) % 3 === 0) continue;      // some one-armed ones
        const elbow = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.26, 1.0, 6), cacMat);
        elbow.rotation.z = Math.PI / 2;
        elbow.position.set(sx * 0.6, h * 0.45, 0);
        cac.add(elbow);
        const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.28, 1.7, 6), cacMat);
        arm.position.set(sx * 1.0, h * 0.45 + 0.8, 0);
        arm.castShadow = true;
        cac.add(arm);
      }
      cac.rotation.y = i * 1.3;
      posAt(s, side, cac.position);
      scene.add(cac);
    }
  } else if (THEME === 'neon') {
    // streetlights with blooming sodium heads
    const poleMat3 = new THREE.MeshLambertMaterial({ color: 0x3a3f48 });
    const headMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(5.5, 5.0, 3.4) });
    for (let i = 0; i < 36; i++) {
      const s = 60 + i * ((TRACK_LEN - 120) / 36);
      const side = (i % 2 ? 1 : -1) * (HALF_W + 3.0);
      const lamp = new THREE.Group();
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.17, 7, 6), poleMat3);
      pole.position.y = 3.5;
      pole.castShadow = true;
      lamp.add(pole);
      const arm = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.12, 0.14), poleMat3);
      arm.position.set(-Math.sign(side) * 0.8, 6.9, 0);
      lamp.add(arm);
      const head = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.18, 0.36), headMat);
      head.position.set(-Math.sign(side) * 1.5, 6.82, 0);
      lamp.add(head);
      posAt(s, side, lamp.position);
      lamp.rotation.y = headingAt(s);
      scene.add(lamp);
    }
  } else if (THEME === 'jungle') {
    // layered rainforest canopy
    const greens = [0x14601c, 0x1d7a26, 0x0f5216, 0x268a30].map(
      c => new THREE.MeshLambertMaterial({ color: c, flatShading: true }));
    for (let i = 0; i < 36; i++) {
      const s = 160 + (i * 53.3) % (TRACK_LEN - 260);
      const side = (i % 2 ? 1 : -1) * (HALF_W + 9 + (i * 7) % 14);
      const tree = new THREE.Group();
      const h = 7 + (i * 13) % 5;
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.55, h, 6), trunkMat);
      trunk.position.y = h / 2;
      trunk.castShadow = true;
      tree.add(trunk);
      for (let b = 0; b < 3; b++) {
        const blob = new THREE.Mesh(new THREE.SphereGeometry(2.4 + (i + b) % 3 * 0.8, 8, 6),
          greens[(i + b) % 4]);
        blob.position.set(Math.cos(b * 2.2 + i) * 1.6, h - 0.6 + b * 1.3,
          Math.sin(b * 2.2 + i) * 1.6);
        blob.scale.y = 0.72;
        blob.castShadow = true;
        tree.add(blob);
      }
      posAt(s, side, tree.position);
      scene.add(tree);
    }
  } else if (THEME === 'peg') {
    // prairie elms: broad round crowns over the boulevard
    const elmGreens = [0x2f7a33, 0x3c8a3c, 0x357f2e].map(
      c => new THREE.MeshLambertMaterial({ color: c, flatShading: true }));
    for (let i = 0; i < 30; i++) {
      const s = 180 + (i * 64.9) % (TRACK_LEN - 300);
      const side = (i % 2 ? 1 : -1) * (HALF_W + 10 + (i * 7) % 12);
      const tree = new THREE.Group();
      const h = 5.5 + (i * 13) % 3;
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.45, h * 0.6, 6), trunkMat);
      trunk.position.y = h * 0.3;
      trunk.castShadow = true;
      tree.add(trunk);
      for (let b = 0; b < 2; b++) {
        const crown = new THREE.Mesh(new THREE.SphereGeometry(2.6 - b * 0.7, 8, 6),
          elmGreens[(i + b) % 3]);
        crown.position.set(Math.cos(i + b * 2.4) * 0.9, h * 0.62 + b * 1.5,
          Math.sin(i + b * 2.4) * 0.9);
        crown.scale.y = 0.85;
        crown.castShadow = true;
        tree.add(crown);
      }
      posAt(s, side, tree.position);
      scene.add(tree);
    }
  } else {
    // pines (fuji / seaside / alpine — denser in the mountains)
    const nTrees = THEME === 'alpine' ? 38 : 26;
    for (let i = 0; i < nTrees; i++) {
      const s = 200 + (i * 71.7) % (TRACK_LEN - 320);
      const side = (i % 2 ? 1 : -1) * (HALF_W + 12 + (i * 7) % 10);
      const tree = new THREE.Group();
      const h = 5 + (i * 13) % 4;
      const cone = new THREE.Mesh(new THREE.ConeGeometry(2.4, h, 7), leafMat);
      cone.position.y = h / 2 + 1.2;
      const blob = new THREE.Mesh(new THREE.SphereGeometry(1.7, 8, 6), leafMat);
      blob.position.set(0.4, h * 0.45, 0.3);
      const trunk = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.6, 0.5), trunkMat);
      trunk.position.y = 0.8;
      cone.castShadow = blob.castShadow = trunk.castShadow = true;
      tree.add(cone, blob, trunk);
      if (THEME === 'alpine') {                       // snow-dusted crown
        const cap = new THREE.Mesh(new THREE.ConeGeometry(1.5, 1.6, 7),
          new THREE.MeshLambertMaterial({ color: 0xf2f6f8, flatShading: true }));
        cap.position.y = h + 1.0;
        tree.add(cap);
      }
      posAt(s, side, tree.position);
      scene.add(tree);
    }
  }

  // armco barriers: grid straight both sides + the hairpin outside
  const railMat = new THREE.MeshStandardMaterial({ color: 0xe8e8e8, roughness: 0.45, metalness: 0.4 });
  const postMat2 = new THREE.MeshLambertMaterial({ color: 0x8a8a8a });
  function railRun(s0, s1, off) {
    for (let s = s0; s < s1; s += 8) {
      const seg = new THREE.Group();
      const rail = new THREE.Mesh(new THREE.BoxGeometry(8.3, 0.35, 0.12), railMat);
      rail.position.y = 0.62;
      rail.castShadow = true;
      seg.add(rail);
      for (const px of [-3, 3]) {
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.62, 0.12), postMat2);
        post.position.set(px, 0.31, 0);
        seg.add(post);
      }
      posAt(wrapS(s + 4), off, seg.position);
      seg.rotation.y = headingAt(wrapS(s + 4));
      scene.add(seg);
    }
  }
  railRun(TRACK_LEN - 48, TRACK_LEN, HALF_W + 9.4);
  railRun(TRACK_LEN - 48, TRACK_LEN, -(HALF_W + 9.4));
  railRun(0, 34, HALF_W + 9.4);
  railRun(0, 34, -(HALF_W + 9.4));
  // hairpin: rails around the outside of the tightest corner
  let hairS = 0, hairK = 0;
  for (let s = 0; s < TRACK_LEN; s += 2)
    if (Math.abs(kappaAt(s)) > hairK) { hairK = Math.abs(kappaAt(s)); hairS = s; }
  const hairOut = kappaAt(hairS) > 0 ? -1 : 1;   // outside of the turn
  for (let s = hairS - 60; s < hairS + 70; s += 8) {
    const seg = new THREE.Group();
    const rail = new THREE.Mesh(new THREE.BoxGeometry(7.6, 0.35, 0.12), railMat);
    rail.position.y = 0.62;
    rail.castShadow = true;
    seg.add(rail);
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.62, 0.12), postMat2);
    post.position.set(0, 0.31, 0);
    seg.add(post);
    posAt(wrapS(s + 4), hairOut * (HALF_W + 4.6), seg.position);
    seg.rotation.y = headingAt(wrapS(s + 4));
    scene.add(seg);
  }
  // tire stacks at the outside of every corner
  const tireMat2 = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.92 });
  const tireTop = new THREE.MeshStandardMaterial({ color: 0xe8e8e8, roughness: 0.7 });
  for (const z of curveZones) {
    const out = z.dir > 0 ? -1 : 1;
    for (let k = 0; k < 3; k++) {
      const stack = new THREE.Group();
      for (let l = 0; l < 3; l++) {
        const ring = new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.26, 8, 14),
          l === 2 && k === 1 ? tireTop : tireMat2);
        ring.rotation.x = Math.PI / 2;
        ring.position.y = 0.26 + l * 0.52;
        ring.castShadow = true;
        stack.add(ring);
      }
      const ss = wrapS(z.s + 18 + k * 8);
      posAt(ss, out * (HALF_W + 3.4 + (k % 2) * 0.9), stack.position);
      scene.add(stack);
      if (k === 1) hazards.push({ s: ss, x: out * (HALF_W + 3.8), kind: 'sign' });
    }
  }
  // brake marker boards on the hairpin approach
  for (const [dist, label] of [[140, '150'], [90, '100'], [40, '50']]) {
    const tex = canvasTexture(64, 48, (g) => {
      g.fillStyle = '#fcfcfc'; g.fillRect(0, 0, 64, 48);
      g.fillStyle = '#d81800'; g.fillRect(0, 0, 64, 10);
      const tw = label.length * 6 * 2 - 2;
      pixelText(g, label, Math.floor((64 - tw) / 2), 18, '#181818', 2);
    });
    const m = makeSignMesh(tex, 2.4, 1.8, 0.7);
    const ms = wrapS(hairS - 55 - dist);
    posAt(ms, hairOut * (HALF_W + 2.6), m.position);
    m.rotation.y = headingAt(ms) + Math.PI;
    scene.add(m);
    hazards.push({ s: ms, x: hairOut * (HALF_W + 2.6), kind: 'sign' });
  }
}

/* ---------------- cars ---------------- */
function buildF1(body, accent) {
  const grp = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({ color: body, roughness: 0.32, metalness: 0.2 });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x181818, roughness: 0.85, metalness: 0 });
  const accMat = new THREE.MeshStandardMaterial({ color: accent, roughness: 0.32, metalness: 0.2 });
  const whiteMat = new THREE.MeshStandardMaterial({ color: 0xfcfcfc, roughness: 0.5, metalness: 0 });
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
  const nose = add(new THREE.ConeGeometry(0.36, 1.7, 12), bodyMat, 0, 0.42, 2.35);
  nose.rotation.x = Math.PI / 2;                                            // cone nose
  add(new THREE.BoxGeometry(2.1, 0.1, 0.55), bodyMat, 0, 0.28, 2.75);      // front wing
  add(new THREE.BoxGeometry(0.24, 0.16, 0.55), darkMat, -1.05, 0.28, 2.75);
  add(new THREE.BoxGeometry(0.24, 0.16, 0.55), darkMat, 1.05, 0.28, 2.75);
  add(new THREE.BoxGeometry(1.25, 0.6, 1.1), accMat, 0, 0.72, -0.95);      // blue engine block
  add(new THREE.BoxGeometry(0.55, 0.32, 0.06), whiteMat, 0, 0.72, -1.52);  // rear detail plate
  add(new THREE.SphereGeometry(0.28, 14, 10), whiteMat, 0, 1.06, 0.35);    // helmet
  const visor = add(new THREE.SphereGeometry(0.29, 14, 6), accMat, 0, 1.1, 0.35);
  visor.scale.y = 0.4;                                                      // helmet stripe
  add(new THREE.BoxGeometry(2.35, 0.13, 0.75), bodyMat, 0, 1.28, -1.65);   // red rear wing
  add(new THREE.BoxGeometry(0.14, 0.55, 0.75), darkMat, -1.12, 1.0, -1.65); // endplates
  add(new THREE.BoxGeometry(0.14, 0.55, 0.75), darkMat, 1.12, 1.0, -1.65);
  add(new THREE.BoxGeometry(0.16, 0.42, 0.16), darkMat, 0, 0.95, -1.65);   // wing pylon
  // suspension arms, cockpit detail, exhausts, brake light
  for (const [wx, wz] of [[-1.02, 1.65], [1.02, 1.65], [-1.18, -1.25], [1.18, -1.25]]) {
    for (const dz of [-0.2, 0.2]) {
      const arm = new THREE.Mesh(
        new THREE.CylinderGeometry(0.045, 0.045, Math.abs(wx) - 0.45, 6), darkMat);
      arm.rotation.z = Math.PI / 2;
      arm.position.set(wx / 2, wz > 0 ? 0.38 : 0.5, wz + dz);
      grp.add(arm);
    }
  }
  const sw = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.035, 6, 12), darkMat);
  sw.position.set(0, 0.9, 0.8);
  sw.rotation.x = -1.05;
  grp.add(sw);                                                              // steering wheel
  add(new THREE.BoxGeometry(0.6, 0.28, 0.42), darkMat, 0, 0.8, 0.1);        // driver shoulders
  for (const ex of [-0.3, 0.3]) {
    const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.095, 0.5, 8), darkMat);
    pipe.rotation.x = Math.PI / 2;
    pipe.position.set(ex, 0.52, -1.9);
    grp.add(pipe);
  }
  const brakeMat = new THREE.MeshBasicMaterial({ color: 0x4a0400 });
  const brake = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.15, 0.1), brakeMat);
  brake.position.set(0, 1.28, -2.05);
  grp.add(brake);
  grp.userData.brakeMat = brakeMat;

  // wheels: [x, z, radius, width] — real cylinders now; outer group
  // steers (yaw), inner group spins around the axle
  grp.userData.wheels = [];
  const rimMat = new THREE.MeshStandardMaterial({ color: 0xd8d8d8, roughness: 0.4, metalness: 0.5 });
  for (const [wx, wz, r, ww] of [[-1.02, 1.65, 0.4, 0.45], [1.02, 1.65, 0.4, 0.45],
                                 [-1.18, -1.25, 0.56, 0.7], [1.18, -1.25, 0.56, 0.7]]) {
    const yaw = new THREE.Group();
    yaw.position.set(wx, r, wz);
    const spin = new THREE.Group();
    const tire = new THREE.Mesh(new THREE.CylinderGeometry(r, r, ww, 16), darkMat);
    tire.rotation.z = Math.PI / 2;                 // axle along x
    const rim = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.55, r * 0.55, ww + 0.06, 12), rimMat);
    rim.rotation.z = Math.PI / 2;
    const spoke = new THREE.Mesh(new THREE.BoxGeometry(ww + 0.1, r * 1.5, 0.09), darkMat);
    spin.add(tire, rim, spoke);
    yaw.add(spin);
    grp.add(yaw);
    grp.userData.wheels.push({ m: spin, yaw, r, front: wz > 0 });
  }
  // contact shadow — polygonOffset must beat the road's -2 or it z-fights
  const shadow = new THREE.Mesh(
    new THREE.CircleGeometry(1, 14),
    new THREE.MeshBasicMaterial({
      color: 0x000000, transparent: true, opacity: 0.16, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4
    }));
  shadow.rotation.x = -Math.PI / 2;
  shadow.scale.set(1.9, 3.0, 1);
  shadow.position.y = 0.05;
  grp.traverse(o => { if (o.isMesh) o.castShadow = true; });
  grp.add(shadow);
  return grp;
}

/* ---- skid marks + tire smoke (pooled) ---- */
const SKID_N = 120, SMOKE_N = 40;
const skids = [], smokes = [];
let skidIdx = 0, smokeIdx = 0;
const skidTex = canvasTexture(32, 64, (g) => {
  const grad = g.createLinearGradient(0, 0, 32, 0);
  grad.addColorStop(0, 'rgba(16,16,16,0)');
  grad.addColorStop(0.3, 'rgba(16,16,16,0.9)');
  grad.addColorStop(0.7, 'rgba(16,16,16,0.9)');
  grad.addColorStop(1, 'rgba(16,16,16,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 32, 64);
  flattenTexRGB(g, 32, 64, 16, 16, 16);
});
const puffTex = canvasTexture(64, 64, (g) => {
  const grad = g.createRadialGradient(32, 32, 3, 32, 32, 32);
  grad.addColorStop(0, 'rgba(220,220,220,0.85)');
  grad.addColorStop(0.6, 'rgba(200,200,200,0.4)');
  grad.addColorStop(1, 'rgba(200,200,200,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  flattenTexRGB(g, 64, 64, 210, 210, 210);
});
for (let i = 0; i < SKID_N; i++) {
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(0.5, 2.0),
    new THREE.MeshBasicMaterial({ map: skidTex, transparent: true, opacity: 0, depthWrite: false }));
  m.rotation.order = 'YXZ';
  m.visible = false;
  scene.add(m);
  skids.push({ m, life: 0 });
}
for (let i = 0; i < SMOKE_N; i++) {
  const m = new THREE.Sprite(new THREE.SpriteMaterial({
    map: puffTex, transparent: true, opacity: 0, depthWrite: false }));
  m.visible = false;
  scene.add(m);
  smokes.push({ m, life: 0, vx: 0, vy: 0, vz: 0 });
}
// permanent rubber arcs baked through every corner
for (const z of curveZones) {
  for (let i = 0; i < 9; i++) {
    const s = wrapS(z.s + 6 + i * 5);
    const drift = (i / 9) * 1.8 - 0.4;         // line drifts outward
    const out = z.dir > 0 ? 1 : -1;            // toward the inside first
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(0.5, 3.6),
      new THREE.MeshBasicMaterial({ map: skidTex, transparent: true, opacity: 0.22, depthWrite: false }));
    m.rotation.order = 'YXZ';
    posAt(s, out * (1.2 - drift) + ((i * 7) % 3 - 1) * 0.5, m.position);
    m.position.y = 0.035;
    m.rotation.y = headingAt(s) + ((i % 3) - 1) * 0.06;
    m.rotation.x = -Math.PI / 2;
    scene.add(m);
  }
}

const _fx = new THREE.Vector3();
function laySkid(xOff) {
  const s = skids[skidIdx++ % SKID_N];
  posAt(G.pos - 1.4, xOff, s.m.position);
  s.m.position.y = 0.03;
  s.m.rotation.y = headingAt(G.pos);
  s.m.rotation.x = -Math.PI / 2;
  s.life = 5;
  s.m.visible = true;
}
function puffSmoke(xOff) {
  const p = smokes[smokeIdx++ % SMOKE_N];
  posAt(G.pos - 1.5, xOff, p.m.position);
  p.m.position.y = 0.4;
  p.vx = Math.sin(frame * 1.3) * 1.5;
  p.vy = 1.6;
  p.vz = 0;
  p.life = 0.7;
  p.m.scale.setScalar(1);
  p.m.visible = true;
}
function updateEffects(dt) {
  for (const s of skids) {
    if (!s.m.visible) continue;
    s.life -= dt;
    if (s.life <= 0) { s.m.visible = false; continue; }
    s.m.material.opacity = Math.min(0.5, s.life * 0.25);
  }
  for (const p of smokes) {
    if (!p.m.visible) continue;
    p.life -= dt;
    if (p.life <= 0) { p.m.visible = false; continue; }
    p.m.position.x += p.vx * dt;
    p.m.position.y += p.vy * dt;
    p.m.scale.multiplyScalar(1 + 3 * dt);
    p.m.material.opacity = p.life * 0.75;
  }
}
const CAR_COLORS = [
  [0xf8b800, 0xd81800], [0xfcfcfc, 0xd81800],
  [0x00a8f8, 0xfcfcfc], [0x00b800, 0xf8b800]
];
const playerMesh = buildF1(0xd81800, 0x0058f8);
scene.add(playerMesh);
playerMesh.visible = false;
// exhaust flames flash briefly on gear shifts
const flames = [-0.3, 0.3].map(x => {
  const f = new THREE.Sprite(new THREE.SpriteMaterial({
    map: puffTex, color: 0xff8a20, transparent: true, opacity: 0.95, depthWrite: false }));
  f.scale.setScalar(0.55);
  f.position.set(x, 0.52, -2.35);
  f.visible = false;
  playerMesh.add(f);
  return f;
});

/* explosion: fireball + white flash + smoke column + bouncing debris */
const boom = { group: new THREE.Group(), parts: [], t: 0 };
scene.add(boom.group);
const boomFlash = new THREE.Sprite(new THREE.SpriteMaterial({
  color: 0xffffff, transparent: true, opacity: 0, depthWrite: false }));
scene.add(boomFlash);
function spawnExplosion(center) {
  clearExplosion();
  const cols = [0xf83800, 0xf8b800, 0xfcfcfc, 0xd81800];
  for (let i = 0; i < 34; i++) {           // fireball chunks
    const m = new THREE.Mesh(
      new THREE.BoxGeometry(0.35, 0.35, 0.35),
      new THREE.MeshBasicMaterial({ color: cols[i % 4] }));
    m.position.copy(center);
    const a = (i / 34) * Math.PI * 2, r = 4 + (i * 7) % 9;
    boom.parts.push({
      type: 'fire', life: 1.3,
      m, vx: Math.cos(a) * r, vz: Math.sin(a) * r,
      vy: 6 + (i * 13) % 10
    });
    boom.group.add(m);
  }
  for (let i = 0; i < 10; i++) {           // rising smoke
    const m = new THREE.Sprite(new THREE.SpriteMaterial({
      map: puffTex, color: 0x777777, transparent: true, opacity: 0.85, depthWrite: false }));
    m.scale.setScalar(1.4);
    m.position.copy(center);
    boom.parts.push({
      type: 'smoke', life: 1.9,
      m, vx: Math.cos(i * 2.4) * 0.9, vz: Math.sin(i * 2.4) * 0.9,
      vy: 2.5 + (i % 4)
    });
    boom.group.add(m);
  }
  for (let i = 0; i < 4; i++) {            // bouncing wheel debris
    const m = new THREE.Mesh(
      new THREE.BoxGeometry(0.55, 0.55, 0.55),
      new THREE.MeshBasicMaterial({ color: 0x181818 }));
    m.position.copy(center);
    const a = i * 1.57 + 0.6;
    boom.parts.push({
      type: 'debris', life: 1.9,
      m, vx: Math.cos(a) * 7, vz: Math.sin(a) * 7, vy: 9 + i * 2
    });
    boom.group.add(m);
  }
  boomFlash.position.copy(center);
  boomFlash.position.y += 1;
  boomFlash.scale.setScalar(2);
  boomFlash.material.opacity = 1;
  boom.t = 0;
}
function clearExplosion() {
  for (const p of boom.parts) boom.group.remove(p.m);
  boom.parts.length = 0;
}
function updateExplosion(dt) {
  if (boomFlash.material.opacity > 0) {
    boomFlash.material.opacity = Math.max(0, boomFlash.material.opacity - 6 * dt);
    boomFlash.scale.multiplyScalar(1 + 14 * dt);
  }
  if (!boom.parts.length) return;
  boom.t += dt;
  for (const p of boom.parts) {
    p.life -= dt;
    if (p.life <= 0) { p.m.visible = false; continue; }
    p.m.position.x += p.vx * dt;
    p.m.position.z += p.vz * dt;
    if (p.type === 'smoke') {
      p.m.position.y += p.vy * dt;
      p.m.scale.multiplyScalar(1 + 1.6 * dt);
      p.m.material.opacity = Math.min(0.8, p.life * 0.6);
    } else {
      p.vy -= 24 * dt;
      p.m.position.y += p.vy * dt;
      if (p.m.position.y < 0.28 && p.type === 'debris') {
        p.m.position.y = 0.28;
        p.vy = -p.vy * 0.45;              // bounce
        p.vx *= 0.8; p.vz *= 0.8;
      } else if (p.m.position.y < 0.15) p.m.position.y = 0.15;
      if (p.type === 'fire') p.m.scale.setScalar(Math.max(0.05, p.life * 0.8));
    }
  }
  if (boom.t > 2) clearExplosion();
}

/* ---------------- game state (arcade rules) ---------------- */
const QUAL_TABLE = [
  [58.50, 1, 4000], [60.00, 2, 2000], [62.00, 3, 1400], [64.00, 4, 1000],
  [66.00, 5, 800], [68.00, 6, 600], [70.00, 7, 400], [73.00, 8, 200]
];
const GAME_TIME_RATE = 2;
const QUAL_TIME = 90;
/* operator "dip switch" settings, same ranges as the arcade cabinet */
const DIP_CHOICES = { laps: [3, 4, 5, 6], time: [90, 120], ext: [45, 55, 60],
  track: ['fuji', 'seaside', 'canyon', 'neon', 'alpine', 'jungle', 'peg'] };
const DIP = { laps: 3, time: 90, ext: 60, track: 'fuji' };
try {
  const d = JSON.parse(localStorage.getItem('pp_dip') || '{}');
  for (const k of Object.keys(DIP))
    if (DIP_CHOICES[k].includes(d[k])) DIP[k] = d[k];
} catch (e) {}
let RACE_TIME = DIP.time, EXT_TIME = DIP.ext, RACE_LAPS = DIP.laps;
function applyDip() {
  RACE_TIME = DIP.time; EXT_TIME = DIP.ext; RACE_LAPS = DIP.laps;
  try { localStorage.setItem('pp_dip', JSON.stringify(DIP)); } catch (e) {}
  if (DIP.track !== TRACK_ID) location.reload();   // rebuild the world
}
const PTS_PER_LAP = 10000;
const MAX_SPEED = 87.5;                 // m/s = 315 km/h

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
    // migrate the old single TOP value if it beats the table
    const old = parseInt(localStorage.getItem('pp_top') || '0', 10) || 0;
    if (old > hiScores[hiScores.length - 1].score) {
      hiScores.push({ initials: 'AAA', score: old });
      hiScores.sort((a, b) => b.score - a.score);
      hiScores = hiScores.slice(0, 5);
    }
  }
  bestEver = parseFloat(localStorage.getItem('pp_bestlap') || '0') || 0;
} catch (e) {}
/* ---- global leaderboard (served by the game server, JSON on disk) ----
   localStorage stays as the offline fallback: if /api is unreachable the
   game behaves exactly as it did when scores were per-browser. */
let trackRecs = {};        // trackId -> {initials, time} global lap records
let netScores = false;     // true once the server table has been adopted

function sanitizeScores(list) {
  if (!Array.isArray(list) || !list.length || list.length > 5) return null;
  const ok = list.every(e => e && /^[A-Z0-9]{3}$/.test(e.initials) &&
    Number.isFinite(e.score) && e.score > 0);
  return ok ? list.map(e => ({ initials: e.initials, score: Math.floor(e.score) })) : null;
}
function adoptScores(list) {
  const clean = sanitizeScores(list);
  if (!clean) return;
  hiScores = clean;
  if (hiScores[0].score > topScore) topScore = hiScores[0].score;
  try { localStorage.setItem('pp_scores', JSON.stringify(hiScores)); } catch (e) {}
}
function adoptLaps(laps) {
  if (!laps || typeof laps !== 'object') return;
  trackRecs = {};
  for (const [t, r] of Object.entries(laps)) {
    if (TRACKS[t] && r && /^[A-Z0-9]{3}$/.test(r.initials) &&
        Number.isFinite(r.time) && r.time > 0) {
      trackRecs[t] = { initials: r.initials, time: r.time };
    }
  }
}
function fetchScores() {
  try {
    fetch('/api/scores').then(r => r.ok ? r.json() : null).then(d => {
      if (!d) return;
      adoptScores(d.scores);
      adoptLaps(d.laps);
      netScores = true;
    }).catch(() => {});
  } catch (e) {}   // file:// etc: keep localStorage behavior
}
fetchScores();

function insertScore(initials, score) {
  hiScores.push({ initials, score });
  hiScores.sort((a, b) => b.score - a.score);
  hiScores = hiScores.slice(0, 5);
  try { localStorage.setItem('pp_scores', JSON.stringify(hiScores)); } catch (e) {}
  if (netScores) {
    fetch('/api/scores', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ initials, score }),
    }).then(r => r.ok ? r.json() : null)
      .then(d => { if (d) adoptScores(d.scores); })
      .catch(() => { netScores = false; });
  }
}
function submitLapRecord(initials, time) {
  if (!netScores || is2P()) return;
  fetch('/api/laps', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ initials, track: TRACK_ID, time: Math.round(time * 100) / 100 }),
  }).then(r => r.ok ? r.json() : null)
    .then(d => { if (d) adoptLaps(d.laps); })
    .catch(() => { netScores = false; });
}
function noteLap(t) {
  if (!G.bestLap || t < G.bestLap) G.bestLap = t;
  if (!bestEver || t < bestEver) {
    bestEver = t;
    try { localStorage.setItem('pp_bestlap', String(t)); } catch (e) {}
  }
}
let topScore = 12000;   // live HUD value; hiScores[0] is the persistent one

const G = {};
function resetPlayer() {
  G.pos = 0; G.playerX = 0; G.speed = 0;
  G.gear = 0; G.steer = 0; G.crashed = 0;
  G.invuln = 0; G.shiftCut = 0;
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
  G.bestLap = 0;
  G.demo = false;
  G.paused = false;
  G.ini = null;
  topScore = hiScores[0].score;
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
  return { s, offset, speed: 0, maxPct, mesh, ahead: true, rival,
           ci: colorIdx % 4, phase: colorIdx * 1.7 + s * 0.01 };
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
  REC.cars = G.cars.map(c => c.ci);
}

/* ---------------- two-player (online head-to-head) ----------------
   The server relays; each client simulates its own car. The opponent
   lives in G.cars as a remote-driven pseudo-car so rendering, minimap
   and bump physics all apply to it unchanged. CPU cars are simulated
   by the host and dead-reckoned on the guest. */
const MP = {
  active: false, role: null, code: null, token: null,
  config: { track: 'fuji', laps: 3, cpus: 5 },
  peerPresent: false, peerBuf: null, peerCar: null,
  goLocal: 0, raceT: 0, seq: 0, awaitResult: false,
  result: null, lobbySel: 0,
};
function is2P() { return MP.active; }
const MP_ROWS = [
  ['TRACK', 'track'], ['CPU CARS', 'cpus'], ['LAPS', 'laps'],
  ['SHARE LINK', null], ['START RACE', null]
];
const MP_CHOICES = { track: DIP_CHOICES.track,
  laps: [1, 2, 3, 4, 5, 6], cpus: [0, 1, 2, 3, 4, 5, 6, 7] };

function enter2P() {
  if (MP.active) return;
  G.demo = false;
  AudioFX.engine(false, 0);
  MP.active = true;
  MP.role = 'host';
  MP.code = null; MP.token = null; MP.peerPresent = false;
  MP.config = { track: TRACK_ID, laps: DIP.laps, cpus: 5 };
  MP.lobbySel = 0;
  setState('lobby');
  NET.connect()
    .then(() => NET.send({ t: 'create', config: MP.config }))
    .catch(() => mpLeave('CONNECTION FAILED'));
}

function mpGuestBoot(code) {
  MP.active = true;
  MP.role = 'guest';
  MP.code = code; MP.token = null;
  G.demo = false;
  AudioFX.engine(false, 0);
  setState('joinWait');
  NET.connect()
    .then(() => NET.send({ t: 'probe', code }))
    .catch(() => mpLeave('CONNECTION FAILED'));
}

function mpLeave(msg) {
  if (MP.active && NET.connected()) NET.send({ t: 'leave' });
  NET.close();
  MP.active = false; MP.role = null; MP.code = null; MP.token = null;
  MP.peerPresent = false; MP.peerBuf = null; MP.peerCar = null;
  MP.goLocal = 0; MP.awaitResult = false; MP.result = null;
  RACE_LAPS = DIP.laps;
  if (location.search.indexOf('join') >= 0)
    history.replaceState(null, '', location.pathname);
  initGame();
  if (msg) flash(msg, 2.5);
}

function mpShareLink() {
  const url = location.origin + '/?join=' + MP.code;
  const copied = () => flash('LINK COPIED', 1.6);
  if (navigator.share) {
    navigator.share({ title: 'Pole Position 3D',
      text: 'Race me in Pole Position 3D!', url }).catch(() => {});
  } else if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(url).then(copied, () => mpLegacyCopy(url, copied));
  } else mpLegacyCopy(url, copied);
}
function mpLegacyCopy(text, done) {
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    done();
  } catch (e) {}
}

function mpLobbyInput(k) {
  if (k === 'arrowup') MP.lobbySel = (MP.lobbySel + MP_ROWS.length - 1) % MP_ROWS.length;
  else if (k === 'arrowdown') MP.lobbySel = (MP.lobbySel + 1) % MP_ROWS.length;
  else if (k === 'arrowleft' || k === 'arrowright') {
    const key = MP_ROWS[MP.lobbySel][1];
    if (!key) return;
    const list = MP_CHOICES[key];
    const dir = k === 'arrowright' ? 1 : -1;
    MP.config[key] = list[(list.indexOf(MP.config[key]) + dir + list.length) % list.length];
    NET.send({ t: 'config', config: MP.config });
    AudioFX.beep(660, 0.03, 0.08);
  }
}
function mpLobbyEnter() {
  const row = MP_ROWS[MP.lobbySel][0];
  if (row === 'SHARE LINK') mpShareLink();
  else if (row === 'START RACE') mpRequestStart();
  else mpLobbyInput('arrowright');
}
function mpRequestStart() {
  if (!MP.peerPresent) { flash('NO PLAYER 2 YET', 1.6); return; }
  NET.send({ t: 'start_req' });
}
function mpClearField() {
  for (const c of G.cars) scene.remove(c.mesh);
  G.cars = [];
  MP.peerCar = null;
  MP.peerBuf = null;
  G.speed = 0;
}
function mpResultEnter() {
  if (MP.role !== 'host') return;
  NET.send({ t: 'again' });
  MP.goLocal = 0;
  mpClearField();
  setState('lobby');
}

/* both clients run this on `prep` (and after a resume that lands in
   `starting`): make sure the loaded world matches the room's track —
   reloading if not — then grid up and report ready */
function mpOnPrep(config) {
  MP.config = config;
  if (config.track !== TRACK_ID) { mpReloadForTrack(config.track, true); return; }
  clearReloadGuard();
  RACE_LAPS = config.laps;
  MP.goLocal = 0;
  setState('mpPrep');
  mpSetupGrid();
  NET.send({ t: 'ready_race' });
}

/* switch the world to `track` via a reload. withResume: keep our seat
   through the reload (post-join); without, the ?join= URL re-enters. */
function mpReloadForTrack(track, withResume) {
  if (!guardReload(track)) {   // second reload for the same target: storage is blocked
    mpLeave('STORAGE BLOCKED - CANNOT SWITCH TRACK');
    return;
  }
  try {
    const d = JSON.parse(localStorage.getItem('pp_dip') || '{}');
    d.track = track;
    localStorage.setItem('pp_dip', JSON.stringify(d));
  } catch (e) {
    mpLeave('STORAGE BLOCKED - CANNOT SWITCH TRACK');
    return;
  }
  if (withResume)
    saveResume({ code: MP.code, token: MP.token, role: MP.role, track });
  location.reload();
}

function mpSetupGrid() {
  for (const c of G.cars) scene.remove(c.mesh);
  G.cars = [];
  clearReplayPool();
  G.score = 0; G.lap = 1; G.lapTime = 0; G.passed = 0; G.timer = 999;
  MP.raceT = 0; MP.seq = 0; MP.awaitResult = false; MP.result = null;
  MP.peerBuf = new SnapshotBuffer(TRACK_LEN);
  const total = 2 + MP.config.cpus;
  const slots = [];
  for (let k = 0; k < total; k++)
    slots.push({ s: TRACK_LEN - (k * 9 + 7), off: k % 2 ? 2.2 : -2.2 });
  const mySlot = MP.role === 'host' ? 0 : 1;
  const peerSlot = 1 - mySlot;
  G.pos = wrapS(slots[mySlot].s);
  G.playerX = slots[mySlot].off;
  // the opponent: same body as the local car, blue/white livery
  const peer = {
    s: wrapS(slots[peerSlot].s), offset: slots[peerSlot].off, speed: 0,
    maxPct: 0, mesh: buildF1(0x0058f8, 0xfcfcfc), ahead: false, rival: true,
    remote: true, ci: 2, phase: 0, lap: 1, steer: 0, crashed: 0,
  };
  scene.add(peer.mesh);
  G.cars.push(peer);
  MP.peerCar = peer;
  for (let k = 2; k < total; k++)
    G.cars.push(makeCar(wrapS(slots[k].s), slots[k].off,
      0.60 + 0.025 * (total - 1 - k), k - 2, true));
  for (const c of G.cars) c.ahead = carAhead(c);
  G.speed = 0; G.gear = 0; G.crashed = 0; G.steer = 0; G.invuln = 0;
  G.lapArmed = false;
  REC.data = [];
  REC.cars = G.cars.map(c => c.ci);
}

function mpSendState() {
  NET.send({ t: 'state', n: MP.seq++,
    s: Math.round(G.pos * 10) / 10,
    x: Math.round(G.playerX * 100) / 100,
    v: Math.round(G.speed * 10) / 10,
    st: G.steer,
    cr: Math.round(Math.max(0, G.crashed) * 10) / 10,
    lap: G.lap });
}
function mpSendCars() {
  NET.send({ t: 'cars', n: MP.seq++,
    a: G.cars.filter(c => !c.remote).map(c => [
      Math.round(c.s * 10) / 10,
      Math.round(c.offset * 100) / 100,
      Math.round(c.speed * 10) / 10]) });
}

/* my current race position vs the opponent (for the HUD) */
function mpPos() {
  const p = MP.peerCar;
  if (!p) return 1;
  if (p.lap !== G.lap) return p.lap > G.lap ? 2 : 1;
  return carAhead(p) ? 2 : 1;
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
    const name = ini.chars.map(c => CHARSET[c]).join('');
    if (ini.forScore !== false)
      insertScore(name, Math.floor(G.score / 10) * 10);
    if (ini.forLap) submitLapRecord(name, ini.lap);
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
  ['TRACK', 'track'], ['LAPS', 'laps'], ['GAME TIME', 'time'], ['EXTENDED TIME', 'ext']
];
function optionsInput(k) {
  if (k === 'arrowup') G.optSel = (G.optSel + 3) % 4;
  else if (k === 'arrowdown') G.optSel = (G.optSel + 1) % 4;
  else if (k === 'arrowleft' || k === 'arrowright') {
    const key = DIP_ROWS[G.optSel][1];
    const list = DIP_CHOICES[key];
    const dir = k === 'arrowright' ? 1 : -1;
    DIP[key] = list[(list.indexOf(DIP[key]) + dir + list.length) % list.length];
    // persist right away so the choice survives ANY exit from the menu
    // (backgrounded tab, START instead of OPT, killed browser)
    try { localStorage.setItem('pp_dip', JSON.stringify(DIP)); } catch (e) {}
    AudioFX.beep(660, 0.03, 0.08);
  }
}
window.addEventListener('keydown', (e) => {
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' '].includes(e.key)) e.preventDefault();
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
  if (G.state === 'lobby') {             // two-player host setup
    if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) mpLobbyInput(k);
    else if (e.key === 'Enter') mpLobbyEnter();
    else if (e.key === 'Escape' || k === 'o') mpLeave();
    return;
  }
  if (G.state === 'joinWait' || G.state === 'mpPrep') {
    if (e.key === 'Escape' || k === 'o') mpLeave();
    return;
  }
  if (G.state === 'mpResult') {
    if (e.key === 'Enter') mpResultEnter();
    else if (e.key === 'Escape' || k === 'o') mpLeave();
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
    // no pausing online: the other player's race keeps running
    if (['qualify', 'race', 'lightsQ', 'lightsR'].includes(G.state) && !is2P()) {
      G.paused = !G.paused;
      if (G.paused) AudioFX.engine(false, 0);
    }
  }
  if (k === '2' && (G.state === 'title' || G.state === 'scores')) {
    enter2P();
    return;
  }
  if (k === 'r') {
    if (G.state === 'replay') { exitReplay(); return; }
    if (['title', 'scores', 'gameOver'].includes(G.state)) { enterReplay(); return; }
  }
  if (G.state === 'replay' && (e.key === 'Enter' || e.key === 'Escape')) {
    exitReplay();
    return;
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

function startGame() {
  clearReplayPool();
  REC.data = [];
  REC.cars = [];
  initGame();
  setState('prequal');
  flash('PREPARE TO QUALIFY', 2.4);
  AudioFX.jingle([784, 784, 659, 784, 1047], 130);
  speak('Prepare to qualify');
}
function leaveGameOver(quick) {
  const scoreQ = Math.floor(G.score / 10) * 10 > hiScores[hiScores.length - 1].score;
  const rec = trackRecs[TRACK_ID];
  // beating the global track record also earns an initials entry
  const lapQ = netScores && !is2P() && G.bestLap > 0 &&
    (!rec || G.bestLap < rec.time);
  if (scoreQ || lapQ) {
    G.ini = { chars: [0, 0, 0], slot: 0, forScore: scoreQ, forLap: lapQ, lap: G.bestLap };
    setState('initials');
  } else if (quick) startGame();
  else setState('scores');
}

/* ---------------- simulation ---------------- */
let frame = 0;

/* race recording for the replay (20 Hz position samples) */
const REC = { data: [], cars: [] };
const replayPool = [];
const CAM_POSTS = [];
for (let i = 0; i < 10; i++) {
  const p = posAt(i * TRACK_LEN / 10, (i % 2 ? 1 : -1) * (HALF_W + 16));
  p.y = 7.5;
  CAM_POSTS.push(p);
}
function recordFrame() {
  if (frame % 3) return;
  const row = [G.pos, G.playerX, G.crashed > 0 ? 1 : 0];
  for (const c of G.cars) row.push(c.s, c.offset);
  REC.data.push(row);
  if (REC.data.length > 4200) REC.data.shift();
}
function clearReplayPool() {
  for (const m of replayPool) scene.remove(m);
  replayPool.length = 0;
}
function enterReplay() {
  if (REC.data.length < 40) return;
  for (const c of G.cars) scene.remove(c.mesh);   // replay pool replaces live cars
  G.cars = [];
  clearReplayPool();
  for (const ci of REC.cars) {
    const m = buildF1(...CAR_COLORS[ci % 4]);
    scene.add(m);
    replayPool.push(m);
  }
  G.replayIdx = 0;
  G.demo = false;
  AudioFX.engine(false, 0);
  setState('replay');
}
function exitReplay() {
  clearReplayPool();
  setState('title');
}

/* attract-mode autopilot (same controller proven in automated testing) */
const demoKeys = {};
let demoLastX = 0;
function key(k) { return G.demo ? demoKeys[k] : keys[k]; }
function demoInput() {
  const kap = kappaAt(G.pos + Math.max(35, G.speed * 1.1));
  const kHere = kappaAt(G.pos + 12);
  const cur = Math.abs(kap) > Math.abs(kHere) ? kap : kHere;
  const sp = G.speed / MAX_SPEED;
  demoKeys['arrowup'] = true;
  demoKeys['arrowdown'] = (Math.abs(cur) > 0.02 && sp > 0.62) ||
                          (Math.abs(cur) > 0.012 && sp > 0.88);
  if (sp > 0.42 && G.gear === 0 && G.crashed <= 0) G.gear = 1;
  if (G.crashed > 0) G.gear = 0;
  const vx = (G.playerX - demoLastX) * 60;
  demoLastX = G.playerX;
  const err = -G.playerX * 0.50 - vx * 0.12 + cur * 140 * sp;
  demoKeys['arrowleft'] = err < -0.25;
  demoKeys['arrowright'] = err > 0.25;
}

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
      G.invuln = 2.0;              // blinking grace period after respawn
    }
  } else {
    if (G.invuln > 0) G.invuln -= dt;
    if (G.shiftCut > 0) G.shiftCut -= dt;
    if ((key('arrowup') || key('w')) && G.shiftCut <= 0)
      G.speed += accelFor(G.gear, speedPct) * dt;
    else if (!(key('arrowup') || key('w'))) G.speed -= MAX_SPEED / 8 * dt;
    if (key('arrowdown') || key('s') || key(' ')) G.speed -= MAX_SPEED / 3 * dt;
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
    if (key('arrowleft') || key('a')) st = -1;
    if (key('arrowright') || key('d')) st = 1;
    G.steer = st;
    G.playerX += st * 13 * sp * dt;
    // centrifugal drift, from true curvature
    const k = kappaAt(G.pos + G.speed * 0.25);
    G.playerX -= k * G.speed * G.speed * 0.1 * dt;
    if (Math.abs(k) > 0.02 && sp > 0.7 && (frame & 5) === 0) AudioFX.skid();
    // skid marks + tire smoke near the grip limit or under hard braking
    const braking = key('arrowdown') || key('s') || key(' ');
    G.braking = braking && G.speed > 2;
    const gripLoad = Math.abs(kappaAt(G.pos)) * G.speed * G.speed * 0.1;
    if (G.speed > 26 && (braking || gripLoad > 8.5) && (frame & 1)) {
      laySkid(G.playerX - 1.15);
      laySkid(G.playerX + 1.15);
      if ((frame & 7) === 1) {
        puffSmoke(G.playerX - 1.1);
        puffSmoke(G.playerX + 1.1);
      }
    }
    G.playerX = Math.max(-HALF_W * 2.2, Math.min(HALF_W * 2.2, G.playerX));

    // hazards
    for (const h of hazards) {
      const dz = (h.s - G.pos + TRACK_LEN * 1.5) % TRACK_LEN - TRACK_LEN / 2;
      if (dz < -6 || dz > 6) continue;
      if (h.kind === 'puddle') {
        // footprint matches the visual: ~10m streak, 4m wide
        if (Math.abs(dz) < 5.4 && Math.abs(G.playerX - h.x) < 2.0 &&
            G.speed > MAX_SPEED * 0.3) {
          G.speed *= (1 - 3 * dt);
          G.playerX += (G.playerX < h.x ? -1 : 1) * 4 * dt;
          AudioFX.skid();
        }
      } else if (dz >= -3 && dz <= 5 && Math.abs(G.playerX - h.x) < 2.6 &&
                 G.speed > MAX_SPEED * 0.05 && G.invuln <= 0) {
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
    Math.min(1, (G.speed / MAX_SPEED) / capPct) * (G.gear ? 0.85 : 1), G.gear === 1);
  return crossed;
}

function updateCars(dt) {
  const guest = is2P() && MP.role === 'guest';
  for (const c of G.cars) {
    if (c.remote) {
      // the opponent: replay their state stream ~100ms in the past
      const snap = MP.peerBuf && MP.peerBuf.sampleAt(performance.now() - 100);
      if (snap) {
        c.s = snap.s; c.offset = snap.x; c.speed = snap.v;
        c.steer = snap.st; c.crashed = snap.cr; c.lap = snap.lap;
      }
    } else if (guest) {
      // host owns the CPU cars: dead-reckon between its 10 Hz snapshots
      // and bleed the positional error in over ~100ms so nothing pops
      c.s = wrapS(c.s + c.speed * dt);
      if (c.sErr) {
        const f = Math.min(1, dt * 10);
        c.s = wrapS(c.s + c.sErr * f);
        c.sErr *= 1 - f;
        if (Math.abs(c.sErr) < 0.01) c.sErr = 0;
      }
      if (c.offTarget !== undefined)
        c.offset += (c.offTarget - c.offset) * Math.min(1, dt * 0.6);
    } else {
      const kAhead = Math.abs(kappaAt(c.s + c.speed * 0.9));
      const safe = 1 - Math.min(0.55, kAhead * (c.rival ? 14 : 22));
      // per-car personality: gentle pace surges and lane sway
      const surge = 1 + 0.04 * Math.sin(frame * 0.007 + c.phase);
      const target = MAX_SPEED * c.maxPct * safe * surge;
      c.speed += Math.min(1, dt * 0.5) * (target - c.speed);
      c.s = wrapS(c.s + c.speed * dt);
      // drift toward the inside of the corner, plus a slow sway
      const k = kappaAt(c.s);
      const sway = Math.sin(frame * 0.004 + c.phase * 2.3) * 0.9;
      const want = Math.max(-3.4, Math.min(3.4,
        sway + c.offset + (k > 0.004 ? 0.5 : k < -0.004 ? -0.5 : 0)));
      c.offset += (want - c.offset) * Math.min(1, dt * 0.6);
    }

    const nowAhead = carAhead(c);
    if (c.ahead && !nowAhead && G.crashed <= 0 && !c.remote) {
      G.passed++;
      AudioFX.beep(880, 0.05, 0.08);
      if (Math.abs(c.offset - G.playerX) < 4.5) AudioFX.whoosh();
    }
    c.ahead = nowAhead;

    // car-to-car contact trades paint instead of exploding: displacement
    // resolves the overlap every frame, the thud/shake fires once per touch.
    // For the remote opponent only the LOCAL car is displaced — their side
    // runs the mirrored code, and their state stream stays authoritative.
    if (c.bumpT > 0) c.bumpT -= dt;
    if (G.crashed <= 0 && !(c.remote && c.crashed > 0)) {
      const dz = (c.s - G.pos + TRACK_LEN * 1.5) % TRACK_LEN - TRACK_LEN / 2;
      const dx = c.offset - G.playerX;
      if (dz > -4.8 && dz < 4.8 && Math.abs(dx) < 2.0) {
        const side = dx !== 0 ? Math.sign(dx) : (c.phase > Math.PI ? 1 : -1);
        if (Math.abs(dz) < 3.1) {
          // side-by-side: shove both cars apart, scrub some speed
          const push = 2.0 - Math.abs(dx);
          G.playerX -= side * push * 0.75;
          if (!c.remote) {
            c.offset = Math.max(-4.2, Math.min(4.2, c.offset + side * push * 0.55));
            c.speed *= 1 - 0.6 * dt;
          }
          G.speed *= 1 - 1.2 * dt;
        } else if (dz > 0) {
          // player rear-ends the car ahead: match its pace, shunt it on
          G.speed = Math.min(G.speed, c.speed * 0.92);
          if (!c.remote) {
            c.speed = Math.min(MAX_SPEED, c.speed + 4);
            c.s = wrapS(c.s + (4.8 - dz) * 0.6);
          }
          G.playerX -= side * 0.5;
        } else {
          // rival rear-ends the player: a forward shunt, rival checks up
          G.speed = Math.min(MAX_SPEED, G.speed + 3);
          if (!c.remote) {
            c.speed *= 0.85;
            c.s = wrapS(c.s - (4.8 + dz) * 0.6);
          }
        }
        if (!(c.bumpT > 0)) {
          c.bumpT = 0.35;
          G.bumpT = 0.3;
          AudioFX.beep(85, 0.12, 0.35, 'square');   // metallic thud
          AudioFX.skid();
        }
      }
    }
  }
}

function update(dt) {
  G.stateT += dt;
  if (G.bannerT > 0) { G.bannerT -= dt; if (G.bannerT <= 0) G.banner = null; }
  if (G.bumpT > 0) G.bumpT -= dt;
  frame++;
  updateExplosion(dt);
  updateEffects(dt);

  switch (G.state) {
    case 'title':
      // attract mode: after a moment the game drives itself
      if (!G.demo && G.stateT > 2) {
        G.demo = true;
        resetPlayer();
        demoLastX = 0;
      }
      if (G.demo) {
        demoInput();
        updateDriving(dt, false);
      }
      // attract jingle every ~8s once audio is unlocked
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
        for (const c of G.cars) scene.remove(c.mesh);
        G.cars = [];
        setState('title');
      }
      break;

    case 'initials':
    case 'options':
    case 'lobby':
    case 'joinWait':
      break;

    case 'mpPrep':
      // both seats are gridded; the server's go-time drives the lights
      if (MP.goLocal && Date.now() >= MP.goLocal - 2400) {
        setState('lightsR');
        speak('Prepare to race');
      } else if (G.stateT > 50) {
        mpLeave('SYNC TIMEOUT');
      }
      break;

    case 'mpResult':
      G.speed = Math.max(0, G.speed - MAX_SPEED * dt * 0.4);
      G.pos = wrapS(G.pos + G.speed * dt);
      AudioFX.engine(G.speed > 1, G.speed / MAX_SPEED);
      if (is2P()) updateCars(dt);   // let the field roll behind the overlay
      break;

    case 'replay':
      G.replayIdx += 0.34;                 // 20 Hz samples at 60 fps = realtime
      if (G.replayIdx >= REC.data.length - 1) exitReplay();
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
      recordFrame();
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
      if (!is2P()) G.timer -= dt * GAME_TIME_RATE;   // no clock head-to-head
      G.lapTime += dt * GAME_TIME_RATE;
      if (is2P()) MP.raceT += dt;
      if (G.demo) demoInput();                       // test-hook autopilot
      recordFrame();
      const crossed = updateDriving(dt, true);
      if (crossed && !MP.awaitResult) {
        if (!G.lapArmed) {
          G.lapArmed = true;
          G.lapTime = 0;
        } else if (G.lap >= RACE_LAPS) {
          noteLap(G.lapTime);
          if (is2P()) {
            // report the finish; the server names the winner
            MP.awaitResult = true;
            NET.send({ t: 'finished', time: MP.raceT });
            flash('FINISHED!', 2.5);
            AudioFX.goal();
          } else {
            finishRace();
            break;
          }
        } else {
          noteLap(G.lapTime);
          G.lap++;
          G.lapTime = 0;
          if (!is2P()) G.timer += EXT_TIME;
          if (G.lap === RACE_LAPS) {
            flash('FINAL LAP!', 2);
            speak('Final lap');
          } else if (!is2P()) {
            flash('EXTENDED PLAY!', 1.6);
          }
          AudioFX.extend();
        }
      }
      if (is2P()) {
        if (frame % 3 === 0) mpSendState();
        if (MP.role === 'host' && frame % 6 === 0) mpSendCars();
      } else if (G.timer <= 0) {
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

/* ---------------- 3D view ---------------- */
const _eye = new THREE.Vector3(), _look = new THREE.Vector3();
let viewX = 0;
function updateView() {
  const driving = ['qualify', 'race', 'finish', 'timeUp', 'lightsQ', 'lightsR',
    'qualDone', 'qualFail', 'mpPrep', 'mpResult'].includes(G.state) ||
    (G.state === 'title' && G.demo);

  // checkered flags waggle on the final lap
  const finalLap = (G.state === 'race' || G.state === 'finish') && G.lap === RACE_LAPS;
  for (const fl of finishFlags)
    fl.rotation.z = finalLap ? Math.sin(frame * 0.3) * 0.35 : 0;

  // gantry countdown lights follow the same steps as the HUD lights
  if (G.state === 'lightsQ' || G.state === 'lightsR') {
    const step = Math.floor(G.stateT / 0.8);
    const green = G.stateT > 2.15;
    startLights.forEach((m, i) => green ? m.color.setRGB(0.6, 9, 0.6)
      : step >= i ? m.color.setRGB(9, 0.5, 0.35) : m.color.setHex(0x3a0000));
  } else if ((G.state === 'qualify' || G.state === 'race') && G.stateT < 1.6) {
    startLights.forEach(m => m.color.setRGB(0.6, 9, 0.6));
  } else {
    startLights.forEach(m => m.color.setHex(0x3a0000));
  }

  // puddles shimmer
  if (puddleMat && (frame & 3) === 0)
    puddleMat.color.setHex(Math.sin(frame * 0.09) > 0 ? ENV.pud[0] : ENV.pud[1]);

  // player car
  playerMesh.visible = driving && G.crashed <= 0 &&
    !((G.state === 'lightsQ' || G.state === 'lightsR') && frame % 16 < 8) &&
    !(G.invuln > 0 && frame % 6 < 3);              // respawn blink
  if (driving) {
    posAt(G.pos, G.playerX, playerMesh.position);
    playerMesh.rotation.y = headingAt(G.pos) - G.steer * 0.14 * (0.3 + 0.7 * G.speed / MAX_SPEED);
    playerMesh.position.y = G.speed > 5 ? (frame % 6 < 3 ? 0 : 0.05) : 0;
    for (const w of playerMesh.userData.wheels) {
      w.m.rotation.x -= (G.speed / w.r) * 0.0167;
      if (w.front) w.yaw.rotation.y = -G.steer * 0.3;
    }
    if (G.braking) playerMesh.userData.brakeMat.color.setRGB(9, 0.5, 0.3);
    else playerMesh.userData.brakeMat.color.setHex(0x4a0400);
    const flameOn = G.shiftCut > 0.04 && G.speed > 5 && G.crashed <= 0;
    for (const f of flames) {
      f.visible = flameOn;
      if (flameOn) f.scale.setScalar(0.4 + (frame % 3) * 0.14);
    }
  }

  // rivals
  for (const c of G.cars) {
    posAt(c.s, c.offset, c.mesh.position);
    c.mesh.rotation.y = headingAt(c.s) -
      (c.remote ? (c.steer || 0) * 0.14 : 0);   // opponent's visual steer lean
    if (c.remote) c.mesh.visible = !(c.crashed > 0);
    for (const w of c.mesh.userData.wheels)
      w.m.rotation.x -= (c.speed / w.r) * 0.0167;
  }

  if (window.__ppTopView) {
    posAt(G.pos, 0, _eye);
    camera.position.set(_eye.x, 900, _eye.z);
    camera.lookAt(_eye.x, 0, _eye.z + 0.01);
    renderer.render(scene, camera);
    return;
  }
  if (G.state === 'replay') {
    const row = REC.data[Math.floor(G.replayIdx)] || REC.data[0];
    posAt(row[0], row[1], playerMesh.position);
    playerMesh.rotation.y = headingAt(row[0]);
    playerMesh.visible = !row[2];
    for (let i = 0; i < replayPool.length; i++) {
      const s = row[3 + i * 2];
      if (s === undefined) { replayPool[i].visible = false; continue; }
      replayPool[i].visible = true;
      posAt(s, row[4 + i * 2], replayPool[i].position);
      replayPool[i].rotation.y = headingAt(s);
    }
    // nearest trackside camera follows the action
    posAt(row[0], row[1], _mini);
    let best = CAM_POSTS[0], bd = Infinity;
    for (const post of CAM_POSTS) {
      const d = post.distanceToSquared(_mini);
      if (d < bd) { bd = d; best = post; }
    }
    camera.position.copy(best);
    camera.lookAt(_mini.x, 1.2, _mini.z);
    sun.position.copy(camera.position).addScaledVector(SUN_DIR, 220);
    sun.target.position.copy(camera.position);
    sun.target.updateMatrixWorld();
    composer.render();
    return;
  }
  if (driving) {
    // chase camera with smoothed lateral follow
    viewX += (G.playerX - viewX) * 0.14;
    posAt(G.pos - 11, viewX * 0.72, _eye);
    _eye.y = 4.6;
    posAt(G.pos + 10, viewX * 0.4, _look);
    _look.y = 1.3;
    const sp = G.speed / MAX_SPEED;
    if (G.crashed > 1.3) {                    // shake during the blast
      _eye.x += Math.sin(frame * 1.7) * 0.35;
      _eye.y += Math.cos(frame * 2.3) * 0.3;
    }
    if (sp > 0.85) _eye.y += Math.sin(frame * 2.9) * 0.05;    // top-speed buzz
    if (Math.abs(G.playerX) > HALF_W && G.speed > 8)
      _eye.y += Math.sin(frame * 5.1) * 0.14;                 // off-road judder
    if (G.bumpT > 0) {                                        // contact jolt
      _eye.x += Math.sin(frame * 3.1) * 0.24 * (G.bumpT / 0.3);
      _eye.y += Math.cos(frame * 2.6) * 0.18 * (G.bumpT / 0.3);
    }
    // speed-sensitive field of view
    const fovT = 66 + 8 * sp;
    if (Math.abs(camera.fov - fovT) > 0.05) {
      camera.fov += (fovT - camera.fov) * 0.08;
      camera.updateProjectionMatrix();
    }
    camera.position.copy(_eye);
    camera.lookAt(_look);
  } else {
    // title / game-over: slow flyover around the circuit
    if (Math.abs(camera.fov - 68) > 0.05) {
      camera.fov += (68 - camera.fov) * 0.08;
      camera.updateProjectionMatrix();
    }
    const s = (performance.now() / 1000 * 22) % TRACK_LEN;
    posAt(s, 0, _eye);
    _eye.y = 15;
    posAt(s + 55, 0, _look);
    _look.y = 2;
    camera.position.copy(_eye);
    camera.lookAt(_look);
  }
  // shadow frustum tracks the camera so the whole visible area is lit
  sun.position.copy(camera.position).addScaledVector(SUN_DIR, 220);
  sun.target.position.copy(camera.position);
  sun.target.updateMatrixWorld();
  composer.render();
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
  drawText(is2P() ? 'POS' : 'TIME', 100, 2, C.hudYel);
  ctx.fillStyle = C.hudBlue;
  ctx.fillRect(168, 0, 88, 10);
  const inRace = ['qualify', 'race', 'finish', 'timeUp', 'mpResult'].includes(G.state);
  drawText('LAP', 174, 2, C.hudWhite);
  drawText(inRace ? fmtLap(G.lapTime) : '0"00', 200, 2, C.hudWhite);
  if (['race', 'finish', 'mpResult'].includes(G.state))
    drawText(G.lap + '/' + RACE_LAPS, 232, 11, C.hudCyan);
  else if (G.state === 'qualify')
    drawText('QUAL', 232, 11, C.hudCyan);
  if (G.bestLap && inRace)   // bottom edge, left of the LO/HI gear indicator
    drawText('B ' + fmtLap(G.bestLap), HW - 74, HH - 10, C.hudWhite);
  drawText('SCORE', 6, 11, C.hudYel);
  drawText(String(Math.floor(G.score / 10) * 10), 42, 11, C.hudWhite);
  if (is2P()) {
    // head-to-head has no clock: show live race position instead
    const p = mpPos();
    if (['race', 'lightsR', 'mpPrep', 'mpResult'].includes(G.state))
      drawText(p + '/2', 106, 11, p === 1 ? C.hudYel : C.hudWhite);
  } else {
    const showTimer = ['qualify', 'race', 'lightsQ', 'lightsR', 'finish', 'timeUp'].includes(G.state);
    drawText(showTimer ? String(Math.max(0, Math.ceil(G.timer))) : '', 106, 11,
      G.timer < 15 && (frame % 20 < 10) ? C.hudRed : C.hudWhite);
  }
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
      shade(36, 62);
      drawTextC('POLE', 44, C.hudRed, 3);
      drawTextC('POSITION', 68, C.hudRed, 3);
      drawTextC(TRACKS[TRACK_ID].name, 92, C.hudWhite);
      shade(106, 80);
      drawTextC('TOP SCORE ' + topScore, 108, C.hudYel);
      const rec = trackRecs[TRACK_ID];
      if (rec) drawTextC('TRACK RECORD ' + fmtLap(rec.time) + ' ' + rec.initials, 120, C.hudYel);
      else if (bestEver) drawTextC('BEST LAP ' + fmtLap(bestEver), 120, C.hudYel);
      if (frame % 40 < 26) drawTextC('PRESS ENTER TO RACE', 136, C.hudWhite);
      drawTextC(COARSE ? '2 PLAYER - TAP HERE' : '2 PLAYER - PRESS 2', 148, C.hudYel);
      drawTextC('QUALIFY IN UNDER 73"00', 160, C.hudCyan);
      drawTextC('THEN RACE ' + RACE_LAPS + ' LAPS  - O OPTIONS', 172, C.hudCyan);
      break;
    }
    case 'lobby': {
      shade(36, 150);
      drawTextC('2 PLAYER SETUP', 42, C.hudRed, 2);
      if (!MP.code) {
        if (frame % 30 < 20) drawTextC('CONNECTING...', 104, C.hudWhite);
        break;
      }
      drawTextC('ROOM CODE ' + MP.code, 62, C.hudYel);
      MP_ROWS.forEach(([label, key], i) => {
        const y = 82 + i * 15;
        const sel = i === MP.lobbySel;
        drawText((sel ? '>' : ' ') + label, 40, y, sel ? C.hudYel : C.hudWhite);
        if (key) {
          const val = key === 'track' ? TRACKS[MP.config.track].name
            : String(MP.config[key]);
          drawText(val, 214 - textW(val), y, sel ? C.hudYel : C.hudCyan);
        }
      });
      // the arcade font has no '?'/'=' glyphs, so never print the raw URL
      drawTextC('SHARE THE LINK TO INVITE A FRIEND', 160, C.hudCyan);
      drawTextC(MP.peerPresent ? 'PLAYER 2 CONNECTED' : 'WAITING FOR PLAYER 2...',
        172, MP.peerPresent ? '#00d800' : C.hudWhite);
      break;
    }
    case 'joinWait': {
      shade(52, 122);
      drawTextC('2 PLAYER RACE', 58, C.hudRed, 2);
      if (!MP.token) {
        if (frame % 30 < 20) drawTextC('JOINING ' + (MP.code || '') + '...', 104, C.hudWhite);
        drawTextC(COARSE ? 'OPT EXIT' : 'ESC EXIT', 162, C.hudCyan);
        break;
      }
      drawTextC('ROOM ' + MP.code, 82, C.hudYel);
      drawTextC(TRACKS[MP.config.track] ? TRACKS[MP.config.track].name : '', 100, C.hudWhite);
      drawTextC(MP.config.laps + ' LAPS - ' + MP.config.cpus + ' CPU CARS', 114, C.hudCyan);
      if (frame % 40 < 26) drawTextC('WAITING FOR HOST', 140, C.hudWhite);
      drawTextC(COARSE ? 'OPT EXIT' : 'ESC EXIT', 162, C.hudCyan);
      break;
    }
    case 'mpPrep': {
      shade(90, 42);
      drawTextC('GET READY', 96, C.hudYel, 2);
      if (frame % 30 < 20) drawTextC('SYNCING...', 118, C.hudWhite);
      break;
    }
    case 'mpResult': {
      const win = MP.result && MP.result.win;
      shade(76, 96);
      drawTextC(win ? 'YOU WIN!' : 'YOU LOSE', 84, win ? C.hudYel : C.hudRed, 2);
      if (MP.result && MP.result.forfeit)
        drawTextC('OPPONENT LEFT THE RACE', 108, C.hudWhite);
      else if (MP.result && MP.result.time != null)
        drawTextC('WINNER TIME ' + fmtLap(MP.result.time), 108, C.hudWhite);
      drawTextC(MP.role === 'host'
        ? (COARSE ? 'TAP FOR REMATCH' : 'ENTER REMATCH')
        : 'HOST PICKS REMATCH', 132, C.hudCyan);
      drawTextC(COARSE ? 'OPT EXIT' : 'ESC EXIT', 146, C.hudCyan);
      break;
    }
    case 'scores': {
      shade(52, 122);
      drawTextC('HIGH SCORES', 58, C.hudRed, 2);
      if (netScores) drawTextC('GLOBAL - ALL PLAYERS', 74, C.hudCyan);
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
      shade(52, 122);
      drawTextC('OPTIONS', 58, C.hudRed, 2);
      DIP_ROWS.forEach(([label, key], i) => {
        const y = 82 + i * 15;
        const sel = i === G.optSel;
        drawText((sel ? '>' : ' ') + label, 40, y, sel ? C.hudYel : C.hudWhite);
        const val = key === 'track' ? TRACKS[DIP[key]].name : String(DIP[key]);
        drawText(val, 214 - textW(val), y, sel ? C.hudYel : C.hudCyan);
      });
      drawTextC(COARSE ? 'TAP ROW TO CHANGE - OPT OK'
        : 'ARROWS CHANGE - ENTER OK', 152, C.hudWhite);
      break;
    }
    case 'initials': {
      shade(60, 110);
      const lapOnly = G.ini.forLap && !G.ini.forScore;
      drawTextC(lapOnly ? 'TRACK RECORD!' : 'GREAT SCORE!', 66, C.hudYel, 2);
      drawTextC(lapOnly ? fmtLap(G.ini.lap)
        : String(Math.floor(G.score / 10) * 10), 88, C.hudWhite);
      drawTextC('ENTER YOUR INITIALS', 104, C.hudCyan);
      const x0 = HW / 2 - 27;
      for (let i = 0; i < 3; i++) {
        const cur = i === G.ini.slot;
        const ch = CHARSET[G.ini.chars[i]];
        if (!cur || frame % 16 < 10)
          drawText(ch, x0 + i * 20, 122, cur ? C.hudRed : C.hudWhite, 2);
        ctx.fillStyle = cur ? C.hudRed : '#555';
        ctx.fillRect(x0 + i * 20, 138, 11, 2);
      }
      drawTextC(COARSE ? 'STEER TO CHANGE - TAP OK'
        : 'ARROWS CHANGE - ENTER OK', 152, C.hudWhite);
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
      if (REC.data.length > 40) drawTextC('R REPLAY', 154, C.hudCyan);
      break;
    }
  }
}
function renderMinimap(row) {
  const x0 = 8, y0 = HH - 14 - MINI.h;
  ctx.fillStyle = 'rgba(0,0,0,0.42)';
  ctx.fillRect(x0 - 3, y0 - 3, MINI.w + 7, MINI.h + 7);
  ctx.strokeStyle = '#b0b0b0';
  ctx.lineWidth = 1;
  ctx.beginPath();
  MINI.pts.forEach(([mx, my], i) => i ? ctx.lineTo(x0 + mx, y0 + my) : ctx.moveTo(x0 + mx, y0 + my));
  ctx.closePath();
  ctx.stroke();
  const [sx, sy] = MINI.pts[0];
  ctx.fillStyle = '#fcfcfc';
  ctx.fillRect(x0 + sx - 1, y0 + sy - 1, 3, 2);
  const dot = (s, off, col, size) => {
    posAt(s, off, _mini);
    const [mx, my] = MINI.map(_mini);
    ctx.fillStyle = col;
    ctx.fillRect(x0 + mx - size / 2, y0 + my - size / 2, size, size);
  };
  if (row) {
    for (let i = 3; i + 1 < row.length; i += 2) dot(row[i], row[i + 1], '#3cbcfc', 2);
    dot(row[0], row[1], '#f83800', 3);
  } else {
    for (const c of G.cars)
      dot(c.s, c.offset, c.remote ? '#f8b800' : '#3cbcfc', c.remote ? 3 : 2);
    dot(G.pos, G.playerX, '#f83800', 3);
  }
}
function renderHud2D() {
  ctx.clearRect(0, 0, HW, HH);
  if (G.state === 'replay') {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, HW, 12);
    ctx.fillRect(0, HH - 12, HW, 12);
    if (frame % 30 < 20) drawText('REPLAY', 8, 3, C.hudRed);
    drawText('R EXIT', HW - 46, 3, C.hudWhite);
    renderMinimap(REC.data[Math.floor(G.replayIdx)]);
    return;
  }
  // faint speed streaks at the edges when flat out
  const spd = G.speed / MAX_SPEED;
  if ((G.state === 'qualify' || G.state === 'race') && spd > 0.86 && G.crashed <= 0) {
    ctx.strokeStyle = 'rgba(255,255,255,' + (0.32 * (spd - 0.86) / 0.14).toFixed(3) + ')';
    ctx.lineWidth = 1;
    for (let i = 0; i < 14; i++) {
      const ang = i / 14 * Math.PI * 2 + (frame & 3) * 0.4;
      const r1 = 74 + (i * 13) % 28, r2 = r1 + 24;
      ctx.beginPath();
      ctx.moveTo(HW / 2 + Math.cos(ang) * r1, 122 + Math.sin(ang) * r1 * 0.72);
      ctx.lineTo(HW / 2 + Math.cos(ang) * r2, 122 + Math.sin(ang) * r2 * 0.72);
      ctx.stroke();
    }
  }
  renderHUD();
  if (['qualify', 'race', 'finish', 'timeUp', 'mpResult'].includes(G.state)) renderMinimap();
  renderLights();
  renderBanner();
  renderStateOverlays();
  if (G.paused && Math.floor(performance.now() / 350) % 2 === 0) {
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(HW / 2 - 40, 100, 80, 16);
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
  if (dt < 0) dt = 0;   // first RAF timestamp can lag the module-eval clock
  acc += dt;
  while (acc >= STEP) { if (!G.paused) update(STEP); acc -= STEP; }
  updateView();
  renderHud2D();
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

/* input hook for on-screen touch controls (touch.js) */
window.__ppInput = (k, down, pt) => {
  AudioFX.ensure();
  if (AudioFX.ctx && AudioFX.ctx.state === 'suspended') AudioFX.ctx.resume();
  if (k === 'gear') { if (down) toggleGear(); return; }
  if (k === 'pause') {
    if (down && ['qualify', 'race', 'lightsQ', 'lightsR'].includes(G.state) && !is2P()) {
      G.paused = !G.paused;
      if (G.paused) AudioFX.engine(false, 0);
    }
    return;
  }
  if (k === 'o') {
    if (down) {
      // in any 2P screen the OPT button is the back/exit key
      if (['lobby', 'joinWait', 'mpPrep', 'mpResult'].includes(G.state)) { mpLeave(); return; }
      if (G.state === 'options') { applyDip(); setState('title'); }
      else if (G.state === 'title' || G.state === 'scores') {
        G.demo = false;
        AudioFX.engine(false, 0);
        G.optSel = 0;
        setState('options');
      }
    }
    return;
  }
  if (k === 'tap') {                     // screen tap, pt in 256x224 HUD coords
    if (down) {
      if (G.state === 'options' && pt) {
        if (pt.y >= 75 && pt.y < 142) {  // menu rows at y = 82 + i*15
          G.optSel = Math.max(0, Math.min(DIP_ROWS.length - 1,
            Math.round((pt.y - 82) / 15)));
          optionsInput(pt.x < HW / 2 ? 'arrowleft' : 'arrowright');
        } else if (pt.y >= 142) { applyDip(); setState('title'); }
      } else if (G.state === 'lobby' && pt) {
        if (pt.y >= 75 && pt.y < 155) {  // same row geometry as options
          MP.lobbySel = Math.max(0, Math.min(MP_ROWS.length - 1,
            Math.round((pt.y - 82) / 15)));
          const key = MP_ROWS[MP.lobbySel][1];
          if (key) mpLobbyInput(pt.x < HW / 2 ? 'arrowleft' : 'arrowright');
          else mpLobbyEnter();           // SHARE LINK / START RACE rows
        }
      } else if (G.state === 'mpResult') mpResultEnter();
      else if (G.state === 'title' || G.state === 'scores') {
        // the "2 PLAYER - TAP HERE" line on the title card
        if (G.state === 'title' && pt && pt.y >= 144 && pt.y < 157) enter2P();
        else startGame();
      }
      else if (G.state === 'gameOver') leaveGameOver(true);
      else if (G.state === 'initials') confirmInitial();
    }
    return;
  }
  if (k === 'enter') {
    if (down) {
      if (G.state === 'title' || G.state === 'scores') startGame();
      else if (G.state === 'gameOver') leaveGameOver(true);
      else if (G.state === 'initials') confirmInitial();
      else if (G.state === 'options') { applyDip(); setState('title'); }  // like keyboard Enter
      else if (G.state === 'lobby') mpRequestStart();   // START button = go
      else if (G.state === 'mpResult') mpResultEnter();
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

/* ---------------- two-player: server events + boot ---------------- */
NET.on('created', (m) => {          // host: room is open
  MP.code = m.code; MP.token = m.token; MP.config = m.config;
});
NET.on('peer_joined', () => {
  MP.peerPresent = true;
  AudioFX.beep(880, 0.08, 0.15);
});
NET.on('room_info', (m) => {        // guest: probe reply, before taking the seat
  if (!MP.active || MP.role !== 'guest' || MP.token) return;
  if (m.config.track !== TRACK_ID) { mpReloadForTrack(m.config.track, false); return; }
  clearReloadGuard();
  NET.send({ t: 'join', code: MP.code });
});
NET.on('joined', (m) => {           // guest: seat taken
  MP.token = m.token; MP.config = m.config;
});
NET.on('join_error', (m) => {
  mpLeave(m.reason === 'full' ? 'ROOM FULL'
    : m.reason === 'in_progress' ? 'RACE IN PROGRESS' : 'ROOM NOT FOUND');
});
NET.on('config', (m) => {           // host's lobby edits / rematch reset
  MP.config = m.config;
  if (G.state === 'mpResult' && MP.role === 'guest') {
    mpClearField();
    setState('joinWait');
  }
});
NET.on('prep', (m) => mpOnPrep(m.config));
NET.on('resumed', (m) => {          // seat reclaimed after a track-change reload
  if (m.phase === 'starting') mpOnPrep(m.config);
  else {
    MP.config = m.config;
    setState(MP.role === 'host' ? 'lobby' : 'joinWait');
  }
});
NET.on('go', (m) => { MP.goLocal = NET.toLocal(m.goAt); });
NET.on('peer', (m) => {
  if (MP.peerBuf)
    MP.peerBuf.push({ n: m.n, tArr: performance.now(), s: m.s, x: m.x,
                      v: m.v, st: m.st, cr: m.cr, lap: m.lap });
});
NET.on('cars', (m) => {
  if (!is2P() || MP.role !== 'guest' || !Array.isArray(m.a)) return;
  const locals = G.cars.filter(c => !c.remote);
  for (let i = 0; i < locals.length && i < m.a.length; i++) {
    const [s, off, v] = m.a[i];
    const c = locals[i];
    c.speed = v;
    c.offTarget = off;
    // fresh error vs our dead-reckoned position; updateCars bleeds it in
    c.sErr = (s - c.s + TRACK_LEN * 1.5) % TRACK_LEN - TRACK_LEN / 2;
  }
});
NET.on('result', (m) => {
  if (!is2P()) return;
  MP.result = { win: m.winner === MP.role, time: m.time, forfeit: m.forfeit };
  AudioFX.engine(false, 0);
  if (MP.result.win) { AudioFX.goal(); AudioFX.cheer(); speak('Congratulations'); }
  else AudioFX.fail();
  setState('mpResult');
});
NET.on('peer_left', (m) => {
  if (!is2P()) return;
  MP.peerPresent = false;
  if (m.phase === 'racing') flash('OPPONENT DISCONNECTED', 2.5);   // result follows
  else {
    flash('PLAYER 2 LEFT', 2);
    if (MP.role === 'host' && G.state === 'mpPrep') setState('lobby');
  }
});
NET.on('room_closed', (m) => {
  if (!is2P()) return;
  mpLeave(m.reason === 'host_left' ? 'HOST LEFT' : 'ROOM CLOSED');
});
NET.on('error', (m) => {
  if (m.code === 'no_guest') flash('NO PLAYER 2 YET', 1.6);
});
NET.on('_closed', () => {           // transport died out from under us
  if (is2P()) mpLeave('CONNECTION LOST');
});

// boot: a resume record (mid-start track reload) outranks a ?join= link
(function mpBoot() {
  const rec = takeResume();
  if (rec && rec.code && rec.token) {
    MP.active = true;
    MP.role = rec.role;
    MP.code = rec.code;
    MP.token = rec.token;
    MP.peerPresent = true;          // we were mid-start; corrected by events if not
    G.demo = false;
    setState(rec.role === 'host' ? 'lobby' : 'joinWait');
    NET.connect()
      .then(() => NET.send({ t: 'resume', code: rec.code, token: rec.token, role: rec.role }))
      .catch(() => mpLeave('CONNECTION FAILED'));
    return;
  }
  const code = new URLSearchParams(location.search).get('join');
  if (code && /^[A-Za-z0-9]{4,8}$/.test(code)) mpGuestBoot(code.toUpperCase());
})();

/* debug hooks for automated testing */
window.__pp = {
  get G() { return G; },
  get frame() { return frame; },
  get acc() { return acc; },
  get lastT() { return last; },
  get hiScores() { return hiScores; },
  get trackRecs() { return trackRecs; },
  get netScores() { return netScores; },
  leaveGameOver,
  keys, kappaAt, posAt, TRACK_LEN, MAX_SPEED, scene, camera, renderer,
  setState, setupRaceGrid, flash, REC,
  mp: {
    enter2P,
    get MP() { return MP; },
    code: () => MP.code,
    forceStart: () => mpRequestStart(),
    lobbySet: (key, val) => {
      MP.config[key] = val;
      NET.send({ t: 'config', config: MP.config });
    },
  },
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
