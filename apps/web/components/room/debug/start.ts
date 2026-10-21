"use client";

import { createFileAtPath, findByPath, textOf } from "@codechatter/workspace-model";
import * as Y from "yjs";

import { isDebuggable, startDebugging, useDebug } from "./debug-store";
import { LAUNCH_PATH, readLaunch, STARTER_LAUNCH, type LaunchConfig, type SkippedConfig } from "./launch";

/** Your edits so far, so the sandbox waits for them before debugging (as Run does). */
function stateVectorOf(doc: Y.Doc): string {
  let binary = "";
  for (const byte of Y.encodeStateVector(doc)) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/** The room's launch.json configurations for the open file; null when the room has no launch.json. */
export function launchConfigs(
  doc: Y.Doc,
  activePath: string | null,
): { configs: LaunchConfig[]; skipped: SkippedConfig[] } | null {
  const node = findByPath(doc, LAUNCH_PATH);
  if (node?.kind !== "file") return null;
  return readLaunch(textOf(doc, node.id)?.toString() ?? "", { activePath });
}

export function debugFile(doc: Y.Doc, path: string): void {
  startDebugging({ path }, stateVectorOf(doc));
}

export function debugConfig(doc: Y.Doc, config: LaunchConfig): void {
  startDebugging(
    {
      ...(config.module ? { module: config.module } : { path: config.program! }),
      name: config.name,
      args: config.args,
      ...(config.cwd && { cwd: config.cwd }),
      env: config.env,
      stopOnEntry: config.stopOnEntry,
      justMyCode: config.justMyCode,
    },
    stateVectorOf(doc),
  );
}

/** F5 and Run and debug's button: the picked configuration, else the open file; false when there's nothing to start. */
export function startPicked(doc: Y.Doc, activePath: string | null): boolean {
  const name = useDebug.getState().configName;
  const config = name ? launchConfigs(doc, activePath)?.configs.find((c) => c.name === name) : undefined;
  if (config) {
    debugConfig(doc, config);
    return true;
  }
  if (activePath && isDebuggable(activePath)) {
    debugFile(doc, activePath);
    return true;
  }
  return false;
}

/** Make .vscode/launch.json with a configuration for Python and one for C and C++, unless it's there. */
export function addLaunchFile(doc: Y.Doc, userId: string): void {
  if (!findByPath(doc, LAUNCH_PATH)) createFileAtPath(doc, LAUNCH_PATH, STARTER_LAUNCH, userId);
}
