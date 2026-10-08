"use client";

import { SmilePlus } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

// Page icons are user content; these are only quick picks, any emoji can be pasted.
const PICKS = [..."📄📝📌📎📚📖📋✅🐛🚀💡🔥⭐🎯🧪🧩🛠⚙🔒🔑📦🗂📊📈🧭🗺🏁⚠❓💬🤝👥🎨🖥📱🌐☁🗄🧱🔗🕒📅🎉✨🌱🧠📣🔍🏗"];

const firstGrapheme = (value: string) => {
  const segments = new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(value.trim());
  return [...segments][0]?.segment ?? "";
};

/** The page icon above the title: pick one, paste your own, or remove it. */
export function IconPicker({ icon, editable, onChange }: { icon: string; editable: boolean; onChange: (icon: string) => void }) {
  const [open, setOpen] = useState(false);
  const [custom, setCustom] = useState("");
  const choose = (value: string) => {
    onChange(value);
    setOpen(false);
    setCustom("");
  };

  if (!editable) return icon ? <span className="mb-2 block text-4xl leading-none">{icon}</span> : null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        {icon ? (
          <button type="button" aria-label="Change page icon" className="mb-2 block rounded-md p-1 text-4xl leading-none hover:bg-accent">
            {icon}
          </button>
        ) : (
          <Button
            variant="ghost"
            size="xs"
            className={cn("mb-1 -ml-1.5 opacity-0 group-hover/title:opacity-100 focus-visible:opacity-100", open && "opacity-100")}
          >
            <SmilePlus /> Add icon
          </Button>
        )}
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-2">
        <div className="grid grid-cols-8 gap-0.5">
          {PICKS.map((emoji) => (
            <button
              key={emoji}
              type="button"
              aria-label={`Use ${emoji}`}
              onClick={() => choose(emoji)}
              className={cn("flex size-8 items-center justify-center rounded-sm text-lg hover:bg-accent", emoji === icon && "bg-accent")}
            >
              {emoji}
            </button>
          ))}
        </div>
        <form
          className="mt-2 flex gap-1.5"
          onSubmit={(event) => {
            event.preventDefault();
            const value = firstGrapheme(custom);
            if (value) choose(value);
          }}
        >
          <Input value={custom} onChange={(e) => setCustom(e.target.value)} placeholder="Paste an emoji" aria-label="Custom icon" className="h-7 text-sm" />
          <Button type="submit" size="sm" variant="secondary" disabled={!custom.trim()}>
            Use
          </Button>
        </form>
        {icon && (
          <Button variant="ghost" size="sm" className="mt-1 w-full justify-start" onClick={() => choose("")}>
            Remove icon
          </Button>
        )}
      </PopoverContent>
    </Popover>
  );
}
