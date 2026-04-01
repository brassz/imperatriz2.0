import { io, Socket } from "socket.io-client";
import { getAutoSendBaseUrl } from "@/api/auto-send-backend";

let socket: Socket | null = null;

export function getAutoSendSocket(): Socket {
  if (socket) return socket;
  socket = io(getAutoSendBaseUrl(), {
    transports: ["websocket", "polling"],
  });
  return socket;
}

