// Terminal Velocity // 3JS — flight-combat client.
import * as THREE from 'three';

// ----------------------------------------------------------------------------
// Audio (lightweight WebAudio synth — created on first user gesture)
// ----------------------------------------------------------------------------
const Audio = (() => {
  let ctx = null, muted = false;
  const ensure = () => { if (!ctx) { try { ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch {} } return ctx; };
  function tone(freq, dur, type, gain, slideTo) {
    if (muted) return;
    const c = ensure(); if (!c) return;
    const o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, c.currentTime);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, c.currentTime + dur);
    g.gain.setValueAtTime(gain, c.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + dur);
    o.connect(g).connect(c.destination); o.start(); o.stop(c.currentTime + dur);
  }
  function noise(dur, gain) {
    if (muted) return;
    const c = ensure(); if (!c) return;
    const buf = c.createBuffer(1, Math.max(1, c.sampleRate * dur), c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
    const n = c.createBufferSource(); n.buffer = buf;
    const g = c.createGain(); g.gain.setValueAtTime(gain, c.currentTime); g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + dur);
    const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 1400;
    n.connect(f).connect(g).connect(c.destination); n.start(); n.stop(c.currentTime + dur);
  }
  return {
    resume: () => { const c = ensure(); if (c && c.state === 'suspended') c.resume(); },
    toggleMute: () => { muted = !muted; return muted; },
    laser:   () => tone(900, 0.10, 'square', 0.05, 240),
    missile: () => tone(200, 0.45, 'sawtooth', 0.07, 80),
    boom:    () => { noise(0.5, 0.22); tone(110, 0.5, 'sawtooth', 0.09, 38); },
    pickup:  () => { tone(520, 0.10, 'sine', 0.06, 880); },
    alarm:   () => tone(680, 0.10, 'sine', 0.04),
  };
})();

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
// Procedural terrain
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
  scene.add(new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 1, metalness: 0 })));
  scene.add(new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0x2af, wireframe: true, transparent: true, opacity: 0.12 })));
}

// Pylons (solid obstacles) + turrets (destructible ground guns) mounted on some.
const pylons = [];   // { x, z, radius, top }
const turrets = [];  // { core, pos, hp, cd, alive, respawn }
{
  const mat = new THREE.MeshStandardMaterial({ color: 0x223a55, flatShading: true, emissive: 0x06121f });
  for (let i = 0; i < 60; i++) {
    const x = (Math.random() - 0.5) * WORLD * 0.8;
    const z = (Math.random() - 0.5) * WORLD * 0.8;
    const baseR = 40 + Math.random() * 50;
    const h = 200 + Math.random() * 500;
    const m = new THREE.Mesh(new THREE.ConeGeometry(baseR, h, 5), mat);
    const groundY = terrainHeight(x, z);
    m.position.set(x, groundY + h / 2, z);
    scene.add(m);
    const topY = groundY + h;
    pylons.push({ x, z, radius: baseR * 0.55, top: topY });
    if (i % 4 === 0) {
      const core = new THREE.Mesh(new THREE.SphereGeometry(18, 10, 10), new THREE.MeshBasicMaterial({ color: 0xff3344 }));
      const pos = new THREE.Vector3(x, topY + 12, z);
      core.position.copy(pos);
      scene.add(core);
      const halo = new THREE.PointLight(0xff3344, 0.7, 320);
      halo.position.copy(pos); scene.add(halo);
      turrets.push({ core, pos, hp: 30, cd: Math.random() * 2, alive: true, respawn: 0 });
    }
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
  body.rotation.x = -Math.PI / 2;
  g.add(body);
  const wingMat = new THREE.MeshStandardMaterial({ color: 0xdedede, flatShading: true, metalness: 0.2, roughness: 0.6 });
  const wing = new THREE.Mesh(new THREE.BoxGeometry(46, 2, 14), wingMat); wing.position.z = 6; g.add(wing);
  const fin = new THREE.Mesh(new THREE.BoxGeometry(2, 12, 12), wingMat); fin.position.set(0, 5, 10); g.add(fin);
  const glow = new THREE.Mesh(new THREE.SphereGeometry(5, 8, 8), new THREE.MeshBasicMaterial({ color: 0x66ccff }));
  glow.position.z = 16; g.add(glow);
  g.userData.glow = glow;
  return g;
}

// ----------------------------------------------------------------------------
// Local player
// ----------------------------------------------------------------------------
const player = {
  pos: new THREE.Vector3(0, 400, 1200),
  quat: new THREE.Quaternion(),
  speed: 260, hp: 100, kills: 0, targets: 0, missiles: 8,
  alive: true, cooldown: 0, mslCd: 0, invuln: 0, hpDirty: false, alarmT: 0, hurtT: 0,
  boost: 100, boosting: false, trailT: 0, lastHitAt: -9999,
};
const ship = makeShip(0x33ddff);
scene.add(ship);
let myName = 'PILOT';
let camMode = 0;     // 0 = chase, 1 = cockpit
let hurtFlash = 0;   // damage vignette intensity

// ----------------------------------------------------------------------------
// Enemy AI fighters (client-local hazards, like turrets)
// ----------------------------------------------------------------------------
const enemies = [];
function makeEnemy() {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: 0xff5533, flatShading: true, metalness: 0.3, roughness: 0.5 });
  const body = new THREE.Mesh(new THREE.OctahedronGeometry(13), mat);
  body.scale.set(1, 0.5, 1.6); g.add(body);
  const wing = new THREE.Mesh(new THREE.BoxGeometry(40, 2, 10), new THREE.MeshStandardMaterial({ color: 0x551111, flatShading: true }));
  g.add(wing);
  const eye = new THREE.Mesh(new THREE.SphereGeometry(4, 8, 8), new THREE.MeshBasicMaterial({ color: 0xffdd33 }));
  eye.position.z = -14; g.add(eye);
  return g;
}
function spawnEnemy(e) {
  const x = (Math.random() - 0.5) * WORLD * 0.7, z = (Math.random() - 0.5) * WORLD * 0.7;
  e.pos.set(x, terrainHeight(x, z) + 400 + Math.random() * 400, z);
  e.dir.set(Math.random() - 0.5, 0, Math.random() - 0.5).normalize();
  e.hp = 24; e.alive = true; e.cd = 1 + Math.random() * 2; e.ship.visible = true;
}
for (let i = 0; i < 5; i++) {
  const eship = makeEnemy();
  scene.add(eship);
  const e = { ship: eship, pos: new THREE.Vector3(), dir: new THREE.Vector3(0, 0, -1), hp: 24, cd: 2, alive: true, respawn: 0, speed: 300 };
  spawnEnemy(e); enemies.push(e);
}

