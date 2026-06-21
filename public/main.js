// Terminal Velocity // 3JS — flight-combat client.
import * as THREE from 'three';

// ----------------------------------------------------------------------------
// Scene, renderer, camera
// ----------------------------------------------------------------------------
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.domElement.id = 'scene';
document.body.prepend(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x05060a);
scene.fog = new THREE.Fog(0x0a1430, 600, 4200);

const camera = new THREE.PerspectiveCamera(72, innerWidth / innerHeight, 1, 12000);

const isTouch = matchMedia('(pointer: coarse)').matches || ('ontouchstart' in window);

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// ----------------------------------------------------------------------------
// Lighting + sky
// ----------------------------------------------------------------------------
scene.add(new THREE.HemisphereLight(0x88bbff, 0x223044, 0.9));
const sun = new THREE.DirectionalLight(0xffffff, 1.1);
sun.position.set(0.5, 1, 0.3);
scene.add(sun);

// Starfield
{
  const g = new THREE.BufferGeometry();
  const N = 1800, pos = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) {
    const r = 8000, u = Math.random(), v = Math.random();
    const th = 2 * Math.PI * u, ph = Math.acos(2 * v - 1);
    pos[i*3]   = r * Math.sin(ph) * Math.cos(th);
    pos[i*3+1] = Math.abs(r * Math.cos(ph)) * 0.6 + 200;
    pos[i*3+2] = r * Math.sin(ph) * Math.sin(th);
  }
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  scene.add(new THREE.Points(g, new THREE.PointsMaterial({ color: 0x99ccff, size: 14, sizeAttenuation: true })));
}

// ----------------------------------------------------------------------------
// Procedural terrain (low-poly flat-shaded "vector" look)
// ----------------------------------------------------------------------------
const WORLD = 8000;
function terrainHeight(x, z) {
  return Math.sin(x * 0.0020) * Math.cos(z * 0.0017) * 140
       + Math.sin(x * 0.0061 + z * 0.0033) * 45
       + Math.cos(z * 0.0090) * 28
       - 120;
}
{
  const seg = 120;
  const geo = new THREE.PlaneGeometry(WORLD, WORLD, seg, seg);
  geo.rotateX(-Math.PI / 2);
  const p = geo.attributes.position;
  const colors = new Float32Array(p.count * 3);
  const low = new THREE.Color(0x10243a), high = new THREE.Color(0x2f6f8f), peak = new THREE.Color(0x9fe6ff);
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), z = p.getZ(i);
    const h = terrainHeight(x, z);
    p.setY(i, h);
    const t = THREE.MathUtils.clamp((h + 160) / 320, 0, 1);
    const c = t < 0.6 ? low.clone().lerp(high, t / 0.6) : high.clone().lerp(peak, (t - 0.6) / 0.4);
    colors[i*3] = c.r; colors[i*3+1] = c.g; colors[i*3+2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 1, metalness: 0 }));
  scene.add(mesh);
  const wire = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0x2af, wireframe: true, transparent: true, opacity: 0.12 }));
  scene.add(wire);
}

// Scattered enemy pylons (obstacles + landmarks)
const pylons = [];
{
  const mat = new THREE.MeshStandardMaterial({ color: 0x223a55, flatShading: true, emissive: 0x06121f });
  for (let i = 0; i < 60; i++) {
    const x = (Math.random() - 0.5) * WORLD * 0.8;
    const z = (Math.random() - 0.5) * WORLD * 0.8;
    const h = 200 + Math.random() * 500;
    const geo = new THREE.ConeGeometry(40 + Math.random() * 50, h, 5);
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, terrainHeight(x, z) + h / 2, z);
    scene.add(m);
    const top = new THREE.PointLight(0xff5577, 0.6, 300);
    top.position.set(x, terrainHeight(x, z) + h, z);
    scene.add(top);
    pylons.push(m);
  }
}

// ----------------------------------------------------------------------------
// Ship factory
// ----------------------------------------------------------------------------
function makeShip(colorHex) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.ConeGeometry(8, 34, 6),
    new THREE.MeshStandardMaterial({ color: colorHex, flatShading: true, metalness: 0.3, roughness: 0.5 })
  );
  body.rotation.x = -Math.PI / 2; // point nose toward -Z
  g.add(body);
  const wingMat = new THREE.MeshStandardMaterial({ color: 0xdedede, flatShading: true, metalness: 0.2, roughness: 0.6 });
  const wing = new THREE.Mesh(new THREE.BoxGeometry(46, 2, 14), wingMat);
  wing.position.z = 6;
  g.add(wing);
  const fin = new THREE.Mesh(new THREE.BoxGeometry(2, 12, 12), wingMat);
  fin.position.set(0, 5, 10);
  g.add(fin);
  // Engine glow
  const glow = new THREE.Mesh(
    new THREE.SphereGeometry(5, 8, 8),
    new THREE.MeshBasicMaterial({ color: 0x66ccff })
  );
  glow.position.z = 16;
  g.add(glow);
  g.userData.glow = glow;
  return g;
}

