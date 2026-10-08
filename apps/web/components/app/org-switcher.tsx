"use client";

import { Check, ChevronsUpDown, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { useMe } from "@/components/app/app-shell";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { authClient } from "@/lib/auth-client";

export function OrgSwitcher() {
  const me = useMe();
  const router = useRouter();
  const [activeId, setActiveId] = useState(me.session.activeOrganizationId);
  const active = me.organizations.find((o) => o.id === activeId) ?? me.organizations[0];
  const label = (org: (typeof me.organizations)[number]) => (org.id === me.personalOrgId ? "Personal" : org.name);

  async function select(id: string) {
    setActiveId(id);
    await authClient.organization.setActive({ organizationId: id });
    router.refresh();
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="flex h-9 w-full items-center gap-2 rounded-md border bg-background px-2.5 text-left hover:bg-accent">
        <span className="flex size-5 items-center justify-center rounded-sm bg-foreground text-2xs font-semibold text-background">
          {(active ? label(active) : "?").charAt(0).toUpperCase()}
        </span>
        <span className="flex-1 truncate font-medium">{active ? label(active) : "No organisation"}</span>
        <ChevronsUpDown className="size-3.5 text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-(--radix-dropdown-menu-trigger-width) min-w-56">
        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">Organisations</DropdownMenuLabel>
        {me.organizations.map((org) => (
          <DropdownMenuItem key={org.id} onSelect={() => select(org.id)}>
            <span className="flex-1 truncate">{label(org)}</span>
            {org.id === active?.id && <Check className="size-4" />}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => router.push("/orgs/new" as never)}>
          <Plus className="size-4" /> New organisation
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
