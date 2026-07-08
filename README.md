# Pole Position

A browser remake of the 1982 Namco/Atari arcade racer, built from scratch with
no external assets — every sprite, texture, model, and sound is generated in
code. Ships in two flavors:

- **`/` — Pole Position 3D**: true 3D (three.js, vendored locally) with a chase
  camera, a road ribbon built from a closed spline of the stylized Fuji
  Speedway layout, low-poly F1 cars, particle effects, and the classic arcade
  HUD as a 2D overlay.
- **`/classic` — Classic 2D**: the authentic pseudo-3D sprite-scaling look of
  the original arcade game at 256×224, procedural pixel art and all.

## The rules (faithful to the arcade)

- **Qualifying**: one timed lap. Finish under **73.00** game seconds to make
  the race. Your time sets the grid: 58.50s = pole (4,000 pts) down to
  73.00s = 8th (200 pts). Fail and it's game over.
- **The race**: 3 laps (operator-adjustable) against 7 rivals plus slower
  traffic. You start with 90 game seconds and earn extended time at the line
  each lap. Run out of time and the game ends.
- **Scoring**: distance driven (~10,000/lap) + 50 points per car passed
  (tallied at the finish) + 200 points per second remaining at the flag.
- **Hazards**: touching a car or a roadside billboard explodes your car (it
  respawns after a moment with brief invulnerability). Puddles make you slip;
  grass slows you hard.
- **Gears**: two-position LO/HI shifter, top speed 315 km/h. The hairpin wants
  low gear at ~130 km/h.
- The clock ticks at ~2× real time ("game seconds"), just like the cabinet.

## Controls

| Input | Action |
| --- | --- |
| ← / → | steer |
| ↑ | accelerate |
| ↓ or Space | brake |
| Z or Shift | shift gear (LO/HI) |
| Enter | start / quick restart |
| P or Esc | pause |
| R | watch a replay of your last run (3D version) |
| O | options (track, laps, game time, extended time — the arcade dip switches) |
| M | mute |

On phones and tablets, on-screen touch controls appear automatically.

## Extras

Attract mode with a self-driving demo, high-score table with initials entry,
best-lap tracking, voice announcements, checkered flags on the final lap,
and an options menu mirroring the original operator dip-switch ranges.
Progress persists in `localStorage`.

The 3D version adds a second circuit — **Seaside Run**, an oceanfront course
with a fast opening loop and a tight chicane — selectable from the options
menu, plus a live minimap during play and a TV-style race replay (press R
after a run) filmed from trackside cameras.

## Running

```
npm install
npm start          # serves on http://localhost:3000
```

Deploys as-is on Railway (`railway.toml`, nixpacks, `node server.js`).

## Notes

Game rules and tuning values were researched against period sources (arcade
manuals, operator dip-switch sheets, and strategy guides for the 1982
original). The track is a stylized rendition of Fuji Speedway's 1974-83
layout: long start straight, sharp right, easy left kink, sweeping right,
the left hairpin, and a long gradual right back onto the straight.
