// Pole Position clone — pseudo-3D road renderer
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const W = canvas.width, H = canvas.height;

// ─── Constants ────────────────────────────────────────────────────────────────
const ROAD_W       = 2000;
const SEG_LEN      = 200;
const CAM_DEPTH    = 0.84;
const DRAW_DIST    = 200;
const TOTAL_SEGS   = 1600;
const PLAYER_X     = 0;
const PLAYER_Z     = CAM_DEPTH * H;
const MAX_SPEED    = 420;
const ACCEL        = 200;
const BRAKE_DECEL  = 400;
const COAST_DECEL  = 80;
const OFF_ROAD_SLW = 0.6;
const STEER_SPEED  = 4.0;
const CENTRIFUGAL  = 0.3;
const LAP_LEN      = TOTAL_SEGS * SEG_LEN;

// ─── Track colours ────────────────────────────────────────────────────────────
const COLS = {
  sky1: '#72c8e8', sky2: '#4aa0d0',
  hill1: '#4a7a38', hill2: '#3d6a2e',
  grass1: '#1a8c1a', grass2: '#177017',
  rumble1: '#cc2200', rumble2: '#eeeeee',
  road1: '#555555', road2: '#444444',
  lane: '#cccccc',
  fog: '#72c8e8',
};

// ─── Input ────────────────────────────────────────────────────────────────────
const keys = {};
window.addEventListener('keydown', e => { keys[e.code] = true; e.preventDefault(); });
window.addEventListener('keyup',   e => { keys[e.code] = false; });

// ─── Segment builder ──────────────────────────────────────────────────────────
function buildTrack() {
  const segs = [];
  function addStraight(n=25)       { for(let i=0;i<n;i++) add(0,0); }
  function addCurve(n,c,h=0)       { for(let i=0;i<n;i++) add(c,h); }
  function add(curve, hill) {
    const idx = segs.length;
    segs.push({
      idx, curve, hill,
      x: 0, y: 0, z: idx * SEG_LEN,
      color: Math.floor(idx/3)%2,
      cars: [],
    });
  }

  addStraight(30);
  addCurve(40,  0.5);
  addCurve(40, -0.7, 30);
  addStraight(25);
  addCurve(30,  0.3, -20);
  addCurve(50, -0.4);
  addStraight(20);
  addCurve(35,  0.8, 15);
  addCurve(35, -0.5, -15);
  addStraight(30);
  addCurve(45,  0.6);
  addStraight(20);
  addCurve(40, -0.9, 20);
  addStraight(25);
  addCurve(30,  0.4);
  addStraight(40);

  // pad to TOTAL_SEGS
  while (segs.length < TOTAL_SEGS) add(0, 0);

  // compute y offsets from hill
  let y = 0;
  segs.forEach(s => { s.startY = y; y += s.hill; s.endY = y; });

  return segs;
}

// ─── Opponents ────────────────────────────────────────────────────────────────
function buildOpponents(segs) {
  const cars = [];
  const palette = ['#e63030','#30a0e6','#e6c030','#30e660','#e630b0','#ff8800'];
  for (let i = 0; i < 12; i++) {
    const c = {
      x:   (Math.random() * 1.6 - 0.8),
      z:   (50 + i * 120) * SEG_LEN,
      spd: 120 + Math.random() * 180,
      col: palette[i % palette.length],
      w:   70, h: 40,
      seg: null,
    };
    c.seg = segs[Math.floor(c.z / SEG_LEN) % segs.length];
    c.seg.cars.push(c);
    cars.push(c);
  }
  return cars;
}

// ─── State ────────────────────────────────────────────────────────────────────
const segs    = buildTrack();
const oppCars = buildOpponents(segs);

let playerX    = 0;
let playerZ    = 0;
let speed      = 0;
let lapTime    = 0;
let bestLap    = Infinity;
let lapCount   = 0;
let lastLapZ   = 0;
let startTime  = null;
let phase      = 'start'; // 'start' | 'race' | 'finish'
let countdown  = 3;
let cdTimer    = 0;

