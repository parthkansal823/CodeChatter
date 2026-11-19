/** Inspect response cookie attributes and manage this person's environment jar without sharing session values. */
"use client";

import { Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

import { cookieKey, type CookieChange, type StudioCookie } from "./cookies";
import { getCookieJar, setCookieJar, useCookieJar } from "./local-store";
import { useStudio } from "./studio-context";

const expiry = (cookie: StudioCookie) => cookie.expiresAt === null ? "when the session ends" : new Date(cookie.expiresAt).toLocaleString();
const flags = (cookie: StudioCookie) => [cookie.secure && "Secure", cookie.httpOnly && "HttpOnly", cookie.sameSite && `SameSite=${cookie.sameSite}`].filter(Boolean).join(", ") || "None";

/** Response metadata remains in the local run state, including deletions that no longer appear in the jar. */
export function ResponseCookies({ changes }: { changes: CookieChange[] }) {
  if (!changes.length) return <p className="p-4 text-sm text-muted-foreground">This response did not set any valid cookies.</p>;
  return <div className="h-full overflow-auto">
    <table className="w-full text-left text-xs">
      <caption className="sr-only">Response cookies</caption>
      <thead className="border-b bg-panel text-muted-foreground"><tr>{["Name", "Value", "Domain", "Path", "Attributes", "Expires", "Max-Age", "Change"].map((label) => <th key={label} scope="col" className="px-3 py-2 font-medium whitespace-nowrap">{label}</th>)}</tr></thead>
      <tbody>{changes.map(({ cookie, deleted }, index) => <tr key={`${cookieKey(cookie)}-${index}`} data-cookie-name={cookie.name} className="border-b align-top last:border-0">
        <th scope="row" className="px-3 py-2 font-mono font-medium break-all">{cookie.name}</th>
        <td className="max-w-48 px-3 py-2 font-mono break-all">{cookie.value}</td>
        <td className="px-3 py-2 break-all">{cookie.domain}{cookie.hostOnly && <span className="block text-muted-foreground">Host only</span>}</td>
        <td className="px-3 py-2 font-mono break-all">{cookie.path}</td>
        <td className="px-3 py-2">{flags(cookie)}</td>
        <td className="px-3 py-2">{expiry(cookie)}{cookie.expires !== null && cookie.maxAge !== null && <span className="block text-muted-foreground">Expires attribute: {new Date(cookie.expires).toLocaleString()}; Max-Age takes priority.</span>}</td>
        <td className="px-3 py-2 whitespace-nowrap">{cookie.maxAge === null ? "Not set" : `${cookie.maxAge} s`}</td>
        <td className="px-3 py-2">{deleted ? "Deleted" : "Set"}</td>
      </tr>)}</tbody>
    </table>
  </div>;
}

export function CookiesDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="flex max-h-[85vh] flex-col gap-3 sm:max-w-3xl">
      <DialogHeader><DialogTitle>Cookies</DialogTitle><DialogDescription>Your cookie jar stays on this device, separate for each person and environment. Session cookies end with this tab.</DialogDescription></DialogHeader>
      {open && <Jar />}
    </DialogContent>
  </Dialog>;
}

function Jar() {
  const { roomId, user, env } = useStudio();
  const envKey = env?.id ?? "";
  const jar = useCookieJar(roomId, user.id, envKey);
  const domains = [...new Set(jar.map((cookie) => cookie.domain))].sort();
  const remove = (keep: (cookie: StudioCookie) => boolean) => setCookieJar(roomId, user.id, envKey, getCookieJar(roomId, user.id, envKey).filter(keep));
  return <>
    <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground"><span>Environment: {env?.name ?? "No environment"}</span><Button size="xs" variant="outline" disabled={!jar.length} onClick={() => remove(() => false)}><Trash2 /> Delete all cookies</Button></div>
    <div className="min-h-0 overflow-auto">
      {!jar.length && <p className="py-8 text-center text-sm text-muted-foreground">No cookies in this environment.</p>}
      {domains.map((domain) => <section key={domain} aria-label={`Cookies for ${domain}`} className="mb-3 overflow-hidden rounded-md border last:mb-0">
        <div className="flex items-center justify-between gap-2 border-b bg-panel px-3 py-1.5"><h3 className="min-w-0 truncate font-mono text-xs font-medium">{domain}</h3><Button size="xs" variant="ghost" aria-label={`Delete cookies for ${domain}`} onClick={() => remove((cookie) => cookie.domain !== domain)}><Trash2 /> Delete domain</Button></div>
        <table className="w-full text-left text-xs"><caption className="sr-only">Cookies for {domain}</caption><thead className="text-muted-foreground"><tr>{["Name", "Path", "Attributes", "Expires", "Actions"].map((label) => <th key={label} scope="col" className="px-3 py-1.5 font-medium">{label}</th>)}</tr></thead>
          <tbody>{jar.filter((cookie) => cookie.domain === domain).map((cookie) => <tr key={cookieKey(cookie)} data-cookie-name={cookie.name} className="border-t align-top"><th scope="row" className="px-3 py-1.5 font-mono font-medium break-all">{cookie.name}{cookie.hostOnly && <span className="block font-sans font-normal text-muted-foreground">Host only</span>}</th><td className="px-3 py-1.5 font-mono break-all">{cookie.path}</td><td className="px-3 py-1.5">{flags(cookie)}</td><td className="px-3 py-1.5">{expiry(cookie)}</td><td className="px-3 py-1"><Button size="icon-xs" variant="ghost" aria-label={`Delete cookie ${cookie.name}`} onClick={() => remove((current) => cookieKey(current) !== cookieKey(cookie))}><Trash2 /></Button></td></tr>)}</tbody>
        </table>
      </section>)}
    </div>
  </>;
}
