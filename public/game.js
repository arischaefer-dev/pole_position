// Pole Position — complete rewrite v3
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const W = canvas.width, H = canvas.height;

// ─── Constants ────────────────────────────────────────────────────────────────
const ROAD_W      = 2000;
const SEG_LEN     = 200;
const CAM_DEPTH   = 0.84;
const CAM_H       = SEG_LEN / CAM_DEPTH;
const DRAW_DIST   = 150;
const TOTAL_SEGS  = 600;
const LAP_LEN     = TOTAL_SEGS * SEG_LEN;

// Speed in world-units/s; divide by 10 for MPH display
const MAX_SPD_LO  = 1440;
const MAX_SPD_HI  = 1950;
const ACCEL_R     = 700;
const BRAKE_R     = 2500;
const COAST_R     = 500;
const STEER_R     = 3.8;
const CENTRIFUGAL = 0.28;
const OFFROAD_SLW = 0.55;

const COLS = {
  skyT:'#1255a0', skyB:'#7bbfe0',
  hill:'#2d6e0f', hillF:'#3d8a1e',
  grass1:'#5cb800', grass2:'#4ea000',
  road1:'#3a3a3a', road2:'#303030',
  rumR:'#cc1111', rumW:'#dddddd',
  lane:'#cccccc', fog:'#7bbfe0',
};

// ─── Input ────────────────────────────────────────────────────────────────────
const keys = {}, pressed = {};
window.addEventListener('keydown', e => {
  if (!keys[e.code]) pressed[e.code] = true;
  keys[e.code] = true; e.preventDefault();
});
window.addEventListener('keyup', e => { keys[e.code] = false; });

// ─── Track ────────────────────────────────────────────────────────────────────
function buildTrack() {
  const segs = [];
  function add(curve, hill, n) {
    for (let i = 0; i < n; i++) {
      const idx = segs.length;
      segs.push({ idx, curve, hill, startY:0, endY:0,
                  color: Math.floor(idx/3)%2, sprites:[], isStart: idx===0 });
    }
  }
  add( 0.00,  0, 55); // long front straight
  add( 0.50,  0, 18); // gentle right
  add( 0.90,  0, 28); // right curve
  add(-0.40,  4, 14); // left kink + rise
  add(-0.95,  0, 22); // tight left hairpin
  add( 0.10, -5, 16); // exit, slight dip
  add( 0.00,  0, 28); // back straight
  add( 0.50,  0, 20); // right sweeper
  add( 0.00,  0, 18); // straight
  add(-0.70,  4, 24); // left + hill
  add(-0.30,  0, 14); // easy left
  add( 0.00,  0, 28); // straight
  add( 0.55,  0, 18); // right onto home straight
  add( 0.00,  0, 35); // home straight back to S/F
  while (segs.length < TOTAL_SEGS) add(0, 0, 1);
  let y = 0;
  segs.forEach(s => { s.startY = y; y += s.hill; s.endY = y; });
  return segs;
}

// ─── Sprites ──────────────────────────────────────────────────────────────────
const SP = { BILLBOARD:0, PYLON:1, TREE:2, CROWD:3 };
const BB_TEXT = ['PEPSI','CANON','FUJI FILM','7-ELEVEN','DENTYNE','MARLBORO'];
const BB_COLS = [
  ['#003087','#e3001b'],['#cc0000','#ffffff'],['#ff5500','#ffffff'],
  ['#007547','#ff3300'],['#aa1100','#ffffff'],['#cc0000','#ffffff'],
];