const camOffset = new THREE.Vector3(0, 22, 90);
const camCockpit = new THREE.Vector3(0, 7, -8);
const tmpV = new THREE.Vector3();
const tmpQ = new THREE.Quaternion();
let tNow = performance.now();

// ----------------------------------------------------------------------------
// Input
// ----------------------------------------------------------------------------
const keys = {};
addEventListener('keydown', e => {
  keys[e.code] = true;
  if (e.code === 'Space') e.preventDefault();
  if (e.code === 'KeyF') tryFireMissile();
  if (e.code === 'KeyC') camMode = camMode ? 0 : 1;
  if (e.code === 'KeyM') feed(Audio.toggleMute() ? 'AUDIO MUTED' : 'AUDIO ON');
  if (e.code === 'Tab') { e.preventDefault(); showScore(true); }
});
addEventListener('keyup', e => {
  keys[e.code] = false;
  if (e.code === 'Tab') showScore(false);
});

let yawInput = 0, pitchInput = 0;
let pointerLocked = false;
let firing = false;

renderer.domElement.addEventListener('click', () => {
  if (!started || isTouch) return;
  if (!pointerLocked) renderer.domElement.requestPointerLock();
});
renderer.domElement.addEventListener('contextmenu', e => e.preventDefault());
document.addEventListener('pointerlockchange', () => {
  pointerLocked = document.pointerLockElement === renderer.domElement;
  if (!pointerLocked) firing = false;
});
addEventListener('mousemove', e => {
  if (!pointerLocked) return;
  yawInput   = THREE.MathUtils.clamp(yawInput   - e.movementX * 0.00035, -1, 1);
  pitchInput = THREE.MathUtils.clamp(pitchInput - e.movementY * 0.00035, -1, 1);
});
addEventListener('mousedown', e => {
  if (!pointerLocked) return;
  if (e.button === 0) firing = true;
  if (e.button === 2) tryFireMissile();
});
addEventListener('mouseup', e => { if (e.button === 0) firing = false; });

// Touch controls
let touchSteer = false;
const touchVec = { x: 0, y: 0 };
let touchThrottle = 0;
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
    const dx = t.clientX - cx, dy = t.clientY - cy;
    const len = Math.hypot(dx, dy) || 1, m = Math.min(len, R);
    const nx = dx / len * m, ny = dy / len * m;
    knob.style.transform = `translate(${nx}px, ${ny}px)`;
    touchVec.x = -(nx / R); touchVec.y = -(ny / R); touchSteer = true;
  };
  stick.addEventListener('touchstart', e => { e.preventDefault(); stickId = e.changedTouches[0].identifier; setStick(e.changedTouches[0]); }, { passive: false });
  stick.addEventListener('touchmove', e => { e.preventDefault(); for (const t of e.changedTouches) if (t.identifier === stickId) setStick(t); }, { passive: false });
  const stickEnd = e => { for (const t of e.changedTouches) if (t.identifier === stickId) { stickId = null; touchSteer = false; touchVec.x = 0; touchVec.y = 0; knob.style.transform = 'translate(0,0)'; } };
  stick.addEventListener('touchend', stickEnd);
  stick.addEventListener('touchcancel', stickEnd);

  const hold = (id, on, off) => {
    const el = document.getElementById(id);
    el.addEventListener('touchstart', e => { e.preventDefault(); on(); }, { passive: false });
    el.addEventListener('touchend', e => { e.preventDefault(); off && off(); }, { passive: false });
    el.addEventListener('touchcancel', () => off && off());
  };
  hold('btn-fire',  () => { firing = true; },  () => { firing = false; });
  hold('btn-msl',   () => { tryFireMissile(); });
  hold('btn-boost', () => { touchBoost = true; }, () => { touchBoost = false; });
  hold('btn-thrup', () => { touchThrottle = 1; },  () => { touchThrottle = 0; });
  hold('btn-thrdn', () => { touchThrottle = -1; }, () => { touchThrottle = 0; });

  const ctrls = document.querySelector('#overlay .controls');
  if (ctrls) ctrls.innerHTML = '<b>TOUCH CONTROLS</b><br/>LEFT STICK — steer &nbsp;·&nbsp; THR ▲/▼ — throttle<br/>FIRE — cannon &nbsp;·&nbsp; MSL — missile &nbsp;·&nbsp; BOOST — afterburner';
}

