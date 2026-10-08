"use client";

import type { ComponentProps, ReactNode } from "react";

import { Command } from "@/components/ui/command";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

/**
 * The shell of Quick Open and the command palette: a dialog near the top of
 * the window around a cmdk list, with the dense row sizing the rest of the
 * IDE uses (the stock CommandDialog makes rows 44px tall).
 */
export function PaletteDialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  ...command
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  children: ReactNode;
} & Omit<ComponentProps<typeof Command>, "children" | "title">) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton={false} className="top-[14%] translate-y-0 gap-0 overflow-hidden p-0 sm:max-w-xl">
        <DialogHeader className="sr-only">
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <Command className="rounded-lg" {...command}>
          {children}
        </Command>
      </DialogContent>
    </Dialog>
  );
}
