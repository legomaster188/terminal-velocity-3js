# Terminal Velocity // 3JS

A browser remake of the 1995 flight-shooter **Terminal Velocity**, built with
**Three.js** (low-poly "vector" 3D) and **WebSocket online multiplayer**.

Fly a strike fighter over a procedural alien surface, dogfight other pilots in
real time, and rack up kills.

## Run it

```bash
npm install
npm start
```

Then open **http://localhost:8080**. Enter a callsign, hit **LAUNCH**, and click
the screen to lock the mouse.

To play multiplayer locally, open the URL in a second tab/browser — each tab is a
separate pilot. The server relays everyone's position and combat in real time.

## Controls

| Input | Action |
|-------|--------|
| Mouse | Steer (pitch / yaw) |
| W / S | Throttle up / down |
| A / D | Roll |
| Shift | Afterburner (very fast, but **weapons go offline** — as in the original) |
| Left-click / Space | Plasma cannon |
| Right-click / F | Homing missile (limited ammo) |
| Q | Smart bomb (clears nearby enemies / damages nearby pilots) |
| C | Toggle chase / cockpit camera |
| M | Mute / unmute audio |
| Tab | Pilot roster / scoreboard |
| Esc | Release mouse |

On touch devices a virtual joystick + FIRE / MSL / THR / BOOST buttons appear automatically.

## Gameplay

- **Energy shield** (one bar) drains from enemy fire, ground turrets, and crashing into
  terrain or pylons — at zero you're destroyed and respawn with brief invulnerability.
- **Ground turrets** sit atop the red-cored pylons and shoot back; destroy them for TARGETS.
- **Pickups**: green octahedra restore shield, orange crates restock missiles.
- **Altimeter + "PULL UP"** warning when you're skimming the deck.
- **Homing missiles** lock onto the nearest target ahead — a **lock reticle** marks it.
- **Enemy AI fighters** patrol the sector, chase you, and shoot back; destroy them for TARGETS.
- **Afterburner is a managed resource** — the BOOST bar drains while boosting and recharges otherwise.
- **Shield slowly regenerates** when you stay out of fire for a few seconds.
- **Floating nameplates** (with shield bars) hover over other online pilots.
- Damage flash, engine trails, and a cockpit/chase camera toggle (C); mute with M.

- **Smart bombs** (Q) detonate an area blast — clears nearby turrets/fighters and damages nearby pilots.
- **Spread-cannon pickup** (purple) temporarily gives a triple-shot cannon and a spare bomb.
- **Score + rank** progression (RECRUIT → LEGEND), shown in the HUD.
- **Speed FOV kick**, hit markers, enemy ramming, and a throttle-pitched engine drone.
- **Boss gunship** — a heavily-armoured enemy with its own health bar; worth +500.
- **Multi-kill callouts** (DOUBLE KILL → RAMPAGE) and floating score popups.
- **Screen shake** on explosions/bombs/hits, **visual banking** into turns,
  and a **gradient sky with a sun**.

Enemy fighters, turrets, and pickups are simulated **per-client** (each pilot gets their own
PvE hazards), layered underneath the shared real-time PvP.

## How it works

- **`server.js`** — Node HTTP server (serves the client) + `ws` WebSocket server.
  It's an *authoritative-relay* model: it assigns each pilot an id/color and
  relays `state`, `shot`, `hit`, and `hp` messages between clients. Each client is
  authoritative over its own hull health.
- **`public/main.js`** — the game: Three.js scene, procedural flat-shaded terrain,
  6-DOF flight physics, lasers with client-side hit detection, chase camera, HUD
  (speed/hull bars, rotating radar, kill feed).
- **`public/index.html` / `style.css`** — UI shell + retro neon HUD. Three.js is
  loaded from a CDN via an import map, so there's **no build step**.

## Hosting for real (internet) multiplayer

The server already binds to all interfaces, so to let friends join you only need a
public address. Options:

1. **Quick tunnel** (no config): `npx localtunnel --port 8080` or
   `cloudflared tunnel --url http://localhost:8080`, then share the URL.
2. **Port-forward** TCP `8080` on your router to this PC, share your public IP.
3. **Cloud host** (Render / Fly.io / Railway): set `PORT` from the env (already
   supported) and deploy. WebSockets work over the same port; use `wss://` (the
   client auto-selects `wss` on HTTPS pages).

## Roadmap / ideas

- AI enemy ships and ground turrets (the pylons are wired up as targets already)
- Server-side hit validation (anti-cheat)
- Weapon types (missiles, spread), pickups, shields
- Tunnels / canyons like the original's underground sections
- Team modes + scoreboard, respawn invulnerability