function placeSprites(segs) {
  // Billboards
  [40,80,130,185,255,320,400,475,545].forEach((si, i) => {
    if (si >= segs.length) return;
    segs[si].sprites.push({ type:SP.BILLBOARD, side: i%2===0?1:-1, worldOff:1.4, bi: i%BB_TEXT.length });
    if (i%3===0 && si+3 < segs.length)
      segs[si+3].sprites.push({ type:SP.BILLBOARD, side: i%2===0?-1:1, worldOff:1.6, bi:(i+4)%BB_TEXT.length });
  });
  // Pylons every 4 segs
  for (let i=2; i<segs.length; i+=4) {
    segs[i].sprites.push({ type:SP.PYLON, side: 1, worldOff:1.04 });
    segs[i].sprites.push({ type:SP.PYLON, side:-1, worldOff:1.04 });
  }
  // Trees
  for (let i=8; i<segs.length; i+=11) {
    segs[i].sprites.push({ type:SP.TREE, side: Math.random()<0.5?1:-1, worldOff: 2.0+Math.random()*0.8 });
    if (i+5<segs.length)
      segs[i+5].sprites.push({ type:SP.TREE, side: Math.random()<0.5?1:-1, worldOff: 2.3+Math.random() });
  }
  // Crowd/grandstand: start from seg 6 so they appear mid-distance at race start
  for (let i=6; i<30; i+=2) {
    segs[i].sprites.push({ type:SP.CROWD, side: 1, worldOff:1.2 });
    segs[i].sprites.push({ type:SP.CROWD, side:-1, worldOff:1.2 });
  }
}

// ─── Projection ───────────────────────────────────────────────────────────────
function project(wx, wy, wz, cx, cy, cz) {
  const dz = wz - cz;
  if (dz <= 0) return null;
  const s = CAM_DEPTH / dz;
  return { scale:s, x: W/2 + s*(wx-cx)*W/2, y: H/2 - s*(wy-cy)*H/2, w: s*ROAD_W*W/2 };
}

// ─── Fog ──────────────────────────────────────────────────────────────────────
const _pc={};
function pc(h){ return _pc[h]||(_pc[h]=[parseInt(h.slice(1,3),16),parseInt(h.slice(3,5),16),parseInt(h.slice(5,7),16)]); }
function fog(hex,t){ if(t<=0)return hex; const a=pc(hex),b=pc(COLS.fog); return `rgb(${~~(a[0]*(1-t)+b[0]*t)},${~~(a[1]*(1-t)+b[1]*t)},${~~(a[2]*(1-t)+b[2]*t)})`; }

// ─── Road Strip ───────────────────────────────────────────────────────────────
function fillTrap(x1,y1,x2,y2,w1,w2,col) {
  ctx.fillStyle=col;
  ctx.beginPath();
  ctx.moveTo(x1,y1); ctx.lineTo(x1+w1,y1);
  ctx.lineTo(x2+w2,y2); ctx.lineTo(x2,y2);
  ctx.closePath(); ctx.fill();
}

function drawStrip(pN, pF, seg, f) {
  const y1=Math.round(pF.y), y2=Math.round(pN.y);
  if (y2<=y1) return;
  const alt = seg.color;

  // Grass full-width
  ctx.fillStyle = fog(alt?COLS.grass2:COLS.grass1, f);
  ctx.fillRect(0, y1, W, y2-y1);

  // Outer rumble
  fillTrap(pF.x-pF.w*1.18,y1, pN.x-pN.w*1.18,y2, pF.w*0.18,pN.w*0.18, fog(alt?COLS.rumW:COLS.rumR,f));
  fillTrap(pF.x+pF.w*1.00,y1, pN.x+pN.w*1.00,y2, pF.w*0.18,pN.w*0.18, fog(alt?COLS.rumW:COLS.rumR,f));

  if (seg.isStart) {
    // Checkered start/finish
    const CELLS=14;
    for (let c=0;c<CELLS;c++) {
      const t1=c/CELLS, t2=(c+1)/CELLS;
      ctx.fillStyle = fog(c%2===0?'#ffffff':'#111111', f);
      ctx.beginPath();
      ctx.moveTo(pF.x-pF.w+t1*pF.w*2, y1);
      ctx.lineTo(pF.x-pF.w+t2*pF.w*2, y1);
      ctx.lineTo(pN.x-pN.w+t2*pN.w*2, y2);
      ctx.lineTo(pN.x-pN.w+t1*pN.w*2, y2);
      ctx.closePath(); ctx.fill();
    }
  } else {
    // Road surface
    fillTrap(pF.x-pF.w,y1, pN.x-pN.w,y2, pF.w*2,pN.w*2, fog(alt?COLS.road2:COLS.road1,f));
  }

  // Inner rumble (road edge)
  fillTrap(pF.x-pF.w,y1, pN.x-pN.w,y2, pF.w*0.05,pN.w*0.05, fog(alt?COLS.rumW:COLS.rumR,f));
  fillTrap(pF.x+pF.w*0.95,y1, pN.x+pN.w*0.95,y2, pF.w*0.05,pN.w*0.05, fog(alt?COLS.rumW:COLS.rumR,f));

  // Center dashes
  if (alt) {
    fillTrap(pF.x-pF.w*0.02,y1, pN.x-pN.w*0.02,y2, pF.w*0.04,pN.w*0.04, fog(COLS.lane,f));
  }
}

