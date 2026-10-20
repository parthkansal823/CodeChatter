"use client";

import { Box, Braces, Hash, Layers, type LucideIcon, Package, SquareFunction, Type, Variable } from "lucide-react";

import { cn } from "@/lib/utils";

/** One small monochrome icon per kind of symbol (TypeScript's kinds and outline.ts's). */
const ICONS: Record<string, LucideIcon> = {
  class: Box,
  struct: Box,
  interface: Box,
  trait: Box,
  enum: Box,
  union: Box,
  function: SquareFunction,
  method: SquareFunction,
  constructor: SquareFunction,
  "local function": SquareFunction,
  getter: SquareFunction,
  setter: SquareFunction,
  impl: Layers,
  module: Package,
  mod: Package,
  type: Type,
  const: Variable,
  let: Variable,
  var: Variable,
  property: Variable,
  "local var": Variable,
};

export function SymbolIcon({ kind, className }: { kind: string; className?: string }) {
  const Icon = /^h[1-6]$/.test(kind) ? Hash : (ICONS[kind] ?? Braces);
  return <Icon aria-hidden className={cn("size-3.5 shrink-0 text-muted-foreground", className)} />;
}

/** The kind as people say it ("h2" is "heading 2"). */
export const kindLabel = (kind: string) => (/^h[1-6]$/.test(kind) ? `heading ${kind.slice(1)}` : kind);
