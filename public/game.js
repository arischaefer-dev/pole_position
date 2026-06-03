// Pole Position clone — pseudo-3D road renderer
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const W = canvas.width, H = canvas.height;

// ─── Constants ────────────────────────────────────────────────────────────────
const ROAD_W       = 2000;
const SEG_LEN      = 200;
const CAM_DEPTH    = 0.84;
const CAM_HEIGHT   = SEG_LEN / CAM_DEPTH;  // ≈238 world units — sets perspective
const DRAW_DIST    = 120;
const TOTAL_SEGS   = 1600;
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
  function add(curve, hill) {
    const idx = segs.length;
    segs.push({ idx, curve, hill, x: 0, z: idx * SEG_LEN, color: Math.floor(idx/3)%2, cars: [] });
  }
  function straight(n=25)        { for(let i=0;i<n;i++) add(0,0); }
  function curve(n,c,h=0)        { for(let i=0;i<n;i++) add(c,h); }

  straight(30);
  curve(40,  0.5);
  curve(40, -0.7, 30);
  straight(25);
  curve(30,  0.3, -20);
  curve(50, -0.4);
  straight(20);
  curve(35,  0.8, 15);
  curve(35, -0.5, -15);
  straight(30);
  curve(45,  0.6);
  straight(20);
  curve(40, -0.9, 20);
  straight(25);
  curve(30,  0.4);
  straight(40);

  while (segs.length < TOTAL_SEGS) add(0, 0);

  let y = 0;
  segs.forEach(s => { s.startY = y; y += s.hill; s.endY = y; });
  return segs;
}

// ─── Opponents ────────────────────────────────────────────────────────────────
function buildOpponents(segs) {
  const palette = ['#e63030','#30a0e6','#e6c030','#30e660','#e630b0','#ff8800'];
  return Array.from({length: 12}, (_, i) => {
    const c = {
      x:   (Math.random() * 1.4 - 0.7),
      z:   (60 + i * 110) * SEG_LEN,
      spd: 120 + Math.random() * 160,
      col: palette[i % palette.length],
    };
    return c;
  });
}

const segs    = buildTrack();
const oppCars = buildOpponents(segs);

let playerX   = 0;
let playerZ   = 0;
let speed     = 0;
let lapTime   = 0;
let bestLap   = Infinity;
let lapCount  = 0;
let lastLapZ  = 0;
let startTime = null;
let phase     = 'start';
let countdown = 3;
let cdTimer   = 0;
let steerDir  = 0;

function getSeg(z) {
  return segs[Math.floor(z / SEG_LEN) % segs.length];
}

// ─── Project world point onto screen ─────────────────────────────────────────
function project(worldX, worldY, worldZ, camX, camY, camZ) {
  const dz = worldZ - camZ;
  if (dz <= 0) return null;
  const scale = CAM_DEPTH / dz;
  return {
    scale,
    x: (W / 2) + scale * (worldX - camX) * W / 2,
    y: (H / 2) - scale * (worldY - camY) * H / 2,
    w: scale * ROAD_W * W / 2,
  };
}

// ─── Draw one road strip (p_near = bottom/wide, p_far = top/narrow) ──────────
function drawSegment(p_near, p_far, alt, fog) {
  if (!p_near || !p_far) return;
  const y1 = Math.round(p_far.y);   // top of strip (smaller y)
  const y2 = Math.round(p_near.y);  // bottom of strip (larger y)
  if (y2 <= y1) return;

  // grass — full-width band
  ctx.fillStyle = fogBlend(alt ? COLS.grass2 : COLS.grass1, fog);
  ctx.fillRect(0, y1, W, y2 - y1);

  // left rumble trapezoid
  fillTrap4(
    p_far.x  - p_far.w  * 1.12, y1,
    p_far.x  - p_far.w  * 0.88, y1,
    p_near.x - p_near.w * 0.88, y2,
    p_near.x - p_near.w * 1.12, y2,
    alt ? COLS.rumble2 : COLS.rumble1, fog
  );
  // right rumble trapezoid
  fillTrap4(
    p_far.x  + p_far.w  * 0.88, y1,
    p_far.x  + p_far.w  * 1.12, y1,
    p_near.x + p_near.w * 1.12, y2,
    p_near.x + p_near.w * 0.88, y2,
    alt ? COLS.rumble2 : COLS.rumble1, fog
  );
  // road surface
  fillTrap4(
    p_far.x  - p_far.w,  y1,
    p_far.x  + p_far.w,  y1,
    p_near.x + p_near.w, y2,
    p_near.x - p_near.w, y2,
    alt ? COLS.road2 : COLS.road1, fog
  );
  // lane markers (alternating)
  if (alt) {
    const lw1 = p_far.w  * 0.04;
    const lw2 = p_near.w * 0.04;
    // left lane line
    fillTrap4(
      p_far.x  - lw1/2 - p_far.w  * 0.33, y1,
      p_far.x  + lw1/2 - p_far.w  * 0.33, y1,
      p_near.x + lw2/2 - p_near.w * 0.33, y2,
      p_near.x - lw2/2 - p_near.w * 0.33, y2,
      COLS.lane, fog
    );
    // right lane line
    fillTrap4(
      p_far.x  - lw1/2 + p_far.w  * 0.33, y1,
      p_far.x  + lw1/2 + p_far.w  * 0.33, y1,
      p_near.x + lw2/2 + p_near.w * 0.33, y2,
      p_near.x - lw2/2 + p_near.w * 0.33, y2,
      COLS.lane, fog
    );
  }
}

