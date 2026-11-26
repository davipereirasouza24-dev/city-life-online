const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const PORT = process.env.PORT || 3000;
const MAX = +process.env.MAX_PLAYERS || 16;
const app = express();
const server = http.createServer(app);
const io = new Server(server);
app.use(express.static('public'));

// ---------- Mapa ----------
const B = 64, ROAD = 14, S = B - ROAD, N = 4, LIMIT = (N + 0.5) * B, DT = 1 / 30;
let seed = 7;
const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const R = (a, b) => a + Math.random() * (b - a);
const r2 = (v) => Math.round(v * 100) / 100;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const buildings = [], trees = [], parks = [];
for (let i = -N; i <= N; i++) for (let j = -N; j <= N; j++) {
  const cx = i * B, cz = j * B, d = Math.max(Math.abs(i), Math.abs(j));
  if (d >= 2 && (i + j + 8) % 4 === 0) {
    parks.push([cx, cz]);
    for (let t = 0; t < 8; t++) trees.push([cx + (rnd() - 0.5) * (S - 8), cz + (rnd() - 0.5) * (S - 8)]);
    continue;
  }
  for (const a of [-1, 1]) for (const b of [-1, 1]) {
    const tw = d <= 1, w = tw ? 20 : 14 + rnd() * 4;
    buildings.push({ x: cx + a * S / 4, z: cz + b * S / 4, w, h: tw ? 40 + rnd() * 80 : 6 + rnd() * 4, c: Math.floor(rnd() * 360), t: tw ? 1 : 0 });
  }
}
const map = { B, ROAD, S, N, LIMIT, buildings, trees, parks };

function collide(o, r) {
  let hit = false;
  for (const b of buildings) {
    const h = b.w / 2;
    const cx = clamp(o.x, b.x - h, b.x + h), cz = clamp(o.z, b.z - h, b.z + h);
    const ox = o.x - cx, oz = o.z - cz, d = Math.hypot(ox, oz);
    if (d < r) {
      hit = true;
      if (d > 1e-4) { o.x += (ox / d) * (r - d); o.z += (oz / d) * (r - d); } else o.x = b.x - h - r;
    }
  }
  o.x = clamp(o.x, -LIMIT, LIMIT); o.z = clamp(o.z, -LIMIT, LIMIT);
  return hit;
}

// ---------- Entidades ----------
const players = new Map();
const cars = [], traffic = [], npcs = [];
for (let i = 0; i < 10; i++) cars.push({ id: 'c' + i, x: ((i % 5) - 2 + 0.5) * B - 3.2, z: Math.floor(i / 5) * B, a: 0, sp: 0, drv: null, hue: Math.floor(R(0, 360)) });
for (let i = 0; i < 12; i++) traffic.push({ id: 't' + i, ax: i % 2, s: Math.random() < 0.5 ? -1 : 1, rc: (Math.floor(R(-N - 1, N + 1)) + 0.5) * B, p: R(-LIMIT, LIMIT), hue: Math.floor(R(0, 360)), x: 0, z: 0, a: 0 });
for (let i = 0; i < 40; i++) npcs.push({ x: (Math.floor(R(-N - 1, N + 1)) + 0.5) * B + (Math.random() < 0.5 ? -8 : 8), z: R(-LIMIT, LIMIT), a: 0, t: 0, hue: Math.floor(R(0, 360)) });

const clampIn = (v) => clamp(+v || 0, -1, 1);