const isBoosting = () => keys['ShiftLeft'] || keys['ShiftRight'] || touchBoost;

// ----------------------------------------------------------------------------
// Projectiles, sparks, explosions
// ----------------------------------------------------------------------------
const shots = []; // { mesh, vel, prev, life, mine, hostile, dmg, kind, target }
const laserGeo = new THREE.CylinderGeometry(1.2, 1.2, 40, 6).rotateX(Math.PI / 2);
const missileGeo = new THREE.ConeGeometry(2.6, 22, 6).rotateX(Math.PI / 2);
const sparkGeo = new THREE.SphereGeometry(3, 6, 6);
const fwdZ = new THREE.Vector3(0, 0, 1);
const negZ = new THREE.Vector3(0, 0, -1);

function orientAlong(mesh, dir) { mesh.quaternion.setFromUnitVectors(fwdZ, dir); }

function spawnShot(origin, dir, colorHex, opts = {}) {
  const kind = opts.kind || 'pac';
  const mesh = new THREE.Mesh(kind === 'missile' ? missileGeo : laserGeo, new THREE.MeshBasicMaterial({ color: colorHex }));
  mesh.position.copy(origin);
  orientAlong(mesh, dir.clone().normalize());
  scene.add(mesh);
  shots.push({
    mesh, vel: dir.clone().normalize().multiplyScalar(opts.speed || 2600), prev: origin.clone(),
    life: opts.life || 1.6, mine: !!opts.mine, hostile: !!opts.hostile, dmg: opts.dmg || 12, kind, target: opts.target || null,
  });
}

const sparks = [];
function spawnSpark(pos, colorHex) {
  const m = new THREE.Mesh(sparkGeo, new THREE.MeshBasicMaterial({ color: colorHex, transparent: true }));
  m.position.copy(pos); m.scale.setScalar(1.6);
  scene.add(m); sparks.push({ mesh: m, life: 0.4, max: 0.4 });
}
function spawnTrail(pos, colorHex) {
  const m = new THREE.Mesh(sparkGeo, new THREE.MeshBasicMaterial({ color: colorHex, transparent: true }));
  m.position.copy(pos); m.scale.setScalar(1.1);
  scene.add(m); sparks.push({ mesh: m, life: 0.35, max: 0.35, vel: new THREE.Vector3() }); // zero vel = fade in place
}
function spawnExplosion(pos, colorHex) {
  Audio.boom();
  for (let i = 0; i < 16; i++) {
    const m = new THREE.Mesh(sparkGeo, new THREE.MeshBasicMaterial({ color: i % 3 ? colorHex : 0xffcc33, transparent: true }));
    m.position.copy(pos); m.scale.setScalar(1 + Math.random() * 2);
    const v = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize().multiplyScalar(120 + Math.random() * 220);
    scene.add(m); sparks.push({ mesh: m, life: 0.6, max: 0.6, vel: v });
  }
}

function distToSegment(p, a, b) {
  const abx = b.x - a.x, aby = b.y - a.y, abz = b.z - a.z;
  const apx = p.x - a.x, apy = p.y - a.y, apz = p.z - a.z;
  const len2 = abx*abx + aby*aby + abz*abz || 1;
  let t = (apx*abx + apy*aby + apz*abz) / len2;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const dx = apx - abx*t, dy = apy - aby*t, dz = apz - abz*t;
  return Math.sqrt(dx*dx + dy*dy + dz*dz);
}

// ----------------------------------------------------------------------------
// Networking
// ----------------------------------------------------------------------------
const remotes = new Map(); // id -> { ship, name, color, hp, dead, target:{pos,quat}, hasState }
const scores = new Map();  // id -> kills (derived from the hp 'by' stream)
let myId = null;
let started = false;
let lastDamageBy = 0;
const statusEl = document.getElementById('status');
const playersEl = document.getElementById('players');
const killfeed = document.getElementById('killfeed');
const labelsEl = document.getElementById('labels');