function getSeg(z) {
  return segs[Math.floor(z / SEG_LEN) % segs.length];
}

// ─── Project a 3-D point onto the screen ─────────────────────────────────────
function project(segX, segY, segZ, camX, camY, camZ) {
  const dz  = segZ - camZ;
  if (dz <= 0) return null;
  const scale = CAM_DEPTH / dz;
  const sx    = (W / 2) + scale * (segX - camX) * W / 2;
  const sy    = (H / 2) - scale * (segY - camY) * H / 2;
  const sw    = scale * ROAD_W * W / 2;
  return { scale, x: sx, y: sy, w: sw };
}

// ─── Draw a road segment strip ────────────────────────────────────────────────
function drawSegment(p1, p2, col, fog) {
  if (!p1 || !p2) return;
  const alt = col;
  // grass
  fillRect(0, p2.y, W, p1.y - p2.y, alt ? COLS.grass2 : COLS.grass1, fog);
  // rumble
  fillRect(p2.x - p2.w * 1.12, p2.y, p2.w * 0.24, p1.y - p2.y, alt ? COLS.rumble2 : COLS.rumble1, fog);
  fillRect(p2.x + p2.w * 0.88, p2.y, p2.w * 0.24, p1.y - p2.y, alt ? COLS.rumble2 : COLS.rumble1, fog);
  // road
  trapezoid(p1.x - p1.w, p1.y, p1.x + p1.w, p1.y,
            p2.x - p2.w, p2.y, p2.x + p2.w, p2.y,
            alt ? COLS.road2 : COLS.road1, fog);
  // lane markers
  if (alt) {
    const lw = p1.w * 0.04;
    fillTrap(p1.x - lw/2 - p1.w*0.33, p1.y, p2.x - lw/2 - p2.w*0.33, p2.y,
             lw * (p1.w/p2.w), COLS.lane, fog);
    fillTrap(p1.x - lw/2 + p1.w*0.33, p1.y, p2.x - lw/2 + p2.w*0.33, p2.y,
             lw * (p1.w/p2.w), COLS.lane, fog);
  }
}

function fillRect(x, y, w, h, color, fog) {
  if (h <= 0) return;
  ctx.globalAlpha = 1;
  ctx.fillStyle = fogBlend(color, fog);
  ctx.fillRect(x, y, w, h);
}

function trapezoid(x1l, y1, x1r, _y1, x2l, y2, x2r, _y2, color, fog) {
  ctx.fillStyle = fogBlend(color, fog);
  ctx.beginPath();
  ctx.moveTo(x1l, y1); ctx.lineTo(x1r, y1);
  ctx.lineTo(x2r, y2); ctx.lineTo(x2l, y2);
  ctx.closePath(); ctx.fill();
}

function fillTrap(x1, y1, x2, y2, w, color, fog) {
  ctx.fillStyle = fogBlend(color, fog);
  ctx.beginPath();
  ctx.moveTo(x1,   y1); ctx.lineTo(x1+w, y1);
  ctx.lineTo(x2+w, y2); ctx.lineTo(x2,   y2);
  ctx.closePath(); ctx.fill();
}

function fogBlend(hex, t) {
  if (t <= 0) return hex;
  const a = parseColor(hex), b = parseColor(COLS.fog);
  const r = Math.round(a[0]*(1-t) + b[0]*t);
  const g = Math.round(a[1]*(1-t) + b[1]*t);
  const bl= Math.round(a[2]*(1-t) + b[2]*t);
  return `rgb(${r},${g},${bl})`;
}

const _pcache = {};
function parseColor(hex) {
  if (_pcache[hex]) return _pcache[hex];
  const r = parseInt(hex.slice(1,3),16);
  const g = parseInt(hex.slice(3,5),16);
  const b = parseInt(hex.slice(5,7),16);
  return (_pcache[hex] = [r,g,b]);
}

