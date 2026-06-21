// Terminal Velocity 3JS — authoritative-relay multiplayer server.
// Serves the static client and relays player state / combat events over WebSocket.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(__dirname, 'public');
const PORT = process.env.PORT || 8080;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

// ---- Static file server ----------------------------------------------------
const server = http.createServer((req, res) => {
  let urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
  if (urlPath === '/') urlPath = '/index.html';
  const filePath = path.join(PUBLIC, path.normalize(urlPath));
  if (!filePath.startsWith(PUBLIC)) { res.writeHead(403); return res.end('Forbidden'); }
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
    res.end(data);
  });
});

// ---- Multiplayer relay ------------------------------------------------------
const wss = new WebSocketServer({ server });
const players = new Map(); // id -> { ws, name, color, state, hp }

let nextId = 1;
const COLORS = [0x33ddff, 0xff5577, 0x66ff88, 0xffcc33, 0xcc88ff, 0xff8844, 0x44ffdd, 0xff44aa];

function broadcast(obj, exceptId) {
  const msg = JSON.stringify(obj);
  for (const [id, p] of players) {
    if (id === exceptId) continue;
    if (p.ws.readyState === p.ws.OPEN) p.ws.send(msg);
  }
}

wss.on('connection', (ws) => {
  const id = nextId++;
  const color = COLORS[(id - 1) % COLORS.length];
  const player = { ws, name: `Pilot-${id}`, color, hp: 100, state: null };
  players.set(id, player);

  // Snapshot of everyone already in the world.
  const roster = [];
  for (const [pid, p] of players) {
    if (pid === id) continue;
    roster.push({ id: pid, name: p.name, color: p.color, hp: p.hp, state: p.state });
  }
  ws.send(JSON.stringify({ type: 'init', id, color, players: roster }));
  broadcast({ type: 'join', id, name: player.name, color, hp: player.hp }, id);

  ws.on('message', (raw) => {
    let m;
    try { m = JSON.parse(raw); } catch { return; }
    switch (m.type) {
      case 'state':
        player.state = m.s;
        broadcast({ type: 'state', id, s: m.s }, id);
        break;
      case 'shot':
        broadcast({ type: 'shot', id, o: m.o, d: m.d, k: m.k }, id);
        break;
      case 'hit': {
        // m.target took damage from this player. Relay to the target who is
        // authoritative over its own health.
        const target = players.get(m.target);
        if (target && target.ws.readyState === target.ws.OPEN) {
          target.ws.send(JSON.stringify({ type: 'hit', from: id, dmg: m.dmg }));
        }
        break;
      }
      case 'hp':
        player.hp = m.hp;
        broadcast({ type: 'hp', id, hp: m.hp, by: m.by }, id);
        break;
      case 'name':
        player.name = String(m.name || player.name).slice(0, 16);
        broadcast({ type: 'name', id, name: player.name }, id);
        break;
    }
  });

  ws.on('close', () => {
    players.delete(id);
    broadcast({ type: 'leave', id });
  });
});

server.listen(PORT, () => {
  console.log(`Terminal Velocity 3JS running:  http://localhost:${PORT}`);
});