function fillTrap4(x1, y1, x2, _y1, x3, y2, x4, _y2, color, fog) {
  ctx.fillStyle = fogBlend(color, fog);
  ctx.beginPath();
  ctx.moveTo(x1, y1); ctx.lineTo(x2, y1);
  ctx.lineTo(x3, y2); ctx.lineTo(x4, y2);
  ctx.closePath();
  ctx.fill();
}

function fogBlend(hex, t) {
  if (t <= 0) return hex;
  const a = parseColor(hex), b = parseColor(COLS.fog);
  return `rgb(${Math.round(a[0]*(1-t)+b[0]*t)},${Math.round(a[1]*(1-t)+b[1]*t)},${Math.round(a[2]*(1-t)+b[2]*t)})`;
}
const _pc = {};
function parseColor(h) {
  return _pc[h] || (_pc[h] = [parseInt(h.slice(1,3),16), parseInt(h.slice(3,5),16), parseInt(h.slice(5,7),16)]);
}

// ─── Draw a sprite car ────────────────────────────────────────────────────────
function drawCar(sx, sy, scale, color) {
  const cw = scale * 180 * W;
  const ch = cw * 0.55;
  const cx = sx - cw / 2, cy = sy - ch;
  ctx.fillStyle = color;
  ctx.fillRect(cx, cy + ch*0.35, cw, ch*0.45);
  ctx.fillStyle = '#222';
  ctx.fillRect(cx + cw*0.2, cy + ch*0.1, cw*0.6, ch*0.3);
  ctx.fillStyle = '#111';
  ctx.fillRect(cx,         cy + ch*0.72, cw*0.22, ch*0.28);
  ctx.fillRect(cx+cw*0.78, cy + ch*0.72, cw*0.22, ch*0.28);
}

function drawPlayerCar() {
  const cx = W/2, cy = H - 58;
  const cw = 88, ch = 48;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(steerDir * 0.04);
  ctx.fillStyle = '#e63030';
  ctx.fillRect(-cw/2, -ch*0.55, cw, ch*0.45);
  ctx.fillStyle = '#1a1a1a';
  ctx.fillRect(-cw*0.3, -ch, cw*0.6, ch*0.48);
  ctx.fillStyle = '#111';
  ctx.fillRect(-cw/2 - 8, -ch*0.1, 16, 22);
  ctx.fillRect( cw/2 - 8, -ch*0.1, 16, 22);
  ctx.fillRect(-cw/2 - 8, -ch*0.68, 14, 18);
  ctx.fillRect( cw/2 - 6, -ch*0.68, 14, 18);
  ctx.restore();
}