// ─── Draw a sprite (opponent car) ────────────────────────────────────────────
function drawCar(screenX, screenY, scale, color) {
  const cw = scale * 220 * W;
  const ch = cw * 0.55;
  const cx = screenX - cw / 2;
  const cy = screenY - ch;
  // body
  ctx.fillStyle = color;
  ctx.fillRect(cx, cy + ch*0.35, cw, ch*0.45);
  // cabin
  ctx.fillStyle = '#222';
  ctx.fillRect(cx + cw*0.2, cy + ch*0.1, cw*0.6, ch*0.32);
  // wheels
  ctx.fillStyle = '#111';
  ctx.fillRect(cx,          cy + ch*0.72, cw*0.22, ch*0.28);
  ctx.fillRect(cx+cw*0.78,  cy + ch*0.72, cw*0.22, ch*0.28);
}

// ─── Draw player car (centred, bottom) ────────────────────────────────────────
function drawPlayerCar(steerDir) {
  const cx = W/2, cy = H - 60;
  const cw = 90, ch = 50;
  // tilt slightly when steering
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(steerDir * 0.04);
  // body
  ctx.fillStyle = '#e63030';
  ctx.fillRect(-cw/2, -ch*0.55, cw, ch*0.45);
  // cabin
  ctx.fillStyle = '#1a1a1a';
  ctx.fillRect(-cw*0.3, -ch, cw*0.6, ch*0.5);
  // wheels
  ctx.fillStyle = '#111';
  ctx.fillRect(-cw/2 - 8,  -ch*0.1, 16, 22);
  ctx.fillRect( cw/2 - 8,  -ch*0.1, 16, 22);
  ctx.fillRect(-cw/2 - 8,  -ch*0.7, 14, 18);
  ctx.fillRect( cw/2 - 6,  -ch*0.7, 14, 18);
  ctx.restore();
}

// ─── HUD ──────────────────────────────────────────────────────────────────────
function drawHUD() {
  const spd = Math.round(speed);
  const lt  = lapTime.toFixed(2);
  const bl  = bestLap === Infinity ? '--.-' : bestLap.toFixed(2);

  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillRect(0, 0, W, 36);

  ctx.fillStyle = '#fff';
  ctx.font = 'bold 16px Courier New';
  ctx.fillText(`SPEED: ${spd} km/h`, 12, 22);
  ctx.fillText(`LAP: ${lapCount+1}`, W/2 - 40, 22);
  ctx.fillText(`TIME: ${lt}s`, W - 170, 22);
  ctx.fillText(`BEST: ${bl}s`, W - 170, 22); // overwritten below
  ctx.fillText(`BEST: ${bl}s`, W/2 + 40, 22);
}

function drawOverlay(msg, sub='') {
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  ctx.fillRect(0, H/2 - 60, W, 120);
  ctx.fillStyle = '#ffe600';
  ctx.font = 'bold 40px Courier New';
  ctx.textAlign = 'center';
  ctx.fillText(msg, W/2, H/2 + 6);
  if (sub) {
    ctx.fillStyle = '#fff';
    ctx.font = '18px Courier New';
    ctx.fillText(sub, W/2, H/2 + 34);
  }
  ctx.textAlign = 'left';
}

// ─── Update ───────────────────────────────────────────────────────────────────
let last = 0;
function update(dt) {
  // countdown
  if (phase === 'start') {
    cdTimer += dt;
    if (cdTimer >= 1) { cdTimer = 0; countdown--; }
    if (countdown <= 0) { phase = 'race'; startTime = performance.now(); }
    return;
  }
  if (phase !== 'race') return;

  lapTime = (performance.now() - startTime) / 1000;

  // acceleration / braking
  const accel   = keys['ArrowUp']   || keys['KeyW'];
  const brake   = keys['Space']     || keys['ArrowDown'] || keys['KeyS'];
  const left    = keys['ArrowLeft'] || keys['KeyA'];
  const right   = keys['ArrowRight']|| keys['KeyD'];

  if (accel)       speed = Math.min(speed + ACCEL * dt, MAX_SPEED);
  else if (brake)  speed = Math.max(speed - BRAKE_DECEL * dt, 0);
  else             speed = Math.max(speed - COAST_DECEL * dt, 0);

  const seg = getSeg(playerZ);

  // off-road slowdown
  if (Math.abs(playerX) > 1) speed *= (1 - OFF_ROAD_SLW * dt);

  // steering
  if (left)  playerX -= STEER_SPEED * dt * (speed / MAX_SPEED);
  if (right) playerX += STEER_SPEED * dt * (speed / MAX_SPEED);

  // centrifugal drift
  playerX -= (seg.curve * CENTRIFUGAL * (speed / MAX_SPEED) * dt);

  playerX = Math.max(-2.5, Math.min(2.5, playerX));

  // advance
  playerZ += speed * dt;

  // lap detection
  if (playerZ - lastLapZ >= LAP_LEN) {
    lastLapZ += LAP_LEN;
    if (lapTime < bestLap) bestLap = lapTime;
    lapCount++;
    startTime = performance.now();
    lapTime = 0;
  }

  // move opponents
  oppCars.forEach(c => {
    c.seg.cars = c.seg.cars.filter(x => x !== c);
    c.z += c.spd * dt;
    const si = Math.floor(c.z / SEG_LEN) % segs.length;
    c.seg = segs[si];
    c.seg.cars.push(c);
  });
}

