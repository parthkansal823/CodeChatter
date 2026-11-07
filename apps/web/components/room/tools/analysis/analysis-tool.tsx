/** The Analysis tool: what real tools found in the whole room (scc, lizard, gitleaks, bandit and the project's checkers), run in its sandbox. */
"use client";

import { COMPLEX_FUNCTION, type AnalysisFunction, type AnalysisIssue, type AnalysisSecret, type RoomAnalysis, type RoomProblem } from "@codechatter/contracts";
import { useQuery } from "@tanstack/react-query";
import { Loader2, RotateCw, ScanSearch, Sparkles } from "lucide-react";
import type { ReactNode } from "react";

import { openRoomFile } from "@/components/room/editor/editor-opener";
import { useRoom } from "@/components/room/room-context";
import { useAiRequests } from "@/components/room/tools/ai/ai-requests";
import type { RoomToolProps } from "@/components/room/tools/registry";
import { Button } from "@/components/ui/button";
import { ApiError, api } from "@/lib/api";
import { cn } from "@/lib/utils";

/** A list of functions with one path through them says nothing. */
const WORTH_LISTING = 5;
const MOST_LISTED = 15;
const number = (value: number) => value.toLocaleString();
const plural = (count: number, one: string, many = `${one}s`) => `${number(count)} ${count === 1 ? one : many}`;
const TONE: Record<AnalysisIssue["severity"], string> = { high: "text-destructive", medium: "text-brand-text", low: "text-muted-foreground" };

function Place({ path, line }: { path: string; line: number }) {
  return (
    <button
      type="button"
      className="min-h-6 max-w-full truncate rounded-sm text-left font-mono text-xs hover:underline"
      title={`Open ${path}, line ${line}`}
      onClick={() => openRoomFile(path, { startLine: line, startColumn: 1, endLine: line, endColumn: 1 })}
    >
      {path}:{line}
    </button>
  );
}

function Tile({ label, value, note, alarm }: { label: string; value: string; note?: string; alarm?: boolean }) {
  return (
    <div className="rounded-md border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={cn("mt-0.5 text-xl font-semibold tabular-nums", alarm && "text-destructive")}>{value}</p>
      {note && <p className="mt-0.5 text-xs text-muted-foreground">{note}</p>}
    </div>
  );
}

function Section({ title, count, explain, children }: { title: string; count?: string; explain: string; children: ReactNode }) {
  return (
    <section aria-label={title} className="grid min-w-0 gap-2">
      <div>
        <h3 className="font-medium">
          {title}
          {count && <span className="ml-2 font-normal text-muted-foreground">{count}</span>}
        </h3>
        <p className="text-xs text-muted-foreground">{explain}</p>
      </div>
      {children}
    </section>
  );
}