// ─── Sprite Drawers ───────────────────────────────────────────────────────────
function drawBillboard(sx, sy, rw, bi) {
  const bw = rw * 1.4;
  if (bw > W*0.7 || bw < 4) return;   // skip if too close or too far
  const bh = bw*0.44, ph = bh*1.5, pw = Math.max(3, bw*0.05);
  const [bg, fg] = BB_COLS[bi];
  ctx.fillStyle='#666'; ctx.fillRect(sx-pw/2, sy-ph, pw, ph);
  ctx.fillStyle='rgba(0,0,0,0.25)'; ctx.fillRect(sx-bw/2+3, sy-ph-bh+3, bw, bh);
  ctx.fillStyle=bg; ctx.fillRect(sx-bw/2, sy-ph-bh, bw, bh);
  const bd=Math.max(2,bw*0.035);
  ctx.fillStyle='#fff';
  ctx.fillRect(sx-bw/2,sy-ph-bh,bw,bd); ctx.fillRect(sx-bw/2,sy-ph-bd,bw,bd);
  ctx.fillRect(sx-bw/2,sy-ph-bh,bd,bh); ctx.fillRect(sx+bw/2-bd,sy-ph-bh,bd,bh);
  ctx.fillStyle=fg; ctx.font=`bold ${Math.max(7,~~(bh*0.48))}px Arial`;
  ctx.textAlign='center'; ctx.fillText(BB_TEXT[bi], sx, sy-ph-bh*0.27); ctx.textAlign='left';
}

function drawPylon(sx, sy, rw) {
  const pw=Math.max(4,rw*0.06), ph=pw*2.8;
  ctx.fillStyle='#ccc'; ctx.fillRect(sx-pw*0.9,sy-ph*0.15,pw*1.8,ph*0.15);
  for (let b=0;b<4;b++) {
    const t=b/4, t2=(b+1)/4;
    ctx.fillStyle = b%2===0?'#ff6600':'#ffffff';
    ctx.beginPath();
    ctx.moveTo(sx-pw*(1-t)*0.5,sy-ph*t); ctx.lineTo(sx+pw*(1-t)*0.5,sy-ph*t);
    ctx.lineTo(sx+pw*(1-t2)*0.5,sy-ph*t2); ctx.lineTo(sx-pw*(1-t2)*0.5,sy-ph*t2);
    ctx.closePath(); ctx.fill();
  }
}

function drawTree(sx, sy, rw) {
  const tw=rw*0.7, th=tw*1.8; if(tw<4) return;
  ctx.fillStyle='#5a3010'; ctx.fillRect(sx-tw*0.1,sy-th*0.45,tw*0.2,th*0.45);
  [[1.0,0.42],[0.75,0.68],[0.52,0.88]].forEach(([w,h])=>{
    ctx.fillStyle='#256800';
    ctx.beginPath(); ctx.moveTo(sx,sy-th*h-tw*w*0.45); ctx.lineTo(sx-tw*w/2,sy-th*(h-0.25)); ctx.lineTo(sx+tw*w/2,sy-th*(h-0.25)); ctx.closePath(); ctx.fill();
    ctx.fillStyle='#2f8000';
    ctx.beginPath(); ctx.moveTo(sx,sy-th*h-tw*w*0.35); ctx.lineTo(sx-tw*w*0.38,sy-th*(h-0.18)); ctx.lineTo(sx+tw*w*0.38,sy-th*(h-0.18)); ctx.closePath(); ctx.fill();
  });
}