function makeLabel(name, colorHex) {
  const d = document.createElement('div');
  d.className = 'nameplate';
  d.style.color = '#' + colorHex.toString(16).padStart(6, '0');
  d.innerHTML = '<span class="nm"></span><span class="hpb"><i></i></span>';
  d.querySelector('.nm').textContent = name;
  labelsEl.appendChild(d);
  return d;
}

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
    ship: s, name: info.name, color: info.color, hp: info.hp ?? 100, dead: false,
    target: { pos: new THREE.Vector3(), quat: new THREE.Quaternion() }, hasState: false,
    label: makeLabel(info.name, info.color),
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
      addRemote(m); feed(`${m.name} entered the sector`);
      break;
    case 'leave': {
      const r = remotes.get(m.id);
      if (r) { scene.remove(r.ship); r.label.remove(); remotes.delete(m.id); updatePlayerCount(); }
      break;
    }
    case 'state': {
      const r = remotes.get(m.id); if (!r) return;
      r.target.pos.set(m.s[0], m.s[1], m.s[2]);
      r.target.quat.set(m.s[3], m.s[4], m.s[5], m.s[6]);
      if (!r.hasState) { r.ship.position.copy(r.target.pos); r.ship.quaternion.copy(r.target.quat); r.hasState = true; }
      break;
    }
    case 'shot': {
      const r = remotes.get(m.id);
      spawnShot(new THREE.Vector3(m.o[0], m.o[1], m.o[2]), new THREE.Vector3(m.d[0], m.d[1], m.d[2]),
        r ? r.color : 0xff5577, { kind: m.k === 'missile' ? 'missile' : 'pac', speed: m.k === 'missile' ? 1700 : 2600, life: m.k === 'missile' ? 3.5 : 1.6 });
      break;
    }
    case 'hit':
      applyDamage(m.dmg, m.from); break;
    case 'hp': {
      const r = remotes.get(m.id);
      if (r) {
        r.hp = m.hp;
        if (m.hp <= 0 && !r.dead) { r.dead = true; r.ship.visible = false; spawnExplosion(r.ship.position, r.color); }
        else if (m.hp > 0 && r.dead) { r.dead = false; r.ship.visible = true; }
      }
      if (m.hp <= 0) {
        scores.set(m.by, (scores.get(m.by) || 0) + 1);
        const who = remotes.get(m.id);
        if (m.by === myId) { player.kills = scores.get(myId); document.getElementById('kills').textContent = `KILLS: ${player.kills}`; feed(`YOU destroyed ${who ? who.name : 'a pilot'}`); }
        else feed(`${who ? who.name : 'A pilot'} was destroyed`);
      }
      break;
    }
    case 'name': {
      const r = remotes.get(m.id); if (r) { r.name = m.name; r.label.querySelector('.nm').textContent = m.name; } break;
    }
  }
}

function send(obj) { if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj)); }
function updatePlayerCount() { playersEl.textContent = `PILOTS ONLINE: ${remotes.size + 1}`; }
function feed(text) {
  const d = document.createElement('div');
  d.textContent = text; killfeed.appendChild(d);
  setTimeout(() => d.remove(), 4000);
}

function applyDamage(dmg, from) {
  if (!player.alive || player.invuln > 0) return;
  player.hp -= dmg;
  lastDamageBy = from;
  player.lastHitAt = tNow;
  hurtFlash = Math.min(1, hurtFlash + 0.5);
  if (player.hurtT <= 0) { spawnSpark(player.pos, 0xff5577); Audio.alarm(); player.hurtT = 0.15; } // throttle continuous-graze feedback
  if (player.hp <= 0) {
    player.hp = 0; player.alive = false;
    send({ type: 'hp', hp: 0, by: from });
    spawnExplosion(player.pos, 0x33ddff);
    ship.visible = false;
    feed('YOU WERE DESTROYED');
    setTimeout(respawn, 2200);
  } else {
    player.hpDirty = true;
  }
}

function respawn() {
  player.pos.set((Math.random() - 0.5) * 2000, 600, (Math.random() - 0.5) * 2000);
  player.quat.identity();
  player.speed = 260; player.hp = 100; player.missiles = 8;
  player.alive = true; player.invuln = 2.5; firing = false;
  ship.visible = true;
  document.getElementById('ammo').textContent = 'MSL: 8';
  send({ type: 'hp', hp: 100, by: 0 });
}

// ----------------------------------------------------------------------------
// Weapons
// ----------------------------------------------------------------------------
function fireCannon() {
  const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(player.quat);
  const muzzle = player.pos.clone().addScaledVector(fwd, 30);
  spawnShot(muzzle, fwd, 0x33ddff, { mine: true, dmg: 12, speed: 2600, life: 1.6, kind: 'pac' });
  send({ type: 'shot', o: [muzzle.x, muzzle.y, muzzle.z], d: [fwd.x, fwd.y, fwd.z], k: 'pac' });
  Audio.laser();
}
function nearestTarget(from, dir) {
  let best = null, bestScore = Infinity;
  const consider = (obj, pos, alive) => {
    if (!alive) return;
    const tox = pos.x - from.x, toy = pos.y - from.y, toz = pos.z - from.z;
    const dist = Math.hypot(tox, toy, toz); if (dist > 2600) return;
    const ang = (tox * dir.x + toy * dir.y + toz * dir.z) / (dist || 1);
    if (ang < 0.25) return;
    const score = dist * (2 - ang);
    if (score < bestScore) { bestScore = score; best = obj; }
  };
  for (const r of remotes.values()) consider(r, r.ship.position, r.hp > 0 && !r.dead);
  for (const t of turrets) consider(t, t.pos, t.alive);
  for (const e of enemies) consider(e, e.pos, e.alive);
  return best;
}
function tryFireMissile() {
  if (!started || !player.alive || player.boosting || player.missiles <= 0 || player.mslCd > 0) return;
  player.mslCd = 0.6; player.missiles--;
  document.getElementById('ammo').textContent = 'MSL: ' + player.missiles;
  const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(player.quat);
  const muzzle = player.pos.clone().addScaledVector(fwd, 28);
  const tgt = nearestTarget(muzzle, fwd);
  spawnShot(muzzle, fwd, 0xff9944, { mine: true, dmg: 34, speed: 1700, life: 3.5, kind: 'missile', target: tgt });
  send({ type: 'shot', o: [muzzle.x, muzzle.y, muzzle.z], d: [fwd.x, fwd.y, fwd.z], k: 'missile' });
  Audio.missile();
}

