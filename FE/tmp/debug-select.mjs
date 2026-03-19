import { io } from "socket.io-client";

const socket = io("http://localhost:3000", {
  transports: ["websocket"],
  auth: { token: "human-dev-token" },
  query: { roomId: "dbg-sel-3", playerId: "human-dev", playerKind: "human" },
});

socket.on("connect", () => {
  console.log("CONNECTED");
  socket.emit("JOIN_ROOM", {
    roomId: "dbg-sel-3",
    playerId: "human-dev",
    playerName: "human-dev",
    playerKind: "human",
  });
  setTimeout(() => socket.emit("START_MATCH"), 500);
  setTimeout(() => {
    console.log(">>> SELECT_LEVEL 1");
    socket.emit("SELECT_LEVEL", { levelId: 1 });
  }, 4500);
  setTimeout(() => process.exit(0), 8000);
});

socket.on("ROOM_JOINED", (p) =>
  console.log("ROOM_JOINED phase=" + p.phase + " slot=" + p.slot + " host=" + p.hostPlayerId)
);
socket.on("ROOM_PHASE_CHANGED", (p) => console.log("PHASE_CHANGED phase=" + p.phase));
socket.on("LEVEL_SELECTED", (p) => console.log("LEVEL_SELECTED id=" + p.levelId));
socket.on("engine_error", (p) => console.log("ENGINE_ERROR " + JSON.stringify(p)));
socket.on("START_MATCH_ACCEPTED", () => console.log("START_MATCH_ACCEPTED"));
socket.on("SYNC_STATE", (p) => {
  if (p.phase === "playing" || p.status === "running")
    console.log("SYNC playing/running tick=" + p.tick + " status=" + p.status + " phase=" + p.phase);
});
