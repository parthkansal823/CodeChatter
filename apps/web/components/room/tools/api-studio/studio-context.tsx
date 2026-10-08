"use client";

import type { VariableLookup } from "@codechatter/contracts";
import type { HocuspocusProvider } from "@hocuspocus/provider";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type * as Y from "yjs";

import { useRoom } from "@/components/room/room-context";
import type { Me } from "@/lib/me";

import { useEnvironments, useStudioPeers, useTree, type ApiConnection, type StudioPeer } from "./connection";
import { execute, SENDING, type RunState } from "./execute";
import { patchValues, useLocalValues, useSelectedEnvironment, variableLookup } from "./local-store";
import { findItem, requestsIn, type Environment, type TreeItem } from "./model";

/** Which dialog is open. One at a time, opened from anywhere in the tool. */
export type StudioDialog =
  | { kind: "environments" }
  | { kind: "import" }
  | { kind: "snippets"; requestId: string }
  | { kind: "run"; folderId: string | null }
  | { kind: "delete"; id: string }
  | { kind: "mock" }
  | null;

type Studio = {
  roomId: string;
  user: Me["user"];
  doc: Y.Doc;
  provider: HocuspocusProvider;
  /** Change the shared collection (files.edit). Everyone else can still send and keep their own values. */
  canEdit: boolean;
  /** Send requests (code.run): sends reach the sandbox and spend server time. */
  canSend: boolean;
  tree: TreeItem[];
  environments: Environment[];
  /** The environment you picked ("" = none). Each person picks their own. */
  envId: string;
  env: Environment | null;
  setEnvId: (id: string) => void;
  /** Your own variable values for this environment (secrets, and values set by checks and scripts). */
  mine: Record<string, string>;
  setMine: (name: string, value: string | null) => void;
  lookup: VariableLookup;
  selectedId: string | null;
  select: (id: string | null) => void;
  peers: StudioPeer[];
  runs: Record<string, RunState>;
  send: (requestId: string) => Promise<RunState | null>;
  cancel: (requestId: string) => void;
  dialog: StudioDialog;
  openDialog: (dialog: StudioDialog) => void;
  openFile: (fileId: string) => void;
  close: () => void;
};

const StudioContext = createContext<Studio | null>(null);
const NO_VALUES: Record<string, string> = {};

export function useStudio(): Studio {
  const value = useContext(StudioContext);
  if (!value) throw new Error("useStudio must be used inside <StudioProvider>");
  return value;
}

export function StudioProvider({ conn, openFile, close, children }: { conn: ApiConnection; openFile: (id: string) => void; close: () => void; children: ReactNode }) {
  const { room, me, can } = useRoom();
  const { doc, provider } = conn;
  const tree = useTree(doc);
  const environments = useEnvironments(doc);
  const peers = useStudioPeers(provider);
  const [envId, setEnvId] = useSelectedEnvironment(room.id, me.user.id);
  const [localValues] = useLocalValues(room.id, me.user.id);
  const env = environments.find((e) => e.id === envId) ?? null;
  const mine = localValues[env?.id ?? ""] ?? NO_VALUES;
  const lookup = useMemo(() => variableLookup(env, mine), [env, mine]);

  // Opening the tool shows the first request; a request someone else deletes falls back to it too.
  const [picked, setPicked] = useState<string | null>(null);
  const selectedId = (picked && findItem(tree, picked)?.kind === "request" ? picked : null) ?? requestsIn(tree)[0]?.id ?? null;
  useEffect(() => {
    provider.setAwarenessField("requestId", selectedId);
  }, [provider, selectedId]);

  const [dialog, openDialog] = useState<StudioDialog>(null);
  const [runs, setRuns] = useState<Record<string, RunState>>({});
  const inFlight = useRef(new Map<string, AbortController>());

  const send = useCallback(
    async (requestId: string): Promise<RunState | null> => {
      if (inFlight.current.has(requestId)) return null;
      const controller = new AbortController();
      inFlight.current.set(requestId, controller);
      setRuns((current) => ({ ...current, [requestId]: { ...SENDING, startedAt: Date.now() } }));
      try {
        const state = await execute({ doc, roomId: room.id, userId: me.user.id, requestId, signal: controller.signal });
        setRuns((current) => ({ ...current, [requestId]: state }));
        return state;
      } finally {
        inFlight.current.delete(requestId);
      }
    },
    [doc, room.id, me.user.id],
  );

  const cancel = useCallback((requestId: string) => inFlight.current.get(requestId)?.abort(), []);

  const setMine = useCallback(
    (name: string, value: string | null) => patchValues(room.id, me.user.id, env?.id ?? "", { [name]: value }),
    [room.id, me.user.id, env?.id],
  );

  return (
    <StudioContext
      value={{
        roomId: room.id,
        user: me.user,
        doc,
        provider,
        canEdit: can("files.edit"),
        canSend: can("code.run"),
        tree,
        environments,
        envId: env?.id ?? "",
        env,
        setEnvId,
        mine,
        setMine,
        lookup,
        selectedId,
        select: setPicked,
        peers,
        runs,
        send,
        cancel,
        dialog,
        openDialog,
        openFile,
        close,
      }}
    >
      {children}
    </StudioContext>
  );
}
