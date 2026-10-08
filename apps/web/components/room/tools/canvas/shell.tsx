"use client";

import type { ReactNode } from "react";

import { SessionContext } from "./hooks";
import { handleCanvasKey, handleCanvasKeyUp } from "./keyboard";
import { handlePaste } from "./clipboard-io";
import type { CanvasSession } from "./session";
import type { ToolId } from "./editor";

/**
 * Wraps an open canvas tool: provides the session to everything inside and
 * routes keys and paste to the editor while focus is inside the tool.
 */
export function CanvasShell({ session, keys, children }: { session: CanvasSession; keys: Record<string, ToolId>; children: ReactNode }) {
  return (
    <SessionContext value={session}>
      <div
        className="flex h-full min-h-0 flex-col bg-background"
        onKeyDown={(e) => void handleCanvasKey(e, session, keys)}
        onKeyUp={(e) => handleCanvasKeyUp(e, session)}
        onPaste={(e) => handlePaste(e, session.editor)}
      >
        {children}
      </div>
    </SessionContext>
  );
}
