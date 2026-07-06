/* On-screen touch controls for Pole Position (both versions).
   Shown only on coarse-pointer (touch) devices; feeds the game
   through window.__ppInput(key, isDown). */
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
        #tc-left  { left: 12px;  bottom: 18px; width: 74px; height: 74px; font-size: 30px; }
        #tc-right { left: 96px;  bottom: 18px; width: 74px; height: 74px; font-size: 30px; }
        #tc-gas   { right: 12px; bottom: 18px; width: 84px; height: 84px; font-size: 18px; }
        #tc-brk   { right: 106px; bottom: 18px; width: 64px; height: 64px; font-size: 15px; }
        #tc-gear  { right: 12px; bottom: 114px; width: 64px; height: 44px; font-size: 14px; }
        /* start + pause live in a bar ABOVE the play area so nothing overlaps */
        #tc-start { left: 50%; transform: translateX(-108%); top: 8px;
          width: 92px; height: 38px; font-size: 15px; }
        #tc-pause { left: 50%; transform: translateX(8%); top: 8px;
          width: 92px; height: 38px; font-size: 15px; }
      </style>
      <div class="tbtn" id="tc-left">&#9664;</div>
      <div class="tbtn" id="tc-right">&#9654;</div>
      <div class="tbtn" id="tc-gas">GAS</div>
      <div class="tbtn" id="tc-brk">BRK</div>
      <div class="tbtn" id="tc-gear">GEAR</div>
      <div class="tbtn" id="tc-start">START</div>
      <div class="tbtn" id="tc-pause">&#10074;&#10074; / &#9654;</div>`;
    document.body.appendChild(wrap);

    const map = {
      'tc-left': 'arrowleft', 'tc-right': 'arrowright',
      'tc-gas': 'arrowup', 'tc-brk': ' ',
      'tc-gear': 'gear', 'tc-start': 'enter', 'tc-pause': 'pause'
    };
    for (const [id, keyName] of Object.entries(map)) {
      const el = document.getElementById(id);
      const set = (down) => (e) => {
        e.preventDefault();
        el.classList.toggle('held', down);
        window.__ppInput(keyName, down);
      };
      el.addEventListener('pointerdown', set(true));
      el.addEventListener('pointerup', set(false));
      el.addEventListener('pointercancel', set(false));
      el.addEventListener('pointerleave', set(false));
      el.addEventListener('contextmenu', (e) => e.preventDefault());
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
