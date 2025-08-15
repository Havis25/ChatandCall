// server/index.js
// Simple Socket.IO DM server (chat + mock call) with presence & debug logs

const http = require("http");
const express = require("express");
const cors = require("cors");
const { Server } = require("socket.io");

const APP_NAME = "bni-care-realtime";
const PORT = process.env.PORT || 4000;
const CORS_ORIGIN = process.env.CORS_ORIGIN || "*";

const app = express();
app.use(cors({ origin: CORS_ORIGIN }));

app.get("/", (_req, res) => res.send("OK"));
app.get("/status", (_req, res) =>
  res.json({ app: APP_NAME, status: "ok", time: new Date().toISOString() })
);

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: CORS_ORIGIN },
  pingInterval: 25000,
  pingTimeout: 20000,
  allowEIO3: true,
});

io.engine.on("connection_error", (err) => {
  console.log(
    "[engine] connection_error",
    err?.code,
    err?.message,
    err?.context ? JSON.stringify(err.context) : ""
  );
});

// userId -> Set<socketId>
const userSockets = new Map();
const addUserSocket = (userId, sid) => {
  if (!userSockets.has(userId)) userSockets.set(userId, new Set());
  userSockets.get(userId).add(sid);
};
const removeUserSocket = (userId, sid) => {
  const set = userSockets.get(userId);
  if (!set) return;
  set.delete(sid);
  if (set.size === 0) userSockets.delete(userId);
};
const dmRoomOf = (a, b) => `dm:${[a, b].sort().join(":")}`;

function peersIn(room) {
  const r = io.sockets.adapter.rooms.get(room);
  if (!r) return [];
  return Array.from(r).map((sid) => {
    const s = io.sockets.sockets.get(sid);
    return { sid, userId: s?.data?.userId || "unknown" };
  });
}
function emitPresence(room) {
  io.to(room).emit("presence:list", { room, peers: peersIn(room) });
}

io.on("connection", (socket) => {
  console.log(
    "connected:",
    socket.id,
    "transport:",
    socket.conn.transport.name
  );
  socket.conn.on("upgrade", () => {
    console.log("transport upgraded to:", socket.conn.transport.name);
  });

  // ---- IDENTITAS
  socket.on("auth:register", ({ userId }) => {
    if (!userId) return;
    socket.data.userId = userId;
    addUserSocket(userId, socket.id);
    socket.emit("auth:ok", { userId });
    console.log(`[auth] ${socket.id} -> ${userId}`);
  });

  // ---- BUKA DM BERDASAR ID
  socket.on("dm:open", ({ toUserId }) => {
    const from = socket.data.userId;
    if (!from || !toUserId) return;
    const room = dmRoomOf(from, toUserId);
    console.log(`[dm:open] ${from} -> ${toUserId} = ${room}`);

    socket.join(room); // inisiator join
    emitPresence(room);
    socket.emit("dm:pending", { room, toUserId });

    const targets = userSockets.get(toUserId);
    if (targets && targets.size > 0) {
      for (const sid of targets) {
        io.to(sid).emit("dm:request", { room, fromUserId: from });
      }
    }
  });

  socket.on("dm:join", ({ room }) => {
    if (!room) return;
    socket.join(room);
    emitPresence(room);
    const set = io.sockets.adapter.rooms.get(room);
    if (set && set.size >= 2) {
      io.to(room).emit("dm:ready", { room });
    }
  });

  // ---- Presence (umum)
  socket.on("presence:get", ({ room }) => {
    if (!room) return;
    socket.emit("presence:list", { room, peers: peersIn(room) });
  });

  // ---- Chat (TIDAK echo ke pengirim -> hindari duplikat)
  socket.on("chat:send", (msg) => {
    if (!msg?.room) return;
    socket.to(msg.room).emit("chat:new", msg); // <-- perbaikan utama
  });

  socket.on("typing", ({ room }) => {
    if (!room) return;
    socket.to(room).emit("typing");
  });

  // ---- Mock call (opsional)
  socket.on("call:invite", ({ room }) => {
    if (!room) return;
    socket.to(room).emit("call:ringing", { fromUserId: socket.data.userId });
  });
  socket.on("call:accept", ({ room }) => {
    if (!room) return;
    socket.to(room).emit("call:accepted", {});
  });
  socket.on("call:hangup", ({ room }) => {
    if (!room) return;
    socket.to(room).emit("call:ended", {});
  });
  socket.on("call:frame", ({ room, data }) => {
    if (!room || !data) return;
    socket.to(room).emit("call:frame", { data });
  });

  // ---- Join/leave generic (kalau dipakai)
  socket.on("join", ({ room, userId }) => {
    if (!room) return;
    socket.join(room);
    if (userId) socket.data.userId = userId;
    emitPresence(room);
  });
  socket.on("leave", ({ room }) => {
    if (!room) return;
    socket.leave(room);
    emitPresence(room);
  });

  socket.on("disconnect", (reason) => {
    const uid = socket.data.userId;
    if (uid) removeUserSocket(uid, socket.id);
    console.log("disconnected:", socket.id, "reason:", reason);
  });
});

server.listen(PORT, () => {
  console.log(`${APP_NAME} listening on http://0.0.0.0:${PORT}`);
});