// ----------------------------------------------------------------------------
// Local player state
// ----------------------------------------------------------------------------
const player = {
  pos: new THREE.Vector3(0, 400, 1200),
  quat: new THREE.Quaternion(),
  speed: 260,
  hp: 100,
  kills: 0,
  alive: true,
  cooldown: 0,
};
const ship = makeShip(0x33ddff);
scene.add(ship);

const camOffset = new THREE.Vector3(0, 22, 90);
const tmpV = new THREE.Vector3();
const tmpQ = new THREE.Quaternion();

// ----------------------------------------------------------------------------
// Input
// ----------------------------------------------------------------------------
const keys = {};
addEventListener('keydown', e => { keys[e.code] = true; if (e.code === 'Space') e.preventDefault(); });
addEventListener('keyup', e => { keys[e.code] = false; });

let yawInput = 0, pitchInput = 0;
let pointerLocked = false;
renderer.domElement.addEventListener('click', () => {
  if (!started || isTouch) return;
  if (!pointerLocked) renderer.domElement.requestPointerLock();
  else firing = true;
});
document.addEventListener('pointerlockchange', () => { pointerLocked = document.pointerLockElement === renderer.domElement; });
addEventListener('mousemove', e => {
  if (!pointerLocked) return;
  yawInput   = THREE.MathUtils.clamp(yawInput   - e.movementX * 0.00035, -1, 1);
  pitchInput = THREE.MathUtils.clamp(pitchInput - e.movementY * 0.00035, -1, 1);
});
let firing = false;
addEventListener('mousedown', e => { if (e.button === 0 && pointerLocked) firing = true; });
addEventListener('mouseup', e => { if (e.button === 0) firing = false; });

// Touch controls — virtual joystick (steer) + hold buttons (throttle/boost/fire)
let touchSteer = false;
const touchVec = { x: 0, y: 0 };
let touchThrottle = 0;   // -1 down, +1 up
let touchBoost = false;
if (isTouch) {
  document.getElementById('touch').classList.remove('hidden');
  document.body.style.touchAction = 'none';

  const stick = document.getElementById('stick');
  const knob = stick.firstElementChild;
  const R = 55;
  let stickId = null;
  const setStick = (t) => {
    const r = stick.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    let dx = t.clientX - cx, dy = t.clientY - cy;
    const len = Math.hypot(dx, dy) || 1;
    const m = Math.min(len, R);
    const nx = dx / len * m, ny = dy / len * m;
    knob.style.transform = `translate(${nx}px, ${ny}px)`;
    touchVec.x = -(nx / R);   // drag right -> yaw right (matches mouse)
    touchVec.y = -(ny / R);   // drag up -> nose up
    touchSteer = true;
  };
  stick.addEventListener('touchstart', e => { e.preventDefault(); stickId = e.changedTouches[0].identifier; setStick(e.changedTouches[0]); }, { passive: false });
  stick.addEventListener('touchmove', e => { e.preventDefault(); for (const t of e.changedTouches) if (t.identifier === stickId) setStick(t); }, { passive: false });
  const stickEnd = e => { for (const t of e.changedTouches) if (t.identifier === stickId) { stickId = null; touchSteer = false; touchVec.x = 0; touchVec.y = 0; knob.style.transform = 'translate(0,0)'; } };
  stick.addEventListener('touchend', stickEnd);
  stick.addEventListener('touchcancel', stickEnd);

  const hold = (id, on, off) => {
    const el = document.getElementById(id);
    el.addEventListener('touchstart', e => { e.preventDefault(); on(); }, { passive: false });
    el.addEventListener('touchend', e => { e.preventDefault(); off(); }, { passive: false });
    el.addEventListener('touchcancel', () => off());
  };
  hold('btn-fire',  () => { firing = true; },  () => { firing = false; });
  hold('btn-boost', () => { touchBoost = true; }, () => { touchBoost = false; });
  hold('btn-thrup', () => { touchThrottle = 1; },  () => { touchThrottle = 0; });
  hold('btn-thrdn', () => { touchThrottle = -1; }, () => { touchThrottle = 0; });

  const ctrls = document.querySelector('#overlay .controls');
  if (ctrls) ctrls.innerHTML = '<b>TOUCH CONTROLS</b><br/>LEFT STICK — steer &nbsp;·&nbsp; THR ▲/▼ — throttle<br/>BOOST — afterburner &nbsp;·&nbsp; FIRE — lasers';
}

