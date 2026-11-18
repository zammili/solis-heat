# Solis Heat

An open-world crime game that runs entirely in a desktop web browser, built for
make.fun's **Make GTA 6** bounty. No build step, no server, no network: open
`game/index.html` from any static file server and play.

[![Competition](https://make.fun/badge/gta6-01.svg)](https://make.fun/bounty/gta6-01)
[![Rank](https://make.fun/badge/gta6-01/zammili/solis-heat/rank.svg)](https://make.fun/bounty/gta6-01)
[![Reward](https://make.fun/badge/gta6-01/zammili/solis-heat/reward.svg)](https://make.fun/bounty/gta6-01)

Bounty page: https://make.fun/bounty/gta6-01

## The game

Welcome to **Puerto Solis**, a sunset-bathed coastal city on the Costa Dorada.
You are Valeria "Val" Mendoza, a driver who owes the port syndicate Los
Escorpiones one last night of work. Take the jobs Dante Reyes radios in, steal
what you need, and try to keep the SPD Task Force off your tail until sunrise.

- **A living city** — neon Art-Deco hotels along the Playa Coral boulevard, the
  Corona downtown towers, the container cranes of Muelle Norte, a wooden pier,
  and a glittering sea, all lit by a GLSL sunset sky.
- **On foot and behind the wheel** — walk the promenades, hijack traffic with
  `F`, drift sports coupes with the handbrake, and take the Marina Speedboat
  off the pier.
- **Wanted system** — crimes raise your stars from 1 to 5. SPD Interceptors
  give chase with flashing light bars, and at four stars a police helicopter
  pins you in its searchlight. Break their line of sight, or repaint your car
  at Solis Customs to cool things down.
- **A five-mission story campaign** — from a sunset pickup on the boulevard to
  a harbour raid, a three-star escape, an offshore boat getaway and a downtown
  finale, with radio dialogue, golden mission beacons and cash rewards.
- **Combat** — fists, the Solis 9mm, the Pulso micro-SMG and the Costa
  tactical shotgun, with raycast tracers, muzzle flash and cash pickups.
- **Full HUD** — live radar minimap with a mission route line, wanted stars,
  health and armour bars, weapon readout and a speedometer.
- **Start & save menu** — pause over the living city, save your cash, weapons,
  mission progress and position to `localStorage`, and pick up where you left.
- **Synthesised sound** — engines, tyre screech, sirens, gunshots and an
  optional synthwave radio, all generated live with the Web Audio API. The
  game ships zero audio files.

## Controls

| Input | Action |
| --- | --- |
| `W A S D` / arrows | Move / drive |
| Mouse (click canvas to lock) | Camera, aim |
| Left mouse button | Fire weapon |
| `Shift` | Sprint |
| `F` | Enter / hijack / exit vehicle |
| `Space` | Handbrake drift |
| `1`–`4` or mouse wheel | Select weapon |
| `E` | Repaint at Solis Customs (clears wanted level) |
| `R` | Toggle radio |
| `P` / `Esc` | Start & save menu |

## Layout

- `game/` — the whole game as static files: `index.html`, the HUD stylesheet,
  ES modules under `src/` (city, player, vehicles, combat, AI, missions, UI,
  audio), and Three.js vendored as `*.min.js` under `game/vendor/`.
- `screenshots/` — four captures of the game itself; the first by name is the
  cover.
- `main.ts` — the hand-in program: copies `game/` and `screenshots/` to the
  output directory and writes `dossier.json` with the kit's
  `vendor/makefun-game.ts` library.
- `serve.ts` — a tiny local server: `node serve.ts`, then open
  http://localhost:8080 to play.

Everything in the game — city, characters, vehicles, names, story, art and
sound — is original to Solis Heat.
