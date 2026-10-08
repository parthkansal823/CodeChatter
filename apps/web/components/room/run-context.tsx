"use client";

import { runnableLanguage, type RunExit, type RunInfo } from "@codechatter/contracts";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import * as Y from "yjs";

import { useRoom } from "@/components/room/room-context";
import { getSocket } from "@/lib/socket";

export type OutputEvent = { kind: "reset"; run: RunInfo } | { kind: "data"; data: string } | { kind: "exit"; exit: RunExit };

type RunContextValue = {
  run: RunInfo | null;
  exit: RunExit | null;
  /** Waiting for the sandbox to start the run. */
  starting: boolean;
  running: boolean;
  /** You started the current run (only you can type into it). */
  mine: boolean;
  start: (path: string) => Promise<boolean>;
  stop: () => Promise<void>;
  input: (data: string) => void;
  /** Replays the current run's output, then streams new events. */
  subscribe: (listener: (event: OutputEvent) => void) => () => void;
};

const RunContext = createContext<RunContextValue | null>(null);

export function useRun(): RunContextValue {
  const value = useContext(RunContext);
  if (!value) throw new Error("useRun must be used inside <RunProvider>");
  return value;
}

export const canRunPath = (path: string | null | undefined) => Boolean(path && runnableLanguage(path));

const KEEP = 256 * 1024; // output kept for a panel opened mid-run

/**
 * The room's shared run (one at a time, everyone sees it). Events arrive over
 * the room's Socket.IO channel; the output of the current run is buffered so
 * the Output panel can be opened, closed and reopened without losing it.
 */
export function RunProvider({ children }: { children: ReactNode }) {
  const { room, doc, me } = useRoom();
  const [run, setRun] = useState<RunInfo | null>(null);
  const [exit, setExit] = useState<RunExit | null>(null);
  const [starting, setStarting] = useState(false);
  const runRef = useRef<RunInfo | null>(null);
  const exitRef = useRef<RunExit | null>(null);
  const buffer = useRef("");
  const listeners = useRef(new Set<(event: OutputEvent) => void>());

  const emit = (event: OutputEvent) => listeners.current.forEach((listener) => listener(event));

  useEffect(() => {
    const socket = getSocket();
    const begin = (info: RunInfo, output: string, ended: RunExit | null) => {
      runRef.current = info;
      exitRef.current = ended;
      buffer.current = output;
      setRun(info);
      setExit(ended);
      emit({ kind: "reset", run: info });
      if (output) emit({ kind: "data", data: output });
      if (ended) emit({ kind: "exit", exit: ended });
    };
    const sync = async () => {
      const joined = await socket.emitWithAck("room:join", room.id).catch(() => null);
      if (!joined?.ok) return;
      const snapshot = await socket.timeout(8000).emitWithAck("run:snapshot", room.id).catch(() => null);
      if (snapshot?.ok && snapshot.data.run && snapshot.data.run.id !== runRef.current?.id) {
        begin(snapshot.data.run, snapshot.data.output, snapshot.data.exit);
      }
    };
    const onStarted = (info: RunInfo) => info.roomId === room.id && begin(info, "", null);
    const onOutput = ({ runId, data }: { runId: string; data: string }) => {
      if (runId !== runRef.current?.id) return;
      buffer.current = (buffer.current + data).slice(-KEEP);
      emit({ kind: "data", data });
    };
    const onExit = (ended: RunExit) => {
      if (ended.runId !== runRef.current?.id) return;
      exitRef.current = ended;
      setExit(ended);
      emit({ kind: "exit", exit: ended });
    };

    if (socket.connected) void sync();
    socket.on("connect", sync);
    socket.on("run:started", onStarted);
    socket.on("run:output", onOutput);
    socket.on("run:exit", onExit);
    return () => {
      socket.off("connect", sync);
      socket.off("run:started", onStarted);
      socket.off("run:output", onOutput);
      socket.off("run:exit", onExit);
    };
  }, [room.id]);

  const start = useCallback(
    async (path: string) => {
      if (!canRunPath(path)) return false;
      setStarting(true);
      // The sandbox waits until it has every edit in this state vector (plan §5).
      const vector = Y.encodeStateVector(doc);
      const stateVector = btoa(String.fromCharCode(...vector));
      const result = await getSocket()
        .timeout(30_000)
        .emitWithAck("run:start", { roomId: room.id, path, stateVector })
        .catch(() => ({ ok: false as const, error: "The sandbox didn't answer in time. Try again." }));
      setStarting(false);
      if (!result.ok) toast.error(result.error);
      return result.ok;
    },
    [doc, room.id],
  );

  const stop = useCallback(async () => {
    const result = await getSocket()
      .timeout(10_000)
      .emitWithAck("run:stop", { roomId: room.id })
      .catch(() => ({ ok: false as const, error: "Couldn't reach the sandbox." }));
    if (!result.ok) toast.error(result.error);
  }, [room.id]);

  // Keystrokes typed in quick succession (or pasted) go out as one message.
  const pendingInput = useRef({ data: "", timer: 0 as ReturnType<typeof setTimeout> | 0 });
  const input = useCallback(
    (data: string) => {
      const current = runRef.current;
      if (!current || exitRef.current) return;
      const pending = pendingInput.current;
      pending.data += data;
      if (pending.timer) return;
      pending.timer = setTimeout(() => {
        const chunk = pending.data;
        pending.data = "";
        pending.timer = 0;
        for (let i = 0; i < chunk.length; i += 4000) {
          getSocket().emit("run:input", { roomId: room.id, runId: current.id, data: chunk.slice(i, i + 4000) });
        }
      }, 12);
    },
    [room.id],
  );

  const subscribe = useCallback((listener: (event: OutputEvent) => void) => {
    listeners.current.add(listener);
    if (runRef.current) {
      listener({ kind: "reset", run: runRef.current });
      if (buffer.current) listener({ kind: "data", data: buffer.current });
      if (exitRef.current) listener({ kind: "exit", exit: exitRef.current });
    }
    return () => void listeners.current.delete(listener);
  }, []);

  const value = useMemo<RunContextValue>(
    () => ({
      run,
      exit,
      starting,
      running: Boolean(run && !exit),
      mine: run?.startedBy.id === me.user.id,
      start,
      stop,
      input,
      subscribe,
    }),
    [run, exit, starting, me.user.id, start, stop, input, subscribe],
  );

  return <RunContext value={value}>{children}</RunContext>;
}
