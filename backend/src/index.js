import http from "node:http";
import express from "express";
import cors from "cors";
import { Server as SocketIOServer } from "socket.io";
import { getEnv } from "./lib/env.js";
import { QueueManager } from "./services/queueService.js";
import { AutoSendService } from "./services/autoSendService.js";
import { createQueueRoutes } from "./routes/queueRoutes.js";
import { createSchedulesRoutes } from "./routes/schedulesRoutes.js";

const env = getEnv();
const app = express();
app.use(express.json({ limit: "2mb" }));
app.use(
  cors({
    origin: env.FRONTEND_ORIGIN || true,
    credentials: true,
  })
);

const server = http.createServer(app);
const io = new SocketIOServer(server, {
  cors: { origin: env.FRONTEND_ORIGIN || true, credentials: true },
});

function emit(event, payload) {
  io.emit(event, payload);
}

const queueManager = new QueueManager({ emit });
const autoSendService = new AutoSendService({ queueManager, emit });

app.get("/health", (_req, res) => res.json({ ok: true }));
app.use("/api/queue", createQueueRoutes({ queueManager }));
app.use("/api/auto-send/schedules", createSchedulesRoutes({ autoSendService }));

io.on("connection", (socket) => {
  socket.emit("server:hello", { ok: true });
});

await autoSendService.reload();

server.listen(env.PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`Auto-send backend listening on :${env.PORT}`);
});