function drawCrowd(sx, sy, rw) {
  // Only draw crowd at mid-range; too close looks wrong
  if (rw > W*0.09 || rw < 0.5) return;
  const cw=Math.min(rw*1.5, W*0.22), ch=cw*0.75;
  if(cw<8 || sy<46 || sy>H+20) return;
  ctx.save();
  ctx.beginPath(); ctx.rect(sx-cw/2, sy-ch, cw, ch); ctx.clip();
  ctx.fillStyle='#888'; ctx.fillRect(sx-cw/2,sy-ch,cw,ch);
  // tiered seating rows
  for(let r=0;r<5;r++){
    const ry=sy-ch*(0.15+r*0.17);
    ctx.fillStyle=r%2===0?'#777':'#888';
    ctx.fillRect(sx-cw/2, ry-ch*0.08, cw, ch*0.08);
    for(let c=0;c<12;c++){
      ctx.fillStyle=['#f00','#00f','#ff0','#0a0','#fff','#f80','#f0f','#0ff'][(r*7+c)%8];
      const cs=Math.max(2,Math.min(cw*0.06,8));
      ctx.fillRect(sx-cw/2+(c/11)*cw*0.9+cw*0.05-cs/2, ry-cs*0.8, cs, cs*0.9);
    }
  }
  ctx.restore();
}

function drawOppCar(sx, sy, rw, color) {
  const cw=rw*0.9, ch=cw*0.62; if(cw<6) return;
  // rear wing
  ctx.fillStyle=color; ctx.fillRect(sx-cw*0.44,sy-ch*0.92,cw*0.88,ch*0.1);
  ctx.fillRect(sx-cw*0.46,sy-ch*0.98,cw*0.07,ch*0.12); ctx.fillRect(sx+cw*0.39,sy-ch*0.98,cw*0.07,ch*0.12);
  // rear tires
  ctx.fillStyle='#111';
  ctx.fillRect(sx-cw*0.47,sy-ch*0.55,cw*0.13,ch*0.44); ctx.fillRect(sx+cw*0.34,sy-ch*0.55,cw*0.13,ch*0.44);
  ctx.fillStyle='#999'; ctx.beginPath(); ctx.arc(sx-cw*0.41,sy-ch*0.33,cw*0.04,0,Math.PI*2); ctx.fill();
  ctx.beginPath(); ctx.arc(sx+cw*0.41,sy-ch*0.33,cw*0.04,0,Math.PI*2); ctx.fill();
  // body
  ctx.fillStyle=color;
  ctx.beginPath(); ctx.moveTo(sx-cw*0.28,sy-ch*0.78); ctx.lineTo(sx+cw*0.28,sy-ch*0.78);
  ctx.lineTo(sx+cw*0.26,sy-ch*0.22); ctx.lineTo(sx-cw*0.26,sy-ch*0.22); ctx.closePath(); ctx.fill();
  // sidepods
  ctx.fillRect(sx-cw*0.46,sy-ch*0.68,cw*0.17,ch*0.38); ctx.fillRect(sx+cw*0.29,sy-ch*0.68,cw*0.17,ch*0.38);
  // cockpit
  ctx.fillStyle='#1a1a1a'; ctx.beginPath(); ctx.ellipse(sx,sy-ch*0.7,cw*0.09,ch*0.1,0,0,Math.PI*2); ctx.fill();
  // front wing
  ctx.fillStyle=color; ctx.fillRect(sx-cw*0.4,sy-ch*0.18,cw*0.8,ch*0.09);
  ctx.fillRect(sx-cw*0.42,sy-ch*0.24,cw*0.06,ch*0.14); ctx.fillRect(sx+cw*0.36,sy-ch*0.24,cw*0.06,ch*0.14);
}

