/* On-screen touch controls for Pole Position (both versions).
   Shown only on coarse-pointer (touch) devices; feeds the game
   through window.__ppInput(key, isDown).

   - steering is one pad: slide a held thumb across the midline to
     switch left/right without lifting
   - AUTO holds the throttle for you (brake overrides while held);
     the choice persists in localStorage
   - safe-area insets keep everything clear of the notch / home bar
   - landscape puts steering on the left edge and pedals on the right */
(function () {
  'use strict';
  const isTouch = ('ontouchstart' in window) ||
    (window.matchMedia && matchMedia('(pointer: coarse)').matches);
  if (!isTouch) return;

  function init() {
    const wrap = document.createElement('div');
    wrap.id = 'touch-controls';
    wrap.innerHTML = `
      <style>
        #touch-controls { position: fixed; inset: 0; pointer-events: none; z-index: 10;
          font-family: monospace; user-select: none; -webkit-user-select: none; }
        #touch-controls .tbtn {
          position: absolute; pointer-events: auto; touch-action: none;
          display: flex; align-items: center; justify-content: center;
          background: rgba(255,255,255,0.13); border: 2px solid rgba(255,255,255,0.35);
          border-radius: 14px; color: #fff; font-weight: bold;
        }
        #touch-controls .tbtn:active,
        #touch-controls .tbtn.held { background: rgba(255,255,255,0.32); }
        /* one steering pad, two visual halves; the pad handles the pointers */
        #tc-steer { position: absolute; pointer-events: auto; touch-action: none;
          left: calc(10px + env(safe-area-inset-left));
          bottom: calc(14px + env(safe-area-inset-bottom));
          /* never collide with the pedal cluster on narrow screens */
          width: min(200px, calc(50vw - 24px));
          height: 100px; display: flex; gap: 8px; }
        #tc-steer .tbtn { position: static; flex: 1; height: 100%;
          font-size: 34px; pointer-events: none; }
        #tc-gas  { right: calc(10px + env(safe-area-inset-right));
          bottom: calc(14px + env(safe-area-inset-bottom));
          width: 96px; height: 96px; font-size: 19px; }
        #tc-brk  { right: calc(116px + env(safe-area-inset-right));
          bottom: calc(14px + env(safe-area-inset-bottom));
          width: 76px; height: 76px; font-size: 16px; }
        #tc-gear { right: calc(116px + env(safe-area-inset-right));
          bottom: calc(122px + env(safe-area-inset-bottom));
          width: 76px; height: 44px; font-size: 14px; }
        #tc-auto { right: calc(10px + env(safe-area-inset-right));
          bottom: calc(122px + env(safe-area-inset-bottom));
          width: 96px; height: 44px; font-size: 14px; color: #aaa; }
        #tc-auto.on { background: rgba(248,184,0,0.30);
          border-color: rgba(248,184,0,0.8); color: #ffd75e; }
        /* start + options + pause live in a bar ABOVE the play area */
        #tc-start { left: calc(50% - 126px);
          top: calc(8px + env(safe-area-inset-top));
          width: 86px; height: 38px; font-size: 15px; }
        #tc-opt { left: calc(50% - 30px);
          top: calc(8px + env(safe-area-inset-top));
          width: 60px; height: 38px; font-size: 14px; }
        #tc-pause { left: calc(50% + 40px);
          top: calc(8px + env(safe-area-inset-top));
          width: 86px; height: 38px; font-size: 15px; }
        @media (orientation: landscape) {
          /* thumbs at the phone's edges: steering pad left, pedals right,
             start/pause in the top corners clear of the HUD */
          #tc-steer { top: 50%; bottom: auto; transform: translateY(-50%);
            width: 176px; }
          #tc-gas  { right: calc(10px + env(safe-area-inset-right));
            bottom: calc(16px + env(safe-area-inset-bottom)); }
          #tc-auto { right: calc(10px + env(safe-area-inset-right));
            bottom: calc(120px + env(safe-area-inset-bottom)); }
          #tc-brk  { right: calc(116px + env(safe-area-inset-right));
            bottom: calc(16px + env(safe-area-inset-bottom)); }
          #tc-gear { right: calc(116px + env(safe-area-inset-right));
            bottom: calc(120px + env(safe-area-inset-bottom)); }
          #tc-start { left: calc(8px + env(safe-area-inset-left)); }
          #tc-opt { left: calc(102px + env(safe-area-inset-left)); }
          #tc-pause { left: auto;
            right: calc(8px + env(safe-area-inset-right)); }
        }
      </style>
      <div id="tc-steer">
        <div class="tbtn" id="tc-left">&#9664;</div>
        <div class="tbtn" id="tc-right">&#9654;</div>
      </div>
      <div class="tbtn" id="tc-gas">GAS</div>
      <div class="tbtn" id="tc-brk">BRK</div>
      <div class="tbtn" id="tc-gear">GEAR</div>
      <div class="tbtn" id="tc-auto">AUTO</div>
      <div class="tbtn" id="tc-start">START</div>
      <div class="tbtn" id="tc-opt">OPT</div>
      <div class="tbtn" id="tc-pause">&#10074;&#10074; / &#9654;</div>`;
    document.body.appendChild(wrap);
    const el = (id) => document.getElementById(id);

    /* --- steering pad: per-pointer side tracking, slide to switch --- */
    const steer = el('tc-steer');
    const ptrs = new Map();                       // pointerId -> 'left' | 'right'
    function applySteer() {
      const sides = [...ptrs.values()];
      const l = sides.includes('left'), r = sides.includes('right');
      el('tc-left').classList.toggle('held', l);
      el('tc-right').classList.toggle('held', r);
      window.__ppInput('arrowleft', l);
      window.__ppInput('arrowright', r);
    }
    function steerAt(e) {
      const r = steer.getBoundingClientRect();
      const side = e.clientX < r.left + r.width / 2 ? 'left' : 'right';
      if (ptrs.get(e.pointerId) !== side) { ptrs.set(e.pointerId, side); applySteer(); }
    }
    steer.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      try { steer.setPointerCapture(e.pointerId); } catch (_) {}
      steerAt(e);
    });
    steer.addEventListener('pointermove', (e) => { if (ptrs.has(e.pointerId)) steerAt(e); });
    for (const t of ['pointerup', 'pointercancel'])
      steer.addEventListener(t, (e) => { if (ptrs.delete(e.pointerId)) applySteer(); });
    steer.addEventListener('contextmenu', (e) => e.preventDefault());

    /* --- pedals: AUTO holds throttle, BRK overrides it while held --- */
    let cfg = { auto: false };
    try { cfg = Object.assign(cfg, JSON.parse(localStorage.getItem('pp_touch') || '{}')); } catch (_) {}
    let gasHeld = false, brkHeld = false;
    function applyThrottle() {
      window.__ppInput('arrowup', gasHeld || (cfg.auto && !brkHeld));
    }
    function bindHold(id, onChange) {
      const b = el(id);
      const set = (down) => (e) => {
        e.preventDefault();
        b.classList.toggle('held', down);
        onChange(down);
      };
      b.addEventListener('pointerdown', set(true));
      for (const t of ['pointerup', 'pointercancel', 'pointerleave'])
        b.addEventListener(t, set(false));
      b.addEventListener('contextmenu', (e) => e.preventDefault());
    }
    bindHold('tc-gas', (down) => { gasHeld = down; applyThrottle(); });
    bindHold('tc-brk', (down) => {
      brkHeld = down;
      window.__ppInput(' ', down);
      applyThrottle();
    });
    bindHold('tc-gear', (down) => { if (down) window.__ppInput('gear', true); });
    bindHold('tc-start', (down) => window.__ppInput('enter', down));
    bindHold('tc-opt', (down) => window.__ppInput('o', down));
    bindHold('tc-pause', (down) => window.__ppInput('pause', down));
    el('tc-auto').addEventListener('pointerdown', (e) => {
      e.preventDefault();
      cfg.auto = !cfg.auto;
      el('tc-auto').classList.toggle('on', cfg.auto);
      try { localStorage.setItem('pp_touch', JSON.stringify(cfg)); } catch (_) {}
      applyThrottle();
    });
    el('tc-auto').classList.toggle('on', cfg.auto);
    applyThrottle();

    /* tapping the game screen: sent as 'tap' with 256x224 logical coords —
       starts/restarts from menus, changes rows in the options screen */
    for (const c of document.querySelectorAll('#gl, #game')) {
      c.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        const r = c.getBoundingClientRect();
        window.__ppInput('tap', true, {
          x: (e.clientX - r.left) / r.width * 256,
          y: (e.clientY - r.top) / r.height * 224
        });
        window.__ppInput('tap', false);
      });
    }
  }

  // the 3D game is an ES module (deferred), so __ppInput may not exist yet
  const poll = setInterval(() => {
    if (window.__ppInput && document.body) {
      clearInterval(poll);
      init();
    }
  }, 100);
})();
