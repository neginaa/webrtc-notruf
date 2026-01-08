import express from 'express';
import http from 'http';
import { WebSocketServer } from 'ws';
import crypto from 'crypto';

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

// Statisches Frontend bereitstellen (public Ordner)
app.use(express.static('public'));

// Einfache Raumverwaltung im Speicher
const rooms = new Map(); // roomId -> { clients:Set, createdAt, ttlMs }
const ROOM_TTL_MS = 10 * 60 * 1000; // 10 Minuten

function cleanupRooms() {
  const now = Date.now();
  for (const [id, room] of rooms) {
    if (now - room.createdAt > room.ttlMs || room.clients.size === 0) {
      rooms.delete(id);
    }
  }
}
setInterval(cleanupRooms, 60 * 1000);

function ensureRoom(roomId) {
  if (!rooms.has(roomId)) {
    rooms.set(roomId, { clients: new Set(), createdAt: Date.now(), ttlMs: ROOM_TTL_MS });
  }
  return rooms.get(roomId);
}

// WebSocket Signaling
wss.on('connection', (ws, req) => {
  const params = new URL(req.url, 'http://localhost').searchParams;
  const roomId = params.get('room');
  const role = params.get('role') || 'unknown';

  if (!roomId) {
    ws.close(1008, 'room required');
    return;
  }

  const room = ensureRoom(roomId);
  room.clients.add(ws);

  ws.send(JSON.stringify({ type: 'hello', roomId, role, clients: room.clients.size }));
  broadcast(roomId, { type: 'peer-join', role });

ws.on('message', (data, isBinary) => {
  // Immer in String umwandeln und validieren
  let text;
  try {
    text = typeof data === 'string' ? data : data.toString();
    JSON.parse(text);           // validieren
  } catch {
    return; // keine gültige JSON-Nachricht -> ignorieren
  }
  // an alle anderen als Text senden
  for (const client of room.clients) {
    if (client !== ws && client.readyState === 1) {
      client.send(text);        
    }
  }
});


  ws.on('close', () => {
    room.clients.delete(ws);
    broadcast(roomId, { type: 'peer-leave', role });
  });
});

function broadcast(roomId, obj) {
  const room = rooms.get(roomId);
  if (!room) return;
  const msg = JSON.stringify(obj);
  for (const client of room.clients) {
    if (client.readyState === 1) client.send(msg);
  }
}

// Route: neue Raum-ID erzeugen
app.get('/api/new-room', (req, res) => {
  const id = crypto.randomBytes(3).toString('hex').toUpperCase();
  ensureRoom(id);
  res.json({ roomId: id });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server läuft auf http://localhost:${PORT}`);
});