// ----------------------------------------------------------------------------
// Pickups (client-local shield / ammo crates)
// ----------------------------------------------------------------------------
const pickups = [];
function spawnPickup(kind) {
  const color = kind === 'shield' ? 0x66ff88 : 0xff9944;
  const geo = kind === 'shield' ? new THREE.OctahedronGeometry(16) : new THREE.BoxGeometry(22, 22, 22);
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.5, flatShading: true }));
  scene.add(mesh);
  const p = { mesh, kind };
  relocatePickup(p); pickups.push(p);
}
function relocatePickup(p) {
  const x = (Math.random() - 0.5) * WORLD * 0.7, z = (Math.random() - 0.5) * WORLD * 0.7;
  p.mesh.position.set(x, terrainHeight(x, z) + 130 + Math.random() * 220, z);
}
for (let i = 0; i < 8; i++) spawnPickup(i % 2 ? 'ammo' : 'shield');

// ----------------------------------------------------------------------------
// Launch / overlay / scoreboard
// ----------------------------------------------------------------------------
const overlay = document.getElementById('overlay');
const scoreboard = document.getElementById('scoreboard');
const scoreTable = document.getElementById('score-table');
const esc = s => String(s).replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));
function showScore(on) {
  if (!on) { scoreboard.classList.add('hidden'); return; }
  const rows = [{ name: myName + ' (you)', k: scores.get(myId) || 0 }];
  for (const [id, r] of remotes) rows.push({ name: r.name, k: scores.get(id) || 0 });
  rows.sort((a, b) => b.k - a.k);
  scoreTable.innerHTML = rows.map(r => `<tr><td>${esc(r.name)}</td><td class="k">${r.k}</td></tr>`).join('');
  scoreboard.classList.remove('hidden');
}
document.getElementById('launch').addEventListener('click', () => {
  myName = (document.getElementById('callsign').value || 'PILOT').toUpperCase().slice(0, 16);
  send({ type: 'name', name: myName });
  overlay.classList.add('hidden');
  started = true;
  player.invuln = 2.5;
  Audio.resume();
  if (!isTouch) renderer.domElement.requestPointerLock();
});

// ----------------------------------------------------------------------------
// HUD
// ----------------------------------------------------------------------------
const radar = document.getElementById('radar').getContext('2d');
const speedBar = document.getElementById('speed-bar');
const shieldBar = document.getElementById('shield-bar');
const altEl = document.getElementById('alt');
const warnEl = document.getElementById('warn');
const boostmsgEl = document.getElementById('boostmsg');
const targetsEl = document.getElementById('targets');
const boostBar = document.getElementById('boost-bar');
const hurtEl = document.getElementById('hurt');
const lockEl = document.getElementById('lock');
function addTarget() { player.targets++; targetsEl.textContent = 'TARGETS: ' + player.targets; }

function drawRadar() {
  const cx = 70, cy = 70, R = 64, range = 3000;
  radar.clearRect(0, 0, 140, 140);
  radar.strokeStyle = '#2af'; radar.globalAlpha = 0.5;
  radar.beginPath(); radar.arc(cx, cy, R, 0, 7); radar.stroke();
  radar.beginPath(); radar.moveTo(cx, cy - R); radar.lineTo(cx, cy + R); radar.moveTo(cx - R, cy); radar.lineTo(cx + R, cy); radar.stroke();
  radar.globalAlpha = 1;
  const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(player.quat);
  const heading = Math.atan2(fwd.x, -fwd.z);
  const cosH = Math.cos(-heading), sinH = Math.sin(-heading);
  const plot = (x, z, color, size) => {
    const dx = x - player.pos.x, dz = z - player.pos.z;
    if (Math.hypot(dx, dz) > range) return;
    const rx = (dx * cosH - dz * sinH) / range * R, rz = (dx * sinH + dz * cosH) / range * R;
    radar.fillStyle = color; radar.beginPath(); radar.arc(cx + rx, cy + rz, size, 0, 7); radar.fill();
  };
  for (const t of turrets) if (t.alive) plot(t.pos.x, t.pos.z, '#ff3344', 2);
  for (const e of enemies) if (e.alive) plot(e.pos.x, e.pos.z, '#ff7733', 2);
  for (const p of pickups) plot(p.mesh.position.x, p.mesh.position.z, p.kind === 'shield' ? '#66ff88' : '#ff9944', 2);
  for (const r of remotes.values()) if (!r.dead) plot(r.ship.position.x, r.ship.position.z, '#' + r.color.toString(16).padStart(6, '0'), 3);
  radar.fillStyle = '#7df9ff';
  radar.beginPath(); radar.moveTo(cx, cy - 5); radar.lineTo(cx - 4, cy + 4); radar.lineTo(cx + 4, cy + 4); radar.fill();
}

