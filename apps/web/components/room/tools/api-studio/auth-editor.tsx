"use client";

import { AUTH_TYPES, type AuthType, type RequestAuth } from "@codechatter/contracts";
import { TriangleAlert } from "lucide-react";
import { useId } from "react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { CompactSelect } from "./compact-select";
import { setAuth, type RequestData } from "./model";
import { Segmented } from "./segmented";
import { useStudio } from "./studio-context";

const LABELS: Record<AuthType, string> = { none: "No auth", bearer: "Bearer token", basic: "Basic auth", apiKey: "API key" };

export function AuthEditor({ request }: { request: RequestData }) {
  const { doc, canEdit } = useStudio();
  const uid = useId();
  const auth = request.auth;
  const set = (patch: Partial<RequestAuth>) => setAuth(doc, request.id, patch);

  const field = (name: string, label: string, key: "token" | "username" | "password" | "key" | "value", sensitive: boolean) => {
    const value = auth[key];
    const literal = sensitive && value.trim() !== "" && !value.includes("{{");
    return (
      <div className="grid gap-1">
        <Label htmlFor={`${uid}-${name}`} className="text-xs text-muted-foreground">
          {label}
        </Label>
        <Input
          id={`${uid}-${name}`}
          value={value}
          readOnly={!canEdit}
          spellCheck={false}
          autoComplete="off"
          onChange={(event) => set({ [key]: event.target.value })}
          className="h-7 font-mono text-sm md:text-sm"
        />
        {literal && (
          <p className="flex items-start gap-1.5 text-xs text-warning">
            <TriangleAlert className="mt-0.5 size-3 shrink-0" aria-hidden />
            <span>This is saved in the shared collection and visible to everyone in the room. Use a {"{{variable}}"} and mark it secret in Environments.</span>
          </p>
        )}
      </div>
    );
  };

  return (
    <div className="grid max-w-xl gap-3 p-3">
      <div className="grid gap-1">
        <Label className="text-xs text-muted-foreground">Type</Label>
        <CompactSelect
          label="Auth type"
          value={auth.type}
          onChange={(type) => set({ type })}
          options={AUTH_TYPES.map((id) => ({ id, label: LABELS[id] }))}
          disabled={!canEdit}
          className="w-48"
        />
      </div>
      {auth.type === "none" && <p className="text-sm text-muted-foreground">This request is sent without credentials. Auth you add here replaces an Authorization header from the Headers tab.</p>}
      {auth.type === "bearer" && field("token", "Token", "token", true)}
      {auth.type === "basic" && (
        <>
          {field("user", "User name", "username", false)}
          {field("pass", "Password", "password", true)}
        </>
      )}
      {auth.type === "apiKey" && (
        <>
          {field("key", "Key name", "key", false)}
          {field("value", "Key value", "value", true)}
          <div className="grid gap-1">
            <Label className="text-xs text-muted-foreground">Send it in</Label>
            <Segmented
              label="Where to send the API key"
              options={[
                { id: "header", label: "Header" },
                { id: "query", label: "Query string" },
              ]}
              value={auth.in}
              onChange={(where) => set({ in: where })}
              disabled={!canEdit}
            />
          </div>
        </>
      )}
    </div>
  );
}
