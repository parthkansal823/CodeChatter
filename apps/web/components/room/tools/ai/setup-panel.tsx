"use client";

import type { AiStatus } from "@codechatter/contracts";
import { Check, Copy, Sparkles } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { copyText } from "@/lib/clipboard";
import { cn } from "@/lib/utils";

type Option = { id: string; label: string; cost: string; steps: string[]; env: string };

/** Ollama first: free and private. When it already runs on the server, its models are offered. */
function ollamaOption(local: AiStatus["ollama"]): Option {
  const models = local?.models ?? [];
  const steps = !local
    ? ["Install Ollama from ollama.com.", "Run: ollama pull qwen2.5-coder", "Keep Ollama running while you use the AI."]
    : models.length > 0
      ? [`Ollama is running on this server with ${models.join(", ")}. Any of them can be AI_MODEL.`]
      : ["Ollama is running on this server but has no models yet. Run: ollama pull qwen2.5-coder"];
  return {
    id: "ollama",
    label: "Ollama",
    cost: local ? "Free, already running here" : "Free, runs on your computer",
    steps,
    env: `AI_PROVIDER=ollama\nAI_MODEL=${models[0] ?? "qwen2.5-coder"}\n# Only if the API runs in Docker:\n# OLLAMA_URL=http://host.docker.internal:11434`,
  };
}

// Free first: the server owner may not want to pay for an API.
const HOSTED: Option[] = [
  {
    id: "groq",
    label: "Groq",
    cost: "Free tier, very fast",
    steps: ["Create a free key at console.groq.com/keys."],
    env: "AI_PROVIDER=openai\nOPENAI_BASE_URL=https://api.groq.com/openai/v1\nOPENAI_API_KEY=your-groq-key\nAI_MODEL=llama-3.3-70b-versatile\nAI_VISION=false",
  },
  {
    id: "gemini",
    label: "Gemini",
    cost: "Free tier, reads images",
    steps: ["Create a free key at aistudio.google.com/apikey."],
    env: "AI_PROVIDER=openai\nOPENAI_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai\nOPENAI_API_KEY=your-gemini-key\nAI_MODEL=gemini-2.5-flash",
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    cost: "Free models (names end in :free)",
    steps: ["Create a key at openrouter.ai/keys.", "Pick a free model at openrouter.ai/models."],
    env: "AI_PROVIDER=openai\nOPENAI_BASE_URL=https://openrouter.ai/api/v1\nOPENAI_API_KEY=your-openrouter-key\nAI_MODEL=meta-llama/llama-3.3-70b-instruct:free\nAI_VISION=false",
  },
  {
    id: "anthropic",
    label: "Claude",
    cost: "Paid, best answers",
    steps: ["Create a key at console.anthropic.com."],
    env: "AI_PROVIDER=anthropic\nANTHROPIC_API_KEY=your-anthropic-key\n# Optional, this is the default:\nAI_MODEL=claude-sonnet-5",
  },
];

/** Shown instead of the chat while the server has no AI provider. */
export function SetupPanel({ status }: { status: AiStatus }) {
  const options = [ollamaOption(status.ollama), ...HOSTED];
  const [chosen, setChosen] = useState(options[0]!.id);
  const [copied, setCopied] = useState(false);
  const option = options.find((o) => o.id === chosen) ?? options[0]!;

  const copy = async () => {
    if (!(await copyText(option.env))) return;
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="h-full overflow-y-auto p-4 text-sm">
      <div className="flex items-center gap-2">
        <Sparkles className="size-4 text-muted-foreground" />
        <h2 className="font-medium">AI isn&apos;t set up yet</h2>
      </div>
      <p className="mt-1.5 text-muted-foreground">
        Whoever runs this server can turn it on. Several providers are free. Keys stay on the server and never reach the browser.
      </p>
      {status.problem && <p className="mt-2 rounded-md border bg-background px-2.5 py-2 text-xs">{status.problem}</p>}

      <div role="group" aria-label="Provider" className="mt-4 grid gap-1">
        {options.map((o) => (
          <button
            key={o.id}
            type="button"
            aria-pressed={o.id === chosen}
            onClick={() => setChosen(o.id)}
            className={cn(
              "relative flex items-baseline justify-between gap-3 rounded-md border px-2.5 py-1.5 text-left",
              o.id === chosen ? "border-foreground/30 bg-background" : "border-transparent hover:bg-accent",
            )}
          >
            {o.id === chosen && <span aria-hidden className="absolute inset-y-1.5 left-0 w-0.5 rounded-full bg-brand" />}
            <span className="font-medium">{o.label}</span>
            <span className="truncate text-xs text-muted-foreground">{o.cost}</span>
          </button>
        ))}
      </div>

      <ol className="mt-4 list-decimal space-y-1 pl-5 text-muted-foreground marker:text-muted-foreground">
        {option.steps.map((step) => (
          <li key={step}>{step}</li>
        ))}
        <li>Add these lines to .env at the root of the project:</li>
      </ol>
      <div className="mt-2 overflow-hidden rounded-md border bg-background">
        <div className="flex h-7 items-center justify-between border-b bg-chrome pr-1 pl-2.5">
          <span className="font-mono text-2xs text-muted-foreground">.env</span>
          <Button size="xs" variant="ghost" onClick={() => void copy()} aria-label={copied ? "Copied" : "Copy the .env lines"}>
            {copied ? <Check /> : <Copy />}
            {copied ? "Copied" : "Copy"}
          </Button>
        </div>
        <pre className="overflow-x-auto px-3 py-2 font-mono text-xs leading-relaxed">{option.env}</pre>
      </div>
      <p className="mt-3 text-muted-foreground">Then restart the API and reopen this panel. Model names change over time: check your provider&apos;s model list if one isn&apos;t found.</p>
    </div>
  );
}
