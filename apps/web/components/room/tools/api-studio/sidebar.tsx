"use client";

import { Cookie, Settings2 } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";

import { CollectionsTree } from "./collections-tree";
import { CookiesDialog } from "./cookies-dialog";
import { CompactSelect } from "./compact-select";
import { HistoryPanel } from "./history-panel";
import { StudioTabs } from "./studio-tabs";
import { useStudio } from "./studio-context";

const NONE = "__none";

export function Sidebar() {
  const { environments, envId, setEnvId, openDialog } = useStudio();
  const [tab, setTab] = useState<"requests" | "history">("requests");
  const [cookiesOpen, setCookiesOpen] = useState(false);

  return (
    <aside aria-label="Collections" className="flex h-full min-h-0 flex-col bg-panel">
      <div className="flex shrink-0 items-center gap-1 border-b p-2">
        <CompactSelect
          label="Environment"
          value={envId || NONE}
          onChange={(id) => setEnvId(id === NONE ? "" : id)}
          options={[{ id: NONE, label: "No environment" }, ...environments.map((env) => ({ id: env.id, label: env.name }))]}
        />
        <Button size="icon-sm" variant="ghost" aria-label="Manage environments" title="Manage environments" onClick={() => openDialog({ kind: "environments" })}>
          <Settings2 />
        </Button>
        <Button size="icon-sm" variant="ghost" aria-label="Manage cookies" title="Cookies" onClick={() => setCookiesOpen(true)}><Cookie /></Button>
      </div>
      <StudioTabs
        label="Sidebar"
        value={tab}
        onChange={setTab}
        tabs={[
          { id: "requests", label: "Collection" },
          { id: "history", label: "History" },
        ]}
      />
      <div className="min-h-0 flex-1">{tab === "requests" ? <CollectionsTree /> : <HistoryPanel />}</div>
      <CookiesDialog open={cookiesOpen} onOpenChange={setCookiesOpen} />
    </aside>
  );
}