// ----------------------------------------------------------------------------
// Main loop
// ----------------------------------------------------------------------------
let last = performance.now();
let netAccum = 0;

function tick(now) {
  tNow = now;
  const dt = Math.min((now - last) / 1000, 0.05);
  last = now;

  if (started && player.alive) updateFlight(dt);
  updateRemotes(dt);
  updateTurrets(dt);
  updateEnemies(dt);
  updatePickups(dt);
  updateShots(dt);
  updateSparks(dt);
  updateLabels();
  updateLock();
  hurtFlash = Math.max(0, hurtFlash - dt * 2);
  hurtEl.style.opacity = hurtFlash.toFixed(3);

  netAccum += dt;
  if (started && netAccum >= 0.05) {
    netAccum = 0;
    if (player.alive) {
      const q = player.quat;
      send({ type: 'state', s: [
        +player.pos.x.toFixed(1), +player.pos.y.toFixed(1), +player.pos.z.toFixed(1),
        +q.x.toFixed(4), +q.y.toFixed(4), +q.z.toFixed(4), +q.w.toFixed(4),
      ]});
    }
    if (player.hpDirty) { player.hpDirty = false; send({ type: 'hp', hp: player.hp, by: lastDamageBy }); }
  }

  speedBar.style.width = `${THREE.MathUtils.clamp((player.speed - 120) / 580 * 100, 0, 100)}%`;
  shieldBar.style.width = `${player.hp}%`;
  shieldBar.style.background = player.hp < 25 ? '#ff5577' : '#66ff88';
  boostBar.style.width = `${player.boost}%`;
  drawRadar();

  renderer.render(scene, camera);
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);

function updateFlight(dt) {
  player.invuln = Math.max(0, player.invuln - dt);
  player.hurtT = Math.max(0, player.hurtT - dt);
  player.cooldown -= dt; player.mslCd -= dt;

  const boosting = isBoosting() && player.boost > 1;
  player.boosting = boosting;
  player.boost = boosting ? Math.max(0, player.boost - dt * 30) : Math.min(100, player.boost + dt * 18);
  let target = 260;
  if (keys['KeyW'] || keys['ArrowUp'] || touchThrottle > 0) target = 480;
  if (keys['KeyS'] || keys['ArrowDown'] || touchThrottle < 0) target = 150;
  if (boosting) target = 760;
  player.speed += (target - player.speed) * Math.min(dt * 2, 1);

  if (touchSteer) { yawInput = touchVec.x; pitchInput = touchVec.y; }
  const roll = (keys['KeyA'] || keys['ArrowLeft'] ? 1 : 0) - (keys['KeyD'] || keys['ArrowRight'] ? 1 : 0);
  const dQ = new THREE.Quaternion().setFromEuler(new THREE.Euler(pitchInput * dt * 1.6, yawInput * dt * 1.6, roll * dt * 1.8, 'XYZ'));
  player.quat.multiply(dQ).normalize();
  if (!touchSteer) { yawInput *= (1 - Math.min(dt * 3, 1)); pitchInput *= (1 - Math.min(dt * 3, 1)); }

  const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(player.quat);
  player.pos.addScaledVector(fwd, player.speed * dt);

  const lim = WORLD / 2 - 100;
  player.pos.x = THREE.MathUtils.clamp(player.pos.x, -lim, lim);
  player.pos.z = THREE.MathUtils.clamp(player.pos.z, -lim, lim);

  // Terrain collision
  const ground = terrainHeight(player.pos.x, player.pos.z);
  if (player.pos.y < ground + 18) {
    player.pos.y = ground + 18;
    applyDamage(26 * dt, 0);
    if (player.hp > 0) spawnSpark(player.pos, 0xffaa33);
  }
  if (player.pos.y > 3000) player.pos.y = 3000;

  // Pylon collision (solid towers)
  for (const py of pylons) {
    const dx = player.pos.x - py.x, dz = player.pos.z - py.z;
    const d = Math.hypot(dx, dz);
    if (d < py.radius && player.pos.y < py.top) {
      const push = py.radius - d + 2;
      player.pos.x += dx / (d || 1) * push;
      player.pos.z += dz / (d || 1) * push;
      applyDamage(22 * dt, 0);
      if (player.hp > 0) spawnSpark(player.pos, 0xffaa33);
    }
  }

  // Altimeter + pull-up warning
  const altitude = player.pos.y - ground;
  altEl.textContent = 'ALT ' + Math.max(0, Math.round(altitude));
  if (altitude < 110 && fwd.y < -0.04) {
    warnEl.classList.add('on');
    player.alarmT -= dt;
    if (player.alarmT <= 0) { Audio.alarm(); player.alarmT = 0.35; }
  } else warnEl.classList.remove('on');
  boostmsgEl.classList.toggle('on', boosting);

  // Slow shield regen when out of combat
  if (player.hp < 100 && tNow - player.lastHitAt > 4000) { player.hp = Math.min(100, player.hp + 6 * dt); player.hpDirty = true; }

  // Engine trail
  player.trailT -= dt;
  if (player.trailT <= 0) {
    player.trailT = 0.03;
    spawnTrail(new THREE.Vector3(0, 0, 18).applyQuaternion(player.quat).add(player.pos), boosting ? 0xffcc33 : 0x66ccff);
  }

  // Ship mesh + invuln blink
  ship.position.copy(player.pos);
  ship.quaternion.copy(player.quat);
  ship.visible = camMode === 1 ? false : (player.invuln > 0 ? (Math.floor(tNow / 100) % 2 === 0) : true);
  ship.userData.glow.scale.setScalar(0.6 + (player.speed / 700) + (boosting ? 0.6 : 0));

  // Camera (chase or cockpit)
  tmpV.copy(camMode === 1 ? camCockpit : camOffset).applyQuaternion(player.quat).add(player.pos);
  camera.position.lerp(tmpV, Math.min(dt * (camMode === 1 ? 12 : 6), 1));
  tmpQ.copy(player.quat);
  camera.quaternion.slerp(tmpQ, Math.min(dt * 6, 1));

  // Cannon (disabled during afterburner — as in the original)
  if (firing && !boosting && player.cooldown <= 0) { player.cooldown = 0.12; fireCannon(); }
}