// ----------------------------------------------------------------------------
// Projectiles
// ----------------------------------------------------------------------------
const lasers = []; // { mesh, vel, life, mine }
const laserGeo = new THREE.CylinderGeometry(1.2, 1.2, 40, 6).rotateX(Math.PI / 2);
function spawnLaser(origin, dir, colorHex, mine) {
  const mesh = new THREE.Mesh(laserGeo, new THREE.MeshBasicMaterial({ color: colorHex }));
  mesh.position.copy(origin);
  mesh.quaternion.copy(player.quat); // visual orientation; close enough
  scene.add(mesh);
  lasers.push({ mesh, vel: dir.clone().multiplyScalar(2600), life: 1.6, mine });
}

// Simple explosion spark
const sparks = [];
function spawnSpark(pos, colorHex) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(6, 8, 8), new THREE.MeshBasicMaterial({ color: colorHex }));
  m.position.copy(pos);
  scene.add(m);
  sparks.push({ mesh: m, life: 0.4 });
}

// ----------------------------------------------------------------------------
// Networking
// ----------------------------------------------------------------------------
const remotes = new Map(); // id -> { ship, name, color, hp, target:{pos,quat} }
let myId = null;
let started = false;
const statusEl = document.getElementById('status');
const playersEl = document.getElementById('players');
const killfeed = document.getElementById('killfeed');

const proto = location.protocol === 'https:' ? 'wss' : 'ws';
let ws;
function connect() {
  ws = new WebSocket(`${proto}://${location.host}`);
  ws.onopen = () => { statusEl.textContent = 'LINK ESTABLISHED'; };
  ws.onclose = () => { statusEl.textContent = 'LINK LOST — RETRYING'; setTimeout(connect, 1500); };
  ws.onmessage = ev => handle(JSON.parse(ev.data));
}
connect();

function addRemote(info) {
  if (info.id === myId || remotes.has(info.id)) return;
  const s = makeShip(info.color);
  scene.add(s);
  remotes.set(info.id, {
    ship: s, name: info.name, color: info.color, hp: info.hp ?? 100,
    target: { pos: new THREE.Vector3(), quat: new THREE.Quaternion() },
    hasState: false,
  });
  updatePlayerCount();
}

function handle(m) {
  switch (m.type) {
    case 'init':
      myId = m.id;
      ship.children[0].material.color.setHex(m.color);
      m.players.forEach(addRemote);
      updatePlayerCount();
      break;
    case 'join':
      addRemote(m);
      feed(`${m.name} entered the sector`);
      break;
    case 'leave': {
      const r = remotes.get(m.id);
      if (r) { scene.remove(r.ship); remotes.delete(m.id); updatePlayerCount(); }
      break;
    }
    case 'state': {
      const r = remotes.get(m.id);
      if (!r) return;
      r.target.pos.set(m.s[0], m.s[1], m.s[2]);
      r.target.quat.set(m.s[3], m.s[4], m.s[5], m.s[6]);
      if (!r.hasState) { r.ship.position.copy(r.target.pos); r.ship.quaternion.copy(r.target.quat); r.hasState = true; }
      break;
    }
    case 'shot': {
      const r = remotes.get(m.id);
      const o = new THREE.Vector3(m.o[0], m.o[1], m.o[2]);
      const d = new THREE.Vector3(m.d[0], m.d[1], m.d[2]);
      spawnLaser(o, d, r ? r.color : 0xff5577, false);
      break;
    }
    case 'hit':
      applyDamage(m.dmg, m.from);
      break;
    case 'hp': {
      const r = remotes.get(m.id);
      if (r) r.hp = m.hp;
      if (m.hp <= 0) {
        const who = remotes.get(m.id);
        if (m.by === myId) { player.kills++; document.getElementById('kills').textContent = `KILLS: ${player.kills}`; feed(`YOU destroyed ${who ? who.name : 'a pilot'}`); }
        else feed(`${who ? who.name : 'A pilot'} was destroyed`);
      }
      break;
    }
    case 'name': {
      const r = remotes.get(m.id);
      if (r) r.name = m.name;
      break;
    }
  }
}