// ─── Player Car ───────────────────────────────────────────────────────────────
function drawPlayerCar(sd) {
  const cx=W/2, cy=H-88;
  ctx.save(); ctx.translate(cx,cy); ctx.rotate(sd*0.06);
  // shadow
  ctx.fillStyle='rgba(0,0,0,0.28)'; ctx.beginPath(); ctx.ellipse(2,18,52,10,0,0,Math.PI*2); ctx.fill();
  // rear wing
  ctx.fillStyle='#cc0000'; ctx.fillRect(-56,-50,112,9); ctx.fillRect(-59,-57,9,14); ctx.fillRect(50,-57,9,14);
  ctx.fillStyle='#990000'; ctx.fillRect(-59,-57,9,6); ctx.fillRect(50,-57,9,6);
  // rear tires
  ctx.fillStyle='#111'; ctx.fillRect(-53,-38,20,38); ctx.fillRect(33,-38,20,38);
  ctx.fillStyle='#333'; ctx.fillRect(-53,-36,3,34); ctx.fillRect(50,-36,3,34);
  ctx.fillStyle='#bbb'; ctx.beginPath(); ctx.arc(-43,-19,9,0,Math.PI*2); ctx.fill();
  ctx.beginPath(); ctx.arc(43,-19,9,0,Math.PI*2); ctx.fill();
  ctx.fillStyle='#777'; ctx.beginPath(); ctx.arc(-43,-19,4,0,Math.PI*2); ctx.fill();
  ctx.beginPath(); ctx.arc(43,-19,4,0,Math.PI*2); ctx.fill();
  // engine cover
  ctx.fillStyle='#cc0000';
  ctx.beginPath(); ctx.moveTo(-21,-44); ctx.lineTo(21,-44); ctx.lineTo(27,4); ctx.lineTo(-27,4); ctx.closePath(); ctx.fill();
  ctx.fillStyle='#aa0000';
  ctx.beginPath(); ctx.moveTo(-9,-38); ctx.lineTo(9,-38); ctx.lineTo(7,3); ctx.lineTo(-7,3); ctx.closePath(); ctx.fill();
  // sidepods
  ctx.fillStyle='#cc0000'; ctx.fillRect(-45,-30,18,33); ctx.fillRect(27,-30,18,33);
  ctx.fillStyle='#880000'; ctx.fillRect(-44,-24,10,15); ctx.fillRect(34,-24,10,15);
  // cockpit surround
  ctx.fillStyle='#cc0000';
  ctx.beginPath(); ctx.moveTo(-17,-33); ctx.lineTo(17,-33); ctx.lineTo(13,-10); ctx.lineTo(-13,-10); ctx.closePath(); ctx.fill();
  ctx.fillStyle='#0d0d0d';
  ctx.beginPath(); ctx.moveTo(-13,-30); ctx.lineTo(13,-30); ctx.lineTo(10,-12); ctx.lineTo(-10,-12); ctx.closePath(); ctx.fill();
  // helmet
  ctx.fillStyle='#ffd700'; ctx.beginPath(); ctx.arc(0,-26,9,0,Math.PI*2); ctx.fill();
  ctx.fillStyle='#0033bb'; ctx.beginPath(); ctx.arc(0,-24,7,Math.PI*0.08,Math.PI*0.92); ctx.fill();
  ctx.fillStyle='rgba(255,255,255,0.35)'; ctx.beginPath(); ctx.arc(-3,-29,4,0,Math.PI*2); ctx.fill();
  // front wing
  ctx.fillStyle='#cc0000'; ctx.fillRect(-51,5,102,8);
  ctx.fillRect(-53,2,8,12); ctx.fillRect(45,2,8,12);
  ctx.fillStyle='#aa0000';
  ctx.beginPath(); ctx.moveTo(-9,-10); ctx.lineTo(9,-10); ctx.lineTo(7,5); ctx.lineTo(-7,5); ctx.closePath(); ctx.fill();
  // front tires
  ctx.fillStyle='#111'; ctx.fillRect(-53,10,14,18); ctx.fillRect(39,10,14,18);
  ctx.fillStyle='#bbb'; ctx.beginPath(); ctx.arc(-46,19,5,0,Math.PI*2); ctx.fill();
  ctx.beginPath(); ctx.arc(46,19,5,0,Math.PI*2); ctx.fill();
  ctx.restore();
}

