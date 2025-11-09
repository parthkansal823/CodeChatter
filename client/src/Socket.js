import { io } from "socket.io-client";

export const initSocket = async () => {
  const options = {
    "force new connection": true,
    reconnectionAttempts: Infinity,
    timeout: 10000,
    transports: ["websocket"],
  };

  // ✅ Make sure this URL matches your backend port
  return io("http://localhost:5000", options);
};