function Table({ caption, head, children }: { caption: string; head: string[]; children: ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-md border">
      <table className="w-full border-collapse text-xs">
        <caption className="sr-only">{caption}</caption>
        <thead className="bg-chrome">
          <tr>
            {head.map((name) => (
              <th key={name} scope="col" className="border-b px-2 py-1 text-left font-medium whitespace-nowrap">
                {name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

const Cell = ({ children, className }: { children: ReactNode; className?: string }) => <td className={cn("border-b px-2 py-1 align-top", className)}>{children}</td>;

function Languages({ size }: { size: RoomAnalysis["size"] }) {
  return (
    <Table caption="Languages" head={["Language", "Files", "Code", "Comments", "Complexity"]}>
      {size.languages.map((language) => (
        <tr key={language.name}>
          <Cell>{language.name}</Cell>
          <Cell className="tabular-nums">{number(language.files)}</Cell>
          <Cell className="tabular-nums">{number(language.code)}</Cell>
          <Cell className="tabular-nums">{number(language.comments)}</Cell>
          <Cell className="tabular-nums">{number(language.complexity)}</Cell>
        </tr>
      ))}
    </Table>
  );
}

function Functions({ worst }: { worst: AnalysisFunction[] }) {
  return (
    <Table caption="The most complex functions" head={["Function", "Where", "Complexity", "Lines", "Parameters"]}>
      {worst.map((fn) => (
        <tr key={`${fn.path}:${fn.line}:${fn.name}`}>
          <Cell className="font-mono">{fn.name}</Cell>
          <Cell>
            <Place path={fn.path} line={fn.line} />
          </Cell>
          <Cell className={cn("tabular-nums", fn.complexity > COMPLEX_FUNCTION && "font-medium text-brand-text")}>{fn.complexity}</Cell>
          <Cell className="tabular-nums">{fn.lines}</Cell>
          <Cell className="tabular-nums">{fn.params}</Cell>
        </tr>
      ))}
    </Table>
  );
}

function Secrets({ items }: { items: AnalysisSecret[] }) {
  return (
    <Table caption="What looks like a secret" head={["Where", "Kind", "What it means"]}>
      {items.map((secret) => (
        <tr key={`${secret.path}:${secret.line}:${secret.rule}`}>
          <Cell>
            <Place path={secret.path} line={secret.line} />
          </Cell>
          <Cell className="font-mono whitespace-nowrap">{secret.rule}</Cell>
          <Cell>{secret.description}</Cell>
        </tr>
      ))}
    </Table>
  );
}

function Issues({ items }: { items: AnalysisIssue[] }) {
  return (
    <Table caption="Security issues" head={["Severity", "Where", "Issue", "Sure?"]}>
      {items.map((issue) => (
        <tr key={`${issue.path}:${issue.line}:${issue.code}`}>
          <Cell className={cn("font-medium capitalize", TONE[issue.severity])}>{issue.severity}</Cell>
          <Cell>
            <Place path={issue.path} line={issue.line} />
          </Cell>
          <Cell>
            {issue.message} <span className="font-mono text-muted-foreground">{issue.code}{issue.cwe ? `, CWE-${issue.cwe}` : ""}</span>
          </Cell>
          <Cell className="capitalize">{issue.confidence}</Cell>
        </tr>
      ))}
    </Table>
  );
}

function Problems({ items }: { items: RoomProblem[] }) {
  return (
    <Table caption="Errors and warnings" head={["Kind", "Where", "Problem", "From"]}>
      {items.map((problem, index) => (
        <tr key={`${problem.path}:${problem.line}:${index}`}>
          <Cell className={cn("capitalize", problem.severity === "error" ? "font-medium text-destructive" : "text-muted-foreground")}>{problem.severity}</Cell>
          <Cell>
            <Place path={problem.path} line={problem.line} />
          </Cell>
          <Cell>{problem.message}</Cell>
          <Cell className="whitespace-nowrap text-muted-foreground">{problem.source}</Cell>
        </tr>
      ))}
    </Table>
  );
}

function Report({ report }: { report: RoomAnalysis }) {
  const { size, functions, secrets, security, problems, tools } = report;
  const missing = tools.filter((tool) => !tool.ran && tool.note);
  const notable = functions.worst.filter((fn) => fn.complexity >= WORTH_LISTING).slice(0, MOST_LISTED);
  return (
    <div className="grid gap-6">
      <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-5">
        <Tile label="Lines of code" value={number(size.code)} note={`${plural(size.files, "file")}, ${plural(size.languages.length, "language")}`} />
        <Tile label="Complex functions" value={number(functions.tooComplex)} note={`of ${number(functions.total)}, over ${COMPLEX_FUNCTION}`} />
        <Tile label="Secrets" value={number(secrets.total)} alarm={secrets.total > 0} note={secrets.total ? "Move these out of the code" : "None found"} />
        <Tile label="Security issues" value={number(security.total)} alarm={security.items.some((issue) => issue.severity === "high")} note={security.items.filter((issue) => issue.severity === "high").length ? `${security.items.filter((issue) => issue.severity === "high").length} high` : "None high"} />
        <Tile label="Errors" value={number(problems.errors)} alarm={problems.errors > 0} note={plural(problems.warnings, "warning")} />
      </div>

      {secrets.items.length > 0 && (
        <Section title="Secrets" count={String(secrets.total)} explain="From gitleaks. Only where they are: their values are never read back. Anyone who can see these files can use them, so change them, then move them out of the code.">
          <Secrets items={secrets.items} />
        </Section>
      )}
      {security.items.length > 0 && (
        <Section title="Security" count={String(security.total)} explain="From bandit, in Python code. Not every one is a real problem: it points at what's worth checking.">
          <Issues items={security.items} />
        </Section>
      )}
      {problems.items.length > 0 && (
        <Section title="Errors and warnings" count={String(problems.errors + problems.warnings + problems.infos)} explain="From the project's own checkers.">
          <Problems items={problems.items} />
        </Section>
      )}
      {functions.total > 0 && (
        <Section title="The most complex functions" explain={`From lizard. Complexity counts the paths through a function: over ${COMPLEX_FUNCTION}, it's hard to test and easy to break.`}>
          {notable.length > 0 ? <Functions worst={notable} /> : <p className="text-xs text-muted-foreground">None worth a look: every function is simple, with complexity under {WORTH_LISTING}.</p>}
        </Section>
      )}
      {size.languages.length > 0 && (
        <Section title="Languages" explain="From scc. Complexity here counts branches and loops, so it grows with size.">
          <Languages size={size} />
        </Section>
      )}

      <p className="text-xs text-muted-foreground">
        Ran {tools.filter((tool) => tool.ran).map((tool) => tool.name).join(", ") || "nothing"} in {Math.max(1, Math.round(report.ms / 1000))} s, on the room&apos;s files as they were at {new Date(report.at).toLocaleTimeString()}. node_modules, build output and the like aren&apos;t counted.
      </p>
      {missing.length > 0 && (
        <ul aria-label="What couldn't run" className="grid gap-0.5 text-xs text-muted-foreground">
          {missing.map((tool) => (
            <li key={`${tool.name}:${tool.note}`}>{tool.note}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function AnalysisTool(_: RoomToolProps) {
  const { room, can } = useRoom();
  const askAi = () => useAiRequests.getState().ask({ mode: "project", prompt: "Review this project: how it's put together, the risks, and what to fix first." });
  const analysis = useQuery({
    queryKey: ["room-analysis", room.id],
    queryFn: () => api<RoomAnalysis>(`/api/rooms/${room.id}/analysis`, { method: "POST" }),
    enabled: false,
    retry: false,
    gcTime: 30 * 60_000,
  });
  const busy = analysis.isFetching;
  return (
    <section aria-label="Analysis" className="flex h-full min-h-0 flex-col bg-background">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b bg-chrome px-3">
        <h2 className="font-medium">Analysis</h2>
        {analysis.data && !busy && <span className="text-xs text-muted-foreground">at {new Date(analysis.data.at).toLocaleTimeString()}</span>}
        {analysis.data && (
          <div className="ml-auto flex items-center gap-1">
            {can("room.chat") && (
              <Button size="xs" variant="outline" disabled={busy} onClick={askAi}>
                <Sparkles /> Ask the AI to review this
              </Button>
            )}
            <Button size="xs" variant="ghost" disabled={busy} onClick={() => void analysis.refetch()}>
              {busy ? <Loader2 className="animate-spin" /> : <RotateCw />} Run again
            </Button>
          </div>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {analysis.isError && (
          <p role="alert" className="mb-4 text-destructive">
            {analysis.error instanceof ApiError ? analysis.error.detail : "The analysis couldn't run. Try again."}
          </p>
        )}
        {analysis.data ? (
          <div className="mx-auto max-w-5xl">
            <Report report={analysis.data} />
          </div>
        ) : (
          <div className="mx-auto grid max-w-xl justify-items-start gap-3 pt-6">
            <p className="text-muted-foreground">
              Runs real tools over every file in this room, in its sandbox: scc to measure it, lizard for tangled functions, gitleaks for secrets, bandit for security problems in Python, and the project&apos;s own checkers for errors. Nothing leaves the sandbox but the results.
            </p>
            <Button size="sm" disabled={busy} onClick={() => void analysis.refetch()}>
              {busy ? <Loader2 className="animate-spin" /> : <ScanSearch />} {busy ? "Analysing, which can take a minute…" : "Analyse this project"}
            </Button>
          </div>
        )}
      </div>
    </section>
  );
}