// ─── Background ───────────────────────────────────────────────────────────────
function drawBackground(hx) {
  const sg=ctx.createLinearGradient(0,0,0,H*0.5);
  sg.addColorStop(0,'#1255a0'); sg.addColorStop(0.65,'#4a9fd4'); sg.addColorStop(1,'#7bbfe0');
  ctx.fillStyle=sg; ctx.fillRect(0,0,W,H*0.5);
  // distant mountains
  const mx = hx*0.06;
  ctx.fillStyle='#6a8fa8';
  ctx.beginPath();
  ctx.moveTo(0+mx,H*0.5); ctx.lineTo(0+mx,H*0.38); ctx.lineTo(70+mx,H*0.27); ctx.lineTo(160+mx,H*0.34);
  ctx.lineTo(250+mx,H*0.22); ctx.lineTo(370+mx,H*0.30); ctx.lineTo(490+mx,H*0.19);
  ctx.lineTo(600+mx,H*0.31); ctx.lineTo(680+mx,H*0.38); ctx.lineTo(680+mx,H*0.5);
  ctx.closePath(); ctx.fill();
  // Mt. Fuji
  const fjx=W/2+mx*0.4;
  ctx.fillStyle='#8aafcc';
  ctx.beginPath(); ctx.moveTo(fjx-115,H*0.45); ctx.lineTo(fjx,H*0.10); ctx.lineTo(fjx+115,H*0.45); ctx.closePath(); ctx.fill();
  ctx.fillStyle='#d4e8f0';
  ctx.beginPath(); ctx.moveTo(fjx,H*0.10); ctx.lineTo(fjx-30,H*0.23); ctx.lineTo(fjx+30,H*0.23); ctx.closePath(); ctx.fill();
  ctx.fillStyle='#ffffff';
  ctx.beginPath(); ctx.moveTo(fjx,H*0.10); ctx.lineTo(fjx-14,H*0.18); ctx.lineTo(fjx+14,H*0.18); ctx.closePath(); ctx.fill();
  // foreground hills
  ctx.fillStyle=COLS.hill; ctx.fillRect(0,H*0.42,W,H*0.085);
  ctx.fillStyle=COLS.hillF; ctx.fillRect(0,H*0.465,W,H*0.035);
}

// ─── HUD ──────────────────────────────────────────────────────────────────────
function drawHUD(spd, gear, lapTime, bestLap, lapN, score) {
  ctx.fillStyle='rgba(0,0,0,0.72)'; ctx.fillRect(0,0,W,46);
  const mph=~~(spd/10);
  // Speed big
  ctx.fillStyle='#ffffff'; ctx.font='bold 30px Courier New'; ctx.fillText(`${mph}`,14,34);
  ctx.fillStyle='#aaa'; ctx.font='bold 12px Courier New'; ctx.fillText('MPH', 14+(mph>=100?56:mph>=10?40:22), 34);
  // Gear
  ctx.fillStyle=gear==='HI'?'#ff4444':'#44ff44'; ctx.font='bold 20px Courier New'; ctx.fillText(gear,W-62,30);
  ctx.fillStyle='#aaa'; ctx.font='11px Courier New'; ctx.fillText('GEAR',W-62,43);
  // Lap
  ctx.fillStyle='#fff'; ctx.font='bold 14px Courier New'; ctx.fillText(`LAP ${lapN}`,W/2-30,18);
  // Time
  ctx.fillStyle='#ffff55'; ctx.font='13px Courier New'; ctx.fillText(`TIME ${lapTime.toFixed(2)}`,W/2-40,36);
  // Best
  ctx.fillStyle='#55ff88'; ctx.font='12px Courier New'; ctx.fillText(`BEST ${bestLap===Infinity?'--.-':bestLap.toFixed(2)}`,W-185,18);
  // Score
  ctx.fillStyle='#fff'; ctx.fillText(`${score} PTS`,W-185,34);
}

function drawOverlay(msg, sub) {
  ctx.fillStyle='rgba(0,0,0,0.62)'; ctx.fillRect(0,H/2-68,W,128);
  ctx.fillStyle='#ffe600'; ctx.font='bold 46px Courier New'; ctx.textAlign='center';
  ctx.fillText(msg,W/2,H/2+8);
  if (sub) { ctx.fillStyle='#ccc'; ctx.font='15px Courier New'; ctx.fillText(sub,W/2,H/2+36); }
  ctx.textAlign='left';
}

// ─── Game State ───────────────────────────────────────────────────────────────
const segs = buildTrack();
placeSprites(segs);