function send(obj) { if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj)); }
function updatePlayerCount() { playersEl.textContent = `PILOTS ONLINE: ${remotes.size + 1}`; }
function feed(text) {
  const d = document.createElement('div');
  d.textContent = text;
  killfeed.appendChild(d);
  setTimeout(() => d.remove(), 4000);
}

function applyDamage(dmg, from) {
  if (!player.alive) return;
  player.hp -= dmg;
  spawnSpark(player.pos, 0xff5577);
  if (player.hp <= 0) {
    player.hp = 0;
    player.alive = false;
    send({ type: 'hp', hp: 0, by: from });
    feed('YOU WERE DESTROYED');
    setTimeout(respawn, 2200);
  } else {
    send({ type: 'hp', hp: player.hp, by: from });
  }
}

function respawn() {
  player.pos.set((Math.random() - 0.5) * 2000, 500, (Math.random() - 0.5) * 2000);
  player.quat.identity();
  player.speed = 260;
  player.hp = 100;
  player.alive = true;
  send({ type: 'hp', hp: 100, by: 0 });
}

// ----------------------------------------------------------------------------
// Launch / overlay
// ----------------------------------------------------------------------------
const overlay = document.getElementById('overlay');
document.getElementById('launch').addEventListener('click', () => {
  const name = (document.getElementById('callsign').value || 'PILOT').toUpperCase().slice(0, 16);
  send({ type: 'name', name });
  overlay.classList.add('hidden');
  started = true;
  if (!isTouch) renderer.domElement.requestPointerLock();
});

// ----------------------------------------------------------------------------
// HUD: radar + bars
// ----------------------------------------------------------------------------
const radar = document.getElementById('radar').getContext('2d');
const speedBar = document.getElementById('speed-bar');
const hullBar = document.getElementById('hull-bar');
function drawRadar() {
  const w = 140, h = 140, cx = 70, cy = 70, R = 64, range = 3000;
  radar.clearRect(0, 0, w, h);
  radar.strokeStyle = '#2af'; radar.globalAlpha = 0.5;
  radar.beginPath(); radar.arc(cx, cy, R, 0, 7); radar.stroke();
  radar.beginPath(); radar.moveTo(cx, cy - R); radar.lineTo(cx, cy + R); radar.moveTo(cx - R, cy); radar.lineTo(cx + R, cy); radar.stroke();
  radar.globalAlpha = 1;
  // forward vector (yaw) for rotation
  const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(player.quat);
  const heading = Math.atan2(fwd.x, -fwd.z);
  const cosH = Math.cos(-heading), sinH = Math.sin(-heading);
  for (const r of remotes.values()) {
    const dx = r.ship.position.x - player.pos.x;
    const dz = r.ship.position.z - player.pos.z;
    if (Math.hypot(dx, dz) > range) continue;
    const rx = (dx * cosH - dz * sinH) / range * R;
    const rz = (dx * sinH + dz * cosH) / range * R;
    radar.fillStyle = '#' + r.color.toString(16).padStart(6, '0');
    radar.beginPath(); radar.arc(cx + rx, cy + rz, 3, 0, 7); radar.fill();
  }
  radar.fillStyle = '#7df9ff';
  radar.beginPath(); radar.moveTo(cx, cy - 5); radar.lineTo(cx - 4, cy + 4); radar.lineTo(cx + 4, cy + 4); radar.fill();
}

// ----------------------------------------------------------------------------
// Main loop
// ----------------------------------------------------------------------------
let last = performance.now();
let netAccum = 0;

function tick(now) {
  const dt = Math.min((now - last) / 1000, 0.05);
  last = now;

  if (started && player.alive) updateFlight(dt);
  updateRemotes(dt);
  updateLasers(dt);
  updateSparks(dt);

  // Networking — 20Hz state push
  netAccum += dt;
  if (started && netAccum >= 0.05) {
    netAccum = 0;
    const q = player.quat;
    send({ type: 'state', s: [
      +player.pos.x.toFixed(1), +player.pos.y.toFixed(1), +player.pos.z.toFixed(1),
      +q.x.toFixed(4), +q.y.toFixed(4), +q.z.toFixed(4), +q.w.toFixed(4),
    ]});
  }

  // HUD
  speedBar.style.width = `${THREE.MathUtils.clamp((player.speed - 120) / 580 * 100, 0, 100)}%`;
  hullBar.style.width = `${player.hp}%`;
  drawRadar();

  renderer.render(scene, camera);
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);