io.on('connection', (socket) => {
  let cnt = 0, lastChat = 0;
  const timer = setInterval(() => (cnt = 0), 1000);

  socket.on('join', (name) => {
    if (players.has(socket.id)) return;
    if (players.size >= MAX) return socket.emit('full');
    const n = String(name || '').replace(/[<>&"']/g, '').trim().slice(0, 16) || 'Jogador';
    players.set(socket.id, { id: socket.id, n, x: 24, z: 5, a: 0, car: null, in: { x: 0, z: 0, run: false, t: 0, s: 0 }, color: Math.floor(R(0, 360)) });
    socket.emit('init', { id: socket.id, map });
    io.emit('chat', { n: 'Sistema', t: n + ' entrou na cidade.' });
  });

  socket.on('input', (i) => {
    const p = players.get(socket.id);
    if (!p || !i || ++cnt > 60) return;
    p.in = { x: clampIn(i.x), z: clampIn(i.z), run: !!i.run, t: clampIn(i.t), s: clampIn(i.s) };
  });

  socket.on('enter', () => {
    const p = players.get(socket.id);
    if (!p || ++cnt > 60) return;
    if (p.car) {
      const c = p.car; c.drv = null; p.car = null;
      p.x = c.x + Math.cos(c.a) * 2.6; p.z = c.z - Math.sin(c.a) * 2.6;
      return;
    }
    let best = null, bd = 5;
    for (const c of cars) { const d = Math.hypot(c.x - p.x, c.z - p.z); if (!c.drv && d < bd) { best = c; bd = d; } }
    if (best) { best.drv = p.id; p.car = best; }
  });

  socket.on('chat', (t) => {
    const p = players.get(socket.id), now = Date.now();
    if (!p || now - lastChat < 500) return;
    t = String(t || '').replace(/[<>&"']/g, '').trim().slice(0, 140);
    if (!t) return;
    lastChat = now;
    io.emit('chat', { n: p.n, t });
  });

  socket.on('disconnect', () => {
    clearInterval(timer);
    const p = players.get(socket.id);
    if (!p) return;
    if (p.car) p.car.drv = null;
    players.delete(socket.id);
    io.emit('chat', { n: 'Sistema', t: p.n + ' saiu.' });
  });
});

// ---------- Simulação (30 Hz, servidor manda em tudo) ----------
setInterval(() => {
  for (const c of cars) {
    const p = c.drv ? players.get(c.drv) : null;
    const t = p ? p.in.t : 0, s = p ? p.in.s : 0;
    if (t && (c.sp === 0 || Math.sign(t) === Math.sign(c.sp))) c.sp += t * 14 * DT;
    else if (t) c.sp += t * 26 * DT;
    else c.sp -= Math.sign(c.sp) * Math.min(Math.abs(c.sp), (p ? 5 : 20) * DT);
    c.sp = clamp(c.sp, -8, 28);
    c.a -= s * 1.6 * DT * clamp(c.sp / 6, -1, 1);
    c.x += Math.sin(c.a) * c.sp * DT; c.z += Math.cos(c.a) * c.sp * DT;
    if (collide(c, 2.2)) c.sp *= 0.4;
  }
  for (const p of players.values()) {
    if (p.car) { p.x = p.car.x; p.z = p.car.z; continue; }
    const { x, z, run } = p.in, len = Math.hypot(x, z);
    if (len) {
      const sp = run ? 9 : 4.5;
      p.x += (x / len) * sp * DT; p.z += (z / len) * sp * DT; p.a = Math.atan2(x, z);
    }
    collide(p, 0.5);
  }
  for (const c of traffic) {
    const p2 = c.p + c.s * 9 * DT, q1 = Math.floor(c.p / B - 0.5), q2 = Math.floor(p2 / B - 0.5);
    if (q1 !== q2 && Math.random() < 0.4) {
      const n = Math.max(q1, q2), old = c.rc;
      if (Math.abs((n + 0.5) * B) <= LIMIT) { c.rc = (n + 0.5) * B; c.p = old; c.ax = 1 - c.ax; c.s = Math.random() < 0.5 ? -1 : 1; }
      else c.p = p2;
    } else c.p = p2;
    if (Math.abs(c.p) > LIMIT) { c.p = clamp(c.p, -LIMIT, LIMIT); c.s = -c.s; }
    const dx = c.ax === 0 ? c.s : 0, dz = c.ax === 1 ? c.s : 0;
    c.a = Math.atan2(dx, dz);
    const bx = c.ax === 0 ? c.p : c.rc, bz = c.ax === 0 ? c.rc : c.p;
    c.x = bx - Math.cos(c.a) * 3.2; c.z = bz + Math.sin(c.a) * 3.2;
  }
  for (const n of npcs) {
    n.t -= DT;
    if (n.t <= 0) { n.a = Math.floor(Math.random() * 4) * Math.PI / 2; n.t = R(2, 6); }
    n.x += Math.sin(n.a) * 1.4 * DT; n.z += Math.cos(n.a) * 1.4 * DT;
    if (collide(n, 0.5)) n.t = 0;
  }
  io.emit('state', {
    p: [...players.values()].map((p) => ({ id: p.id, n: p.n, x: r2(p.x), z: r2(p.z), a: r2(p.a), h: p.color, car: p.car ? p.car.id : null })),
    c: [...cars, ...traffic].map((c) => [c.id, r2(c.x), r2(c.z), r2(c.a), c.hue, c.drv || 0]),
    n: npcs.map((n) => [r2(n.x), r2(n.z), r2(n.a), n.hue]),
  });
}, 1000 / 30);

server.listen(PORT, () => console.log('City Life Online 3D em http://localhost:' + PORT));