// ─── HUD ──────────────────────────────────────────────────────────────────────
function drawHUD() {
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillRect(0, 0, W, 36);
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 16px Courier New';
  ctx.fillText(`SPEED: ${Math.round(speed)} km/h`, 12, 22);
  ctx.fillText(`LAP: ${lapCount+1}`,              W/2 - 36, 22);
  ctx.fillText(`TIME: ${lapTime.toFixed(2)}s`,    W - 230, 22);
  ctx.fillText(`BEST: ${bestLap === Infinity ? '--.-' : bestLap.toFixed(2)}s`, W - 110, 22);
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
  if (phase === 'start') {
    cdTimer += dt;
    if (cdTimer >= 1) { cdTimer = 0; countdown--; }
    if (countdown <= 0) { phase = 'race'; startTime = performance.now(); }
    return;
  }
  if (phase !== 'race') return;

  lapTime = (performance.now() - startTime) / 1000;

  const accel = keys['ArrowUp']    || keys['KeyW'];
  const brake = keys['Space']      || keys['ArrowDown'] || keys['KeyS'];
  const left  = keys['ArrowLeft']  || keys['KeyA'];
  const right = keys['ArrowRight'] || keys['KeyD'];

  steerDir = right ? 1 : left ? -1 : 0;

  if (accel)      speed = Math.min(speed + ACCEL * dt, MAX_SPEED);
  else if (brake) speed = Math.max(speed - BRAKE_DECEL * dt, 0);
  else            speed = Math.max(speed - COAST_DECEL * dt, 0);

  const seg = getSeg(playerZ);
  if (Math.abs(playerX) > 1) speed *= (1 - OFF_ROAD_SLW * dt);

  if (left)  playerX -= STEER_SPEED * dt * (speed / MAX_SPEED);
  if (right) playerX += STEER_SPEED * dt * (speed / MAX_SPEED);

  playerX -= seg.curve * CENTRIFUGAL * (speed / MAX_SPEED) * dt;
  playerX  = Math.max(-2.5, Math.min(2.5, playerX));
  playerZ += speed * dt;

  if (playerZ - lastLapZ >= LAP_LEN) {
    lastLapZ += LAP_LEN;
    if (lapTime < bestLap) bestLap = lapTime;
    lapCount++;
    startTime = performance.now();
    lapTime = 0;
  }

  oppCars.forEach(c => {
    c.z += c.spd * dt;
  });
}

// ─── Render ───────────────────────────────────────────────────────────────────
function render() {
  // Sky
  const sky = ctx.createLinearGradient(0, 0, 0, H * 0.5);
  sky.addColorStop(0, COLS.sky1); sky.addColorStop(1, COLS.sky2);
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, W, H * 0.5);

  // Hills strip just above the horizon
  ctx.fillStyle = COLS.hill1;
  ctx.fillRect(0, H * 0.38, W, H * 0.12);

  const camX  = playerX;
  const camZ  = playerZ;
  const startIdx = Math.floor(camZ / SEG_LEN) % segs.length;

  // Project all visible segments, accumulating curve/hill offsets
  let xOff = 0, yOff = 0;
  const proj = [];
  for (let i = 0; i < DRAW_DIST; i++) {
    const si  = (startIdx + i) % segs.length;
    const s   = segs[si];
    const dz  = (i + 1) * SEG_LEN;
    const fog = Math.min(1, (i / (DRAW_DIST * 0.8)) ** 1.5);

    const p = project(
      xOff * ROAD_W,          // road centre in world X (curve offset)
      s.startY + yOff,        // road height (hill offset)
      camZ + dz,
      camX * ROAD_W / 2,
      CAM_HEIGHT,             // camera height above ground → perspective
      camZ
    );
    proj.push({ seg: s, p, fog, xOff, yOff });
    xOff += s.curve;
    yOff += s.hill;
  }

  // Render back-to-front: painter's algorithm, no horizon clip needed
  for (let i = proj.length - 1; i >= 0; i--) {
    const { seg, p, fog } = proj[i];
    if (!p) continue;

    // Each strip spans from segment i (near/bottom) to segment i+1 (far/top)
    const pNear = p;
    const pFar  = i < proj.length - 1 ? proj[i+1].p : null;
    if (!pFar) continue;

    drawSegment(pNear, pFar, seg.color, fog);

    // Opponent cars on this segment
    const { xOff: sxOff, yOff: syOff } = proj[i];
    seg.cars && oppCars.forEach(c => {
      const cSegZ = c.z % LAP_LEN;
      const camNZ = camZ % LAP_LEN;
      let relZ = cSegZ - camNZ;
      if (relZ < 0) relZ += LAP_LEN;
      if (relZ <= 0 || relZ > DRAW_DIST * SEG_LEN) return;

      const cSeg = segs[Math.floor(c.z / SEG_LEN) % segs.length];
      if (cSeg !== seg) return;

      const cp = project(
        c.x * ROAD_W/2 + sxOff * ROAD_W,
        seg.startY + syOff,
        camZ + relZ,
        camX * ROAD_W / 2,
        CAM_HEIGHT,
        camZ
      );
      if (cp && cp.y > 36 && cp.y < H) drawCar(cp.x, cp.y, cp.scale, c.col);
    });
  }

  drawPlayerCar();
  drawHUD();

  if (phase === 'start') {
    drawOverlay(countdown > 0 ? String(countdown) : 'GO!', 'Press UP/W to accelerate');
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