function updateRemotes(dt) {
  for (const r of remotes.values()) {
    if (!r.hasState) continue;
    r.ship.position.lerp(r.target.pos, Math.min(dt * 10, 1));
    r.ship.quaternion.slerp(r.target.quat, Math.min(dt * 10, 1));
  }
}

function updateTurrets(dt) {
  for (const t of turrets) {
    if (!t.alive) { t.respawn -= dt; if (t.respawn <= 0) { t.alive = true; t.hp = 30; t.core.visible = true; } continue; }
    t.core.rotation.y += dt;
    if (!started || !player.alive || player.invuln > 0) continue;
    if (t.pos.distanceTo(player.pos) < 1900) {
      t.cd -= dt;
      if (t.cd <= 0) {
        t.cd = 1.3 + Math.random() * 0.9;
        const dir = player.pos.clone().sub(t.pos);
        dir.x += (Math.random() - 0.5) * 90; dir.y += (Math.random() - 0.5) * 90; dir.z += (Math.random() - 0.5) * 90;
        spawnShot(t.pos.clone(), dir.normalize(), 0xff3344, { hostile: true, dmg: 8, speed: 1100, life: 3, kind: 'pac' });
      }
    }
  }
}

function updateEnemies(dt) {
  for (const e of enemies) {
    if (!e.alive) { e.respawn -= dt; if (e.respawn <= 0) spawnEnemy(e); continue; }
    const ground = terrainHeight(e.pos.x, e.pos.z);
    if (started && player.alive) {
      const to = player.pos.clone().sub(e.pos);
      const dist = to.length() || 1;
      const desired = to.clone().multiplyScalar(1 / dist);
      if (e.pos.y < ground + 140) desired.y += 0.8;   // climb away from terrain
      if (dist < 350) desired.multiplyScalar(-1);      // peel off if too close
      desired.normalize();
      e.dir.lerp(desired, Math.min(dt * 1.2, 1)).normalize();
      e.cd -= dt;
      if (player.invuln <= 0 && dist < 2200 && e.dir.dot(to.multiplyScalar(1 / dist)) > 0.9 && e.cd <= 0) {
        e.cd = 1.1 + Math.random() * 0.8;
        const d = player.pos.clone().sub(e.pos);
        d.x += (Math.random() - 0.5) * 70; d.y += (Math.random() - 0.5) * 70; d.z += (Math.random() - 0.5) * 70;
        spawnShot(e.pos.clone(), d.normalize(), 0xff7733, { hostile: true, dmg: 7, speed: 1300, life: 2.6, kind: 'pac' });
      }
    }
    e.pos.addScaledVector(e.dir, e.speed * dt);
    if (e.pos.y < ground + 60) e.pos.y = ground + 60;
    if (e.pos.y > 2500) e.pos.y = 2500;
    const lim = WORLD / 2 - 200;
    if (e.pos.x > lim || e.pos.x < -lim) { e.pos.x = THREE.MathUtils.clamp(e.pos.x, -lim, lim); e.dir.x *= -1; }
    if (e.pos.z > lim || e.pos.z < -lim) { e.pos.z = THREE.MathUtils.clamp(e.pos.z, -lim, lim); e.dir.z *= -1; }
    e.ship.position.copy(e.pos);
    e.ship.quaternion.setFromUnitVectors(negZ, e.dir);
  }
}