// ─── Render ───────────────────────────────────────────────────────────────────
function render() {
  // sky gradient
  const sky = ctx.createLinearGradient(0, 0, 0, H * 0.42);
  sky.addColorStop(0, COLS.sky1);
  sky.addColorStop(1, COLS.sky2);
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, W, H * 0.42);

  // hills
  ctx.fillStyle = COLS.hill1;
  ctx.fillRect(0, H * 0.35, W, H * 0.07);

  const camX  = playerX;
  const camZ  = playerZ;
  const startSeg = Math.floor(camZ / SEG_LEN) % segs.length;
  let   xOff  = 0;
  let   yOff  = 0;
  let   maxY  = H;

  const projected = [];

  for (let i = 0; i < DRAW_DIST; i++) {
    const si  = (startSeg + i) % segs.length;
    const s   = segs[si];
    const dz  = (i + 1) * SEG_LEN;  // distance ahead of camera
    const fog = Math.min(1, i / DRAW_DIST);

    const p = project(
      s.x * ROAD_W + xOff * ROAD_W,
      s.startY + yOff,
      camZ + dz,
      camX * ROAD_W / 2,
      0, camZ
    );
    xOff += s.curve;
    yOff += s.hill;
    projected.push({ seg: s, p, fog });
  }

  // draw back-to-front
  for (let i = projected.length - 1; i >= 0; i--) {
    const { seg, p, fog } = projected[i];
    const p2 = i < projected.length - 1 ? projected[i+1].p : null;
    if (!p || !p2) continue;
    if (p.y >= maxY) continue;
    maxY = p.y;
    drawSegment(p2, p, seg.color, fog);

    // draw opponent cars on this segment
    seg.cars.forEach(c => {
      const relZ = c.z - camZ;
      if (relZ < 0 || relZ > DRAW_DIST * SEG_LEN) return;
      const cp = project(
        c.x * ROAD_W/2,
        seg.startY,
        camZ + relZ,
        camX * ROAD_W/2,
        0, camZ
      );
      if (cp) drawCar(cp.x, cp.y, cp.scale, c.col);
    });
  }

  // road end fill
  ctx.fillStyle = COLS.road1;
  ctx.fillRect(0, maxY, W, H - maxY);

  // steer direction for player tilt
  const left  = keys['ArrowLeft'] || keys['KeyA'];
  const right = keys['ArrowRight']|| keys['KeyD'];
  drawPlayerCar(right ? 1 : left ? -1 : 0);

  drawHUD();

  if (phase === 'start') {
    drawOverlay(countdown > 0 ? String(countdown) : 'GO!', 'Press UP to accelerate');
  }
}

// ─── Loop ─────────────────────────────────────────────────────────────────────
function loop(ts) {
  const dt = Math.min((ts - last) / 1000, 0.05);
  last = ts;
  update(dt);
  render();
  requestAnimationFrame(loop);
}

requestAnimationFrame(ts => { last = ts; requestAnimationFrame(loop); });