function updateFlight(dt) {
  // Throttle
  const boost = keys['ShiftLeft'] || keys['ShiftRight'] || touchBoost;
  let target = 260;
  if (keys['KeyW'] || keys['ArrowUp'] || touchThrottle > 0) target = 480;
  if (keys['KeyS'] || keys['ArrowDown'] || touchThrottle < 0) target = 150;
  if (boost) target = 700;
  player.speed += (target - player.speed) * Math.min(dt * 2, 1);

  // Rotation: pitch/yaw from mouse or touch joystick, roll from A/D
  if (touchSteer) { yawInput = touchVec.x; pitchInput = touchVec.y; }
  const roll = (keys['KeyA'] || keys['ArrowLeft'] ? 1 : 0) - (keys['KeyD'] || keys['ArrowRight'] ? 1 : 0);
  const dQ = new THREE.Quaternion().setFromEuler(new THREE.Euler(
    pitchInput * dt * 1.6,
    yawInput * dt * 1.6,
    roll * dt * 1.8,
    'XYZ'
  ));
  player.quat.multiply(dQ).normalize();
  // Mouse input self-centers (return-to-neutral spring); joystick holds its value.
  if (!touchSteer) {
    yawInput *= (1 - Math.min(dt * 3, 1));
    pitchInput *= (1 - Math.min(dt * 3, 1));
  }

  // Move forward along local -Z
  const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(player.quat);
  player.pos.addScaledVector(fwd, player.speed * dt);

  // World bounds (soft wrap)
  const lim = WORLD / 2 - 100;
  player.pos.x = THREE.MathUtils.clamp(player.pos.x, -lim, lim);
  player.pos.z = THREE.MathUtils.clamp(player.pos.z, -lim, lim);

  // Terrain collision
  const ground = terrainHeight(player.pos.x, player.pos.z);
  if (player.pos.y < ground + 18) {
    player.pos.y = ground + 18;
    applyDamage(28 * dt * 60 / 60, 0); // graze damage
    if (player.hp > 0) spawnSpark(player.pos, 0xffaa33);
  }
  if (player.pos.y > 3000) player.pos.y = 3000;

  // Apply to ship mesh
  ship.position.copy(player.pos);
  ship.quaternion.copy(player.quat);
  ship.userData.glow.scale.setScalar(0.6 + (player.speed / 700) + (boost ? 0.6 : 0));

  // Chase camera
  tmpV.copy(camOffset).applyQuaternion(player.quat).add(player.pos);
  camera.position.lerp(tmpV, Math.min(dt * 6, 1));
  tmpQ.copy(player.quat);
  camera.quaternion.slerp(tmpQ, Math.min(dt * 6, 1));

  // Fire
  player.cooldown -= dt;
  if (firing && player.cooldown <= 0) {
    player.cooldown = 0.12;
    const muzzle = player.pos.clone().addScaledVector(fwd, 30);
    spawnLaser(muzzle, fwd, 0x33ddff, true);
    send({ type: 'shot', o: [muzzle.x, muzzle.y, muzzle.z], d: [fwd.x, fwd.y, fwd.z] });
  }
}

function updateRemotes(dt) {
  for (const r of remotes.values()) {
    if (!r.hasState) continue;
    r.ship.position.lerp(r.target.pos, Math.min(dt * 10, 1));
    r.ship.quaternion.slerp(r.target.quat, Math.min(dt * 10, 1));
  }
}

function updateLasers(dt) {
  for (let i = lasers.length - 1; i >= 0; i--) {
    const L = lasers[i];
    L.mesh.position.addScaledVector(L.vel, dt);
    L.life -= dt;
    let dead = L.life <= 0;
    // Local shots check for hits against remote ships
    if (L.mine && !dead) {
      for (const [id, r] of remotes) {
        if (r.hp <= 0) continue;
        if (L.mesh.position.distanceTo(r.ship.position) < 30) {
          send({ type: 'hit', target: id, dmg: 12 });
          spawnSpark(L.mesh.position, r.color);
          dead = true;
          break;
        }
      }
    }
    if (dead) { scene.remove(L.mesh); lasers.splice(i, 1); }
  }
}

function updateSparks(dt) {
  for (let i = sparks.length - 1; i >= 0; i--) {
    const s = sparks[i];
    s.life -= dt;
    s.mesh.scale.multiplyScalar(1 + dt * 8);
    s.mesh.material.opacity = Math.max(s.life / 0.4, 0);
    s.mesh.material.transparent = true;
    if (s.life <= 0) { scene.remove(s.mesh); sparks.splice(i, 1); }
  }
}