const OPP_COLS=['#1a72c8','#e0c020','#ffffff','#cc30e6','#30cc60','#ff8800','#cc1100'];
const opps = Array.from({length:7},(_,i)=>({
  x:(Math.random()-0.5)*1.3, z:(45+i*82)*SEG_LEN,
  spd:1050+Math.random()*650, col:OPP_COLS[i],
}));

let playerX=0, playerZ=0, speed=0, gear='LO';
let lapTime=0, bestLap=Infinity, lapCount=1, lastLapZ=0;
let startTime=null, phase='start', countdown=3, cdTimer=0;
let steerDir=0, score=0;
let crashTimer=0, crashCool=0, flashAlpha=0;

// ─── Update ───────────────────────────────────────────────────────────────────
let last=0, prevGearKey=false;

function update(dt) {
  if (phase==='start') {
    cdTimer+=dt; if(cdTimer>=1){cdTimer=0;countdown--;}
    if(countdown<=0){phase='race';startTime=performance.now();}
    return;
  }

  if (pressed['ShiftLeft']||pressed['KeyZ']||pressed['KeyG']) gear = gear==='LO'?'HI':'LO';
  delete pressed['ShiftLeft']; delete pressed['KeyZ']; delete pressed['KeyG'];

  flashAlpha = Math.max(0, flashAlpha - dt*3);

  if (crashTimer>0) {
    crashTimer-=dt; flashAlpha=Math.min(1,flashAlpha+dt*4);
    speed=Math.max(0,speed-4000*dt); playerZ+=speed*dt; return;
  }
  if (crashCool>0) crashCool-=dt;

  lapTime=(performance.now()-startTime)/1000;
  const accel=keys['ArrowUp']||keys['KeyW'];
  const brake=keys['Space']||keys['ArrowDown']||keys['KeyS'];
  const left=keys['ArrowLeft']||keys['KeyA'];
  const right=keys['ArrowRight']||keys['KeyD'];
  steerDir = right?1:left?-1:0;

  const maxSpd=gear==='HI'?MAX_SPD_HI:MAX_SPD_LO;
  if(accel) speed=Math.min(speed+ACCEL_R*dt,maxSpd);
  else if(brake) speed=Math.max(speed-BRAKE_R*dt,0);
  else speed=Math.max(speed-COAST_R*dt,0);

  const seg=segs[Math.floor(playerZ/SEG_LEN)%segs.length];
  if(Math.abs(playerX)>1.0) speed*=(1-OFFROAD_SLW*dt);
  if(left)  playerX-=STEER_R*dt*(speed/MAX_SPD_HI);
  if(right) playerX+=STEER_R*dt*(speed/MAX_SPD_HI);
  playerX-=seg.curve*CENTRIFUGAL*(speed/MAX_SPD_HI)*dt;
  playerX=Math.max(-2.8,Math.min(2.8,playerX));
  playerZ+=speed*dt;

  if(playerZ-lastLapZ>=LAP_LEN){
    lastLapZ+=LAP_LEN;
    if(lapTime<bestLap)bestLap=lapTime;
    lapCount++; startTime=performance.now(); lapTime=0; score+=5000;
  }
  score+=~~(speed*dt*0.008);

  // Opponent movement + collision
  opps.forEach(c=>{
    c.z+=c.spd*dt;
    if(crashCool<=0){
      const cz=c.z%LAP_LEN, pz=playerZ%LAP_LEN;
      let rz=cz-pz; if(rz<0)rz+=LAP_LEN;
      if(rz<320 && Math.abs(c.x-playerX)<0.38){
        crashTimer=1.8; crashCool=4.0; flashAlpha=1;
        speed=Math.max(0,speed*0.3);
      }
    }
  });
}