function updateLabels() {
  for (const r of remotes.values()) {
    const el = r.label;
    if (r.dead || !r.hasState) { el.style.display = 'none'; continue; }
    tmpV.copy(r.ship.position); tmpV.y += 32;
    tmpV.project(camera);
    if (tmpV.z > 1) { el.style.display = 'none'; continue; }
    el.style.display = 'block';
    el.style.transform = `translate(-50%,-50%) translate(${(tmpV.x * 0.5 + 0.5) * innerWidth}px, ${(-tmpV.y * 0.5 + 0.5) * innerHeight}px)`;
    el.querySelector('.hpb i').style.width = Math.max(0, r.hp) + '%';
  }
}

function updateLock() {
  if (!started || !player.alive) { lockEl.style.display = 'none'; return; }
  const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(player.quat);
  const t = nearestTarget(player.pos, fwd);
  if (!t) { lockEl.style.display = 'none'; return; }
  tmpV.copy(targetPos(t)); tmpV.project(camera);
  if (tmpV.z > 1) { lockEl.style.display = 'none'; return; }
  lockEl.style.display = 'block';
  lockEl.style.transform = `translate(-50%,-50%) translate(${(tmpV.x * 0.5 + 0.5) * innerWidth}px, ${(-tmpV.y * 0.5 + 0.5) * innerHeight}px)`;
}

function updatePickups(dt) {
  for (const p of pickups) {
    p.mesh.rotation.y += dt * 1.5; p.mesh.rotation.x += dt * 0.7;
    if (started && player.alive && p.mesh.position.distanceTo(player.pos) < 42) {
      if (p.kind === 'shield') { player.hp = Math.min(100, player.hp + 35); player.hpDirty = true; feed('+SHIELD'); }
      else { player.missiles = Math.min(12, player.missiles + 4); document.getElementById('ammo').textContent = 'MSL: ' + player.missiles; feed('+MISSILES'); }
      Audio.pickup();
      relocatePickup(p);
    }
  }
}

const targetPos = t => t.ship ? t.ship.position : t.pos;
const targetAlive = t => t.ship ? (t.hp > 0 && !t.dead) : t.alive;

function updateShots(dt) {
  for (let i = shots.length - 1; i >= 0; i--) {
    const s = shots[i];
    if (s.kind === 'missile' && s.target && targetAlive(s.target)) {
      const speed = s.vel.length();
      const desired = targetPos(s.target).clone().sub(s.mesh.position).normalize();
      const cur = s.vel.clone().normalize().lerp(desired, Math.min(dt * 2.2, 1)).normalize();
      s.vel.copy(cur.multiplyScalar(speed));
      orientAlong(s.mesh, cur);
    }
    s.prev.copy(s.mesh.position);
    s.mesh.position.addScaledVector(s.vel, dt);
    s.life -= dt;
    let dead = s.life <= 0;

    if (!dead && s.mine) {
      for (const [id, r] of remotes) {
        if (r.hp <= 0 || r.dead) continue;
        if (distToSegment(r.ship.position, s.prev, s.mesh.position) < 30) {
          send({ type: 'hit', target: id, dmg: s.dmg });
          spawnExplosion(s.mesh.position, r.color); dead = true; break;
        }
      }
      if (!dead) for (const t of turrets) {
        if (!t.alive) continue;
        if (distToSegment(t.pos, s.prev, s.mesh.position) < 26) {
          t.hp -= s.dmg; spawnSpark(s.mesh.position, 0xff3344);
          if (t.hp <= 0) { t.alive = false; t.respawn = 8; t.core.visible = false; spawnExplosion(t.pos, 0xff5533); addTarget(); }
          dead = true; break;
        }
      }
      if (!dead) for (const e of enemies) {
        if (!e.alive) continue;
        if (distToSegment(e.pos, s.prev, s.mesh.position) < 24) {
          e.hp -= s.dmg; spawnSpark(s.mesh.position, 0xff5533);
          if (e.hp <= 0) { e.alive = false; e.respawn = 6; e.ship.visible = false; spawnExplosion(e.pos, 0xff5533); addTarget(); }
          dead = true; break;
        }
      }
    }
    if (!dead && s.hostile && started && player.alive && player.invuln <= 0) {
      if (distToSegment(player.pos, s.prev, s.mesh.position) < 24) { applyDamage(s.dmg, 0); dead = true; }
    }
    if (dead) { scene.remove(s.mesh); s.mesh.material.dispose(); shots.splice(i, 1); }
  }
}

function updateSparks(dt) {
  for (let i = sparks.length - 1; i >= 0; i--) {
    const s = sparks[i];
    s.life -= dt;
    if (s.vel) { s.mesh.position.addScaledVector(s.vel, dt); s.vel.multiplyScalar(0.92); }
    else s.mesh.scale.multiplyScalar(1 + dt * 8);
    s.mesh.material.opacity = Math.max(s.life / s.max, 0);
    if (s.life <= 0) { scene.remove(s.mesh); s.mesh.material.dispose(); sparks.splice(i, 1); }
  }
}
