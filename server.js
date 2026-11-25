const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const PORT = process.env.PORT || 3000;
const MAX_PLAYERS = +process.env.MAX_PLAYERS || 16;
const app = express();
const server = http.createServer(app);
const io = new Server(server);
app.use(express.static('public'));

// ---------- Mapa (gerado no servidor, igual para todos) ----------
const B = 400, ROAD = 90, S = B - ROAD, N = 4, LIMIT = (N + 0.5) * B;
let seed = 7;
const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const blocks = [], buildings = [], trees = [];
for (let i = -N; i <= N; i++) for (let j = -N; j <= N; j++) {
  const cx = i * B, cy = j * B;
  const park = Math.max(Math.abs(i), Math.abs(j)) >= 2 && (i + j + 8) % 4 === 0;
  blocks.push({ x: cx - S / 2, y: cy - S / 2, w: S, h: S, park });
  if (park) {
    for (let t = 0; t < 14; t++) trees.push([cx + (rnd() - 0.5) * (S - 30), cy + (rnd() - 0.5) * (S - 30)]);
    continue;
  }
  for (const a of [-1, 1]) for (const b of [-1, 1]) {
    const w = 110 + rnd() * 30;
    buildings.push({ x: cx + a * 75 - w / 2, y: cy + b * 75 - w / 2, w, h: w, c: Math.floor(rnd() * 360) });
  }
}

// ---------- Jogadores ----------
const players = new Map();
const COLORS = ['#e74c3c', '#3498db', '#2ecc71', '#f1c40f', '#9b59b6', '#e67e22', '#1abc9c', '#ecf0f1'];
const clean = (s, n) => String(s || '').replace(/[<>&"']/g, '').trim().slice(0, n);

io.on('connection', (socket) => {
  let msgCount = 0, lastChat = 0;
  const rate = setInterval(() => (msgCount = 0), 1000);

  socket.on('join', (name) => {
    if (players.has(socket.id)) return;
    if (players.size >= MAX_PLAYERS) return socket.emit('full');
    const p = {
      id: socket.id, n: clean(name, 16) || 'Jogador',
      x: 0, y: B / 2 + 0, in: { x: 0, y: 0, run: false },
      color: COLORS[players.size % COLORS.length],
    };
    players.set(socket.id, p);
    socket.emit('init', { id: socket.id, map: { B, ROAD, N, LIMIT, blocks, buildings, trees } });
    io.emit('chat', { n: 'Sistema', t: p.n + ' entrou na cidade.' });
  });

  socket.on('input', (i) => {
    if (++msgCount > 60) return; // limite de mensagens
    const p = players.get(socket.id);
    if (!p || !i) return;
    p.in = { x: Math.sign(+i.x || 0), y: Math.sign(+i.y || 0), run: !!i.run };
  });

  socket.on('chat', (t) => {
    const p = players.get(socket.id), now = Date.now();
    if (!p || now - lastChat < 500) return;
    t = clean(t, 140);
    if (!t) return;
    lastChat = now;
    io.emit('chat', { n: p.n, t });
  });

  socket.on('disconnect', () => {
    clearInterval(rate);
    const p = players.get(socket.id);
    if (p) { players.delete(socket.id); io.emit('chat', { n: 'Sistema', t: p.n + ' saiu.' }); }
  });
});

// ---------- Simulação autoritativa (30 Hz) ----------
const R = 12, DT = 1 / 30;
setInterval(() => {
  for (const p of players.values()) {
    let { x, y, run } = p.in;
    const len = Math.hypot(x, y);
    if (len) {
      const sp = run ? 300 : 170;
      p.x += (x / len) * sp * DT; p.y += (y / len) * sp * DT;
      p.a = Math.atan2(y, x);
    }
    for (const b of buildings) {
      const cx = Math.max(b.x, Math.min(p.x, b.x + b.w)), cy = Math.max(b.y, Math.min(p.y, b.y + b.h));
      const ox = p.x - cx, oy = p.y - cy, d = Math.hypot(ox, oy);
      if (d < R) {
        if (d > 1e-4) { p.x += (ox / d) * (R - d); p.y += (oy / d) * (R - d); }
        else p.y = b.y - R;
      }
    }
    p.x = Math.max(-LIMIT, Math.min(LIMIT, p.x));
    p.y = Math.max(-LIMIT, Math.min(LIMIT, p.y));
  }
  io.emit('state', [...players.values()].map((p) => ({ id: p.id, n: p.n, x: Math.round(p.x), y: Math.round(p.y), c: p.color })));
}, 1000 / 30);

server.listen(PORT, () => console.log('City Life Online 2D em http://localhost:' + PORT));