// ─── Render ───────────────────────────────────────────────────────────────────
function render() {
  const camX=playerX, camZ=playerZ;
  const startIdx=~~(camZ/SEG_LEN)%segs.length;
  let xOff=0, yOff=0;
  const proj=[];
  for(let i=0;i<DRAW_DIST;i++){
    const si=(startIdx+i)%segs.length;
    const s=segs[si];
    const dz=(i+1)*SEG_LEN;
    const fi=Math.max(0,(i-DRAW_DIST*0.65)/(DRAW_DIST*0.35));
    const f=fi*fi;
    const p=project(xOff*ROAD_W, s.startY+yOff, camZ+dz, camX*ROAD_W/2, CAM_H, camZ);
    proj.push({seg:s,p,f,xOff,yOff});
    xOff+=s.curve; yOff+=s.hill;
  }

  // Horizon parallax from accumulated curve offset
  const hx=(proj.length>0 && proj[proj.length-1].p) ? proj[proj.length-1].p.x-W/2 : 0;
  drawBackground(hx);

  const sprites=[];

  for(let i=proj.length-1;i>=0;i--){
    const {seg,p,f,xOff:sx,yOff:sy}=proj[i];
    if(!p) continue;
    const pFar=i<proj.length-1?proj[i+1].p:null;
    if(!pFar) continue;
    drawStrip(p,pFar,seg,f);

    // collect sprites for this depth
    seg.sprites.forEach(sp=>{
      const wX=sp.side*(ROAD_W/2+sp.worldOff*ROAD_W*0.5);
      const pp=project(wX+sx*ROAD_W, seg.startY+sy, camZ+(i+0.5)*SEG_LEN, camX*ROAD_W/2, CAM_H, camZ);
      if(pp && pp.y>46 && pp.y<H+60) sprites.push({...sp,pp,rw:p.w});
    });
  }

  // Opponent cars
  opps.forEach(c=>{
    const cz=c.z%LAP_LEN, pz=camZ%LAP_LEN;
    let rz=cz-pz; if(rz<0)rz+=LAP_LEN;
    if(rz<=0||rz>DRAW_DIST*SEG_LEN)return;
    const pi2=~~(rz/SEG_LEN);
    if(pi2>=proj.length)return;
    const {xOff:sx,yOff:sy,seg}=proj[pi2];
    const pp=project(c.x*ROAD_W/2+sx*ROAD_W, seg.startY+sy, camZ+rz, camX*ROAD_W/2, CAM_H, camZ);
    if(pp && pp.y>46 && pp.y<H) sprites.push({type:'opp',pp,car:c,rw:pp.scale*ROAD_W*W/2});
  });

  // Sort sprites farthest-first then draw
  sprites.sort((a,b)=>a.pp.scale-b.pp.scale);
  sprites.forEach(s=>{
    const {pp,rw}=s;
    if(s.type==='opp') drawOppCar(pp.x,pp.y,rw,s.car.col);
    else if(s.type===SP.BILLBOARD) drawBillboard(pp.x,pp.y,rw,s.bi);
    else if(s.type===SP.PYLON)     drawPylon(pp.x,pp.y,rw);
    else if(s.type===SP.TREE)      drawTree(pp.x,pp.y,rw);
    else if(s.type===SP.CROWD)     drawCrowd(pp.x,pp.y,rw);
  });

  // Crash flash overlay
  if(flashAlpha>0){
    ctx.fillStyle=`rgba(255,120,0,${flashAlpha*0.6})`;
    ctx.fillRect(0,0,W,H);
  }

  if(crashTimer>0){
    // Explosion
    const t=1-crashTimer/1.8;
    ctx.fillStyle=`rgba(255,180,0,${(1-t)*0.9})`;
    ctx.beginPath(); ctx.arc(W/2,cy_car(),30+120*t,0,Math.PI*2); ctx.fill();
    ctx.fillStyle=`rgba(255,255,100,${(1-t)*0.7})`;
    ctx.beginPath(); ctx.arc(W/2,cy_car(),15+60*t,0,Math.PI*2); ctx.fill();
  } else {
    drawPlayerCar(steerDir);
  }

  drawHUD(speed,gear,lapTime,bestLap,lapCount,score);
  if(phase==='start') drawOverlay(countdown>0?String(countdown):'GO!','UP=Accel  Z/Shift=Gear  SPACE=Brake');
}

function cy_car(){return H-88;}

// ─── Loop ─────────────────────────────────────────────────────────────────────
function loop(ts){
  const dt=Math.min((ts-last)/1000,0.05); last=ts;
  update(dt); render(); requestAnimationFrame(loop);
}
requestAnimationFrame(ts=>{last=ts; requestAnimationFrame(loop);});
