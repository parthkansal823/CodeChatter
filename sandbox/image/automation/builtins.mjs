// CodeChatter's own built-in steps for automations, as n8n has for working on data: Edit Fields, Filter, Sort, Limit, Aggregate, Summarize, Remove Duplicates,
// Split Out, Rename Keys, Merge, Compare Datasets, Stop and Error, Call a flow and Approval links, and CodeChatter's own: Run a command in the sandbox, Ask the
// room's AI, Post to the room's chat, and Read files and Write a file in the room's files. Written here, not taken from n8n. A built-in step is a code step marked `builtin` in the flow's
// file: host.mjs writes it as a module that calls run() here, and Activepieces' engine has already worked out its inputs' expressions. Each works on a list of
// items, as n8n's do; a single object counts as a list of one. The Automations tool's forms for them are in apps/web/components/room/tools/automations/builtins.ts.

import { spawn } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { isAbsolute, posix } from "node:path";

import { filesMatching, MOST_FILE_BYTES, roomPathOf, typeOf } from "./files.mjs";

/** The room's files, where a command runs. */
export const workspaceRoot = () => process.env.CC_WORKSPACE ?? "/workspace";
const MOST_OUTPUT = 1024 * 1024;

/**
 * The sandbox's door to CodeChatter (the agent's gateway, apps/runner/src/gateway.ts): the room's model in OpenAI's format, and the room's chat. It's
 * OPENAI_BASE_URL less its /v1, as every terminal, Run and flow has it.
 */
export function doorOf(env = process.env) {
  const base = String(env.OPENAI_BASE_URL ?? "http://127.0.0.1:3129/v1").replace(/\/+$/, "");
  return base.replace(/\/v1$/, "");
}

/** A call through the door, read as JSON, with the API's or OpenAI's way of saying what went wrong. */
async function askDoor(path, body, seconds) {
  const answer = await fetch(`${doorOf()}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(seconds * 1000) }).catch((error) => {
    throw new Error(error?.name === "TimeoutError" ? `CodeChatter didn't answer within ${seconds} seconds.` : "This step needs the room's sandbox: run the flow there.");
  });
  const text = await answer.text();
  let json = {};
  try {
    json = JSON.parse(text);
  } catch {
    // Said below.
  }
  if (!answer.ok) throw new Error(json?.error?.message ?? json?.detail ?? json?.message ?? `CodeChatter said ${answer.status}.`);
  return json;
}

/** A folder in the room, for a command to run in: inside the workspace, or the workspace itself. */
export function folderOf(folder) {
  const text = String(folder ?? "").trim().replace(/\\/g, "/");
  if (!text || text === "." || text === "/") return workspaceRoot();
  if (isAbsolute(text) || text.split("/").includes("..")) throw new Error(`"${text}" should be a folder in the room, such as src or tests.`);
  return posix.join(workspaceRoot(), text);
}

/** What a command is given: the flow's own environment less the engine's (its worker's port and token stay with the engine). */
export function commandEnv(env = process.env) {
  const out = {};
  for (const [name, value] of Object.entries(env)) if (!name.startsWith("AP_") && name !== "SANDBOX_ID" && value !== undefined) out[name] = value;
  return out;
}

/**
 * Asks the worker running this flow (host.mjs), on its engine's own loopback port. node:http, not fetch: fetch gives up on an answer after 300 seconds, and a
 * flow called may take longer, within its caller's time.
 */
async function askWorker(path, ask) {
  const port = process.env.AP_SANDBOX_WS_PORT;
  if (!port) throw new Error("This step only works in a run.");
  const body = JSON.stringify(ask);
  const { status, text } = await new Promise((resolve, reject) => {
    const request = httpRequest({ host: "127.0.0.1", port: Number(port), path, method: "POST", headers: { "content-type": "application/json", "content-length": Buffer.byteLength(body) } }, (response) => {
      let got = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => (got += chunk));
      response.on("end", () => resolve({ status: response.statusCode ?? 500, text: got }));
    });
    request.on("error", reject);
    request.end(body);
  });
  let answer = {};
  try {
    answer = JSON.parse(text);
  } catch {
    // Not JSON: said below.
  }
  if (status >= 400) throw new Error(answer.error ?? "The worker couldn't do it.");
  return answer;
}

/** Reads `a.b[0].c` from an item. An empty path is the item itself. */
export function read(item, path) {
  const text = String(path ?? "").trim();
  if (!text) return item;
  let current = item;
  for (const part of text.replace(/\[(\d+)\]/g, ".$1").split(".").filter(Boolean)) {
    if (current === null || current === undefined) return undefined;
    current = current[part];
  }
  return current;
}

function write(item, path, value) {
  const parts = String(path).replace(/\[(\d+)\]/g, ".$1").split(".").filter(Boolean);
  let current = item;
  for (const part of parts.slice(0, -1)) {
    if (current[part] === null || typeof current[part] !== "object") current[part] = {};
    current = current[part];
  }
  current[parts.at(-1)] = value;
}

function remove(item, path) {
  const parts = String(path).replace(/\[(\d+)\]/g, ".$1").split(".").filter(Boolean);
  const parent = parts.length > 1 ? read(item, parts.slice(0, -1).join(".")) : item;
  if (parent && typeof parent === "object") delete parent[parts.at(-1)];
}

/** A list from whatever was given: a list as it is, JSON text read, one value as a list of one, nothing as none. */
export function listOf(value) {
  let current = value;
  if (typeof current === "string") {
    const text = current.trim();
    if (!text) return [];
    try {
      current = JSON.parse(text);
    } catch {
      return [current];
    }
  }
  if (current === undefined || current === null) return [];
  return Array.isArray(current) ? current : [current];
}

const clone = (value) => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)));
const fieldsOf = (value) =>
  listOf(value)
    .flatMap((each) => (typeof each === "string" ? each.split(",") : [each]))
    .map((each) => String(each).trim())
    .filter(Boolean);
const objectOf = (value) => {
  if (value && typeof value === "object" && !Array.isArray(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = JSON.parse(value);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
  }
  if (value === undefined || value === null || value === "") return {};
  throw new Error("That should be an object of names and values, as JSON.");
};
const numberOf = (value) => (typeof value === "number" ? value : Number(String(value ?? "").trim()));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const keyOf = (item, fields) => JSON.stringify(fields.length ? fields.map((field) => read(item, field)) : item);

/** The tests Filter can do, by the words the tool shows. */
export const TESTS = {
  equals: (a, b) => same(a, b) || String(a) === String(b),
  not_equals: (a, b) => !(same(a, b) || String(a) === String(b)),
  contains: (a, b) => (Array.isArray(a) ? a.some((each) => same(each, b) || String(each) === String(b)) : String(a ?? "").includes(String(b ?? ""))),
  not_contains: (a, b) => !TESTS.contains(a, b),
  starts_with: (a, b) => String(a ?? "").startsWith(String(b ?? "")),
  ends_with: (a, b) => String(a ?? "").endsWith(String(b ?? "")),
  greater: (a, b) => numberOf(a) > numberOf(b),
  less: (a, b) => numberOf(a) < numberOf(b),
  at_least: (a, b) => numberOf(a) >= numberOf(b),
  at_most: (a, b) => numberOf(a) <= numberOf(b),
  before: (a, b) => Date.parse(a) < Date.parse(b),
  after: (a, b) => Date.parse(a) > Date.parse(b),
  matches: (a, b) => new RegExp(String(b ?? "")).test(String(a ?? "")),
  exists: (a) => a !== undefined && a !== null,
  not_exists: (a) => a === undefined || a === null,
  empty: (a) => a === undefined || a === null || a === "" || (Array.isArray(a) && !a.length) || (typeof a === "object" && !Array.isArray(a) && !Object.keys(a).length),
  not_empty: (a) => !TESTS.empty(a),
  is_true: (a) => a === true || a === "true",
  is_false: (a) => a === false || a === "false",
};

/** A field's value for setting: `$item.path` reads it from the item being changed, anything else is set as it is. */
const valueFor = (item, value) => (typeof value === "string" && value.startsWith("$item") ? read(item, value.slice(5).replace(/^\./, "")) : value);

export const BUILTINS = {
  /** Edit Fields: set fields on each item, keep only some, or take some away. */
  edit_fields(inputs) {
    const mode = inputs.mode || "set";
    const fields = mode === "set" ? objectOf(inputs.fields) : fieldsOf(inputs.fields);
    return listOf(inputs.items ?? [{}]).map((original) => {
      const item = original && typeof original === "object" && !Array.isArray(original) ? clone(original) : { value: original };
      if (mode === "set") {
        for (const [path, value] of Object.entries(fields)) write(item, path, clone(valueFor(original, value)));
        return item;
      }
      if (mode === "keep") {
        const kept = {};
        for (const path of fields) {
          const value = read(item, path);
          if (value !== undefined) write(kept, path, value);
        }
        return kept;
      }
      if (mode === "remove") {
        for (const path of fields) remove(item, path);
        return item;
      }
      throw new Error(`Edit Fields doesn't know how to "${mode}".`);
    });
  },

  /** Filter: the items whose field passes a test, or those that don't. */
  filter(inputs) {
    const test = TESTS[inputs.test || "equals"];
    if (!test) throw new Error(`Filter has no test called "${inputs.test}".`);
    const keep = inputs.keep !== "failing";
    return listOf(inputs.items).filter((item) => Boolean(test(read(item, inputs.field), inputs.value)) === keep);
  },

  /** Sort: by a field, as text, numbers or dates, either way. Items with nothing in that field go last. */
  sort(inputs) {
    const direction = inputs.direction === "descending" ? -1 : 1;
    const as = inputs.compare_as || "text";
    const value = (item) => {
      const raw = read(item, inputs.field);
      if (raw === undefined || raw === null || raw === "") return null;
      if (as === "number") return numberOf(raw);
      if (as === "date") return Date.parse(raw);
      return String(raw);
    };
    return [...listOf(inputs.items)].sort((a, b) => {
      const [x, y] = [value(a), value(b)];
      if (x === null || Number.isNaN(x)) return y === null || Number.isNaN(y) ? 0 : 1;
      if (y === null || Number.isNaN(y)) return -1;
      if (as === "text") return direction * String(x).localeCompare(String(y), undefined, { numeric: true, sensitivity: "base" });
      return direction * (x - y);
    });
  },

  /** Limit: the first few items, or the last few. */
  limit(inputs) {
    const most = Math.max(0, Math.floor(numberOf(inputs.max ?? 10)) || 0);
    const items = listOf(inputs.items);
    return inputs.from === "end" ? items.slice(Math.max(0, items.length - most)) : items.slice(0, most);
  },

  /** Aggregate: a field from every item, into one list; or every item, into one list. */
  aggregate(inputs) {
    const items = listOf(inputs.items);
    const fields = fieldsOf(inputs.fields);
    if (!fields.length) return { items, count: items.length };
    const out = { count: items.length };
    // Each list is named by its field's last part, unless two would share a name: then by the whole path.
    const last = (field) => field.split(".").at(-1);
    const shared = new Set(fields.map(last).filter((name, index, all) => all.indexOf(name) !== index));
    for (const field of fields) {
      const values = items.map((item) => read(item, field));
      out[shared.has(last(field)) ? field : last(field)] = inputs.skip_empty === false ? values : values.filter((each) => each !== undefined && each !== null && each !== "");
    }
    return out;
  },

  /** Summarize: count, sum, average, smallest, largest, count of different values, or values joined, for all items or for each group. */
  summarize(inputs) {
    const items = listOf(inputs.items);
    const groupBy = fieldsOf(inputs.group_by);
    const operation = inputs.operation || "count";
    const field = inputs.field;
    const groups = new Map();
    for (const item of items) {
      const key = keyOf(item, groupBy);
      if (!groups.has(key)) groups.set(key, { by: Object.fromEntries(groupBy.map((each) => [each.split(".").at(-1), read(item, each)])), items: [] });
      groups.get(key).items.push(item);
    }
    const summarize = (list) => {
      const values = list.map((item) => read(item, field)).filter((each) => each !== undefined && each !== null && each !== "");
      const numbers = values.map(numberOf).filter((each) => !Number.isNaN(each));
      switch (operation) {
        case "count":
          return field ? values.length : list.length;
        case "sum":
          return numbers.reduce((total, each) => total + each, 0);
        case "average":
          return numbers.length ? numbers.reduce((total, each) => total + each, 0) / numbers.length : null;
        case "min":
          return numbers.length ? Math.min(...numbers) : null;
        case "max":
          return numbers.length ? Math.max(...numbers) : null;
        case "count_unique":
          return new Set(values.map((each) => JSON.stringify(each))).size;
        case "join":
          return values.map(String).join(inputs.separator ?? ", ");
        default:
          throw new Error(`Summarize can't "${operation}".`);
      }
    };
    const name = `${operation}${field ? `_${String(field).split(".").at(-1)}` : ""}`;
    if (!groupBy.length) return { [name]: summarize(items) };
    return [...groups.values()].map((group) => ({ ...group.by, [name]: summarize(group.items) }));
  },

  /** Remove Duplicates: the same item, or the same values in some fields, kept once, the first time or the last. */
  remove_duplicates(inputs) {
    const fields = fieldsOf(inputs.fields);
    const items = listOf(inputs.items);
    const ordered = inputs.keep === "last" ? [...items].reverse() : items;
    const seen = new Set();
    const kept = ordered.filter((item) => {
      const key = keyOf(item, fields);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    return inputs.keep === "last" ? kept.reverse() : kept;
  },

  /** Split Out: a list inside each item becomes items of its own, with the item's other fields too if asked. */
  split_out(inputs) {
    const out = [];
    for (const item of listOf(inputs.items)) {
      const inside = read(item, inputs.field);
      const list = Array.isArray(inside) ? inside : inside === undefined || inside === null ? [] : [inside];
      for (const each of list) {
        const piece = each && typeof each === "object" && !Array.isArray(each) ? clone(each) : { [String(inputs.field).split(".").at(-1)]: each };
        if (inputs.keep_other_fields && item && typeof item === "object") {
          const rest = clone(item);
          remove(rest, inputs.field);
          out.push({ ...rest, ...piece });
        } else out.push(piece);
      }
    }
    return out;
  },

  /** Rename Keys: fields under new names, on each item. */
  rename_keys(inputs) {
    const renames = objectOf(inputs.renames);
    return listOf(inputs.items).map((original) => {
      const item = clone(original);
      for (const [from, to] of Object.entries(renames)) {
        const value = read(item, from);
        if (value === undefined) continue;
        remove(item, from);
        write(item, String(to), value);
      }
      return item;
    });
  },

  /** Merge: two lists, one after the other, matched by a field, side by side, or every pairing. */
  merge(inputs) {
    const first = listOf(inputs.first);
    const second = listOf(inputs.second);
    const mode = inputs.mode || "append";
    const part = (value, name) => (value === undefined || value === null ? {} : typeof value === "object" ? value : { [name]: value });
    const combine = (a, b) => ({ ...part(a, "first"), ...part(b, "second") });
    if (mode === "append") return [...first, ...second];
    if (mode === "position") return Array.from({ length: Math.max(first.length, second.length) }, (_, index) => combine(first[index], second[index]));
    if (mode === "every_pair") return first.flatMap((a) => second.map((b) => combine(a, b)));
    if (mode === "match") {
      const firstKey = inputs.first_key;
      const secondKey = inputs.second_key || firstKey;
      if (!firstKey) throw new Error("Merge needs a field to match the lists by.");
      const index = new Map();
      for (const b of second) {
        const key = JSON.stringify(read(b, secondKey));
        if (!index.has(key)) index.set(key, []);
        index.get(key).push(b);
      }
      const keep = inputs.keep || "both";
      const used = new Set();
      const out = [];
      for (const a of first) {
        const matches = index.get(JSON.stringify(read(a, firstKey))) ?? [];
        if (matches.length) {
          matches.forEach((b) => used.add(b));
          if (keep !== "unmatched") for (const b of matches) out.push(combine(a, b));
        } else if (keep === "all_first" || keep === "all" || keep === "unmatched") out.push(clone(a));
      }
      if (keep === "all") for (const b of second) if (!used.has(b)) out.push(clone(b));
      return out;
    }
    throw new Error(`Merge doesn't know how to "${mode}".`);
  },

  /** Compare Datasets: what's only in the first list, only in the second, the same in both, and different, matched by a field. */
  compare_datasets(inputs) {
    const firstKey = inputs.first_key;
    const secondKey = inputs.second_key || firstKey;
    if (!firstKey) throw new Error("Compare Datasets needs a field to match the lists by.");
    const second = new Map(listOf(inputs.second).map((item) => [JSON.stringify(read(item, secondKey)), item]));
    const result = { only_in_first: [], only_in_second: [], same: [], different: [] };
    const matched = new Set();
    for (const item of listOf(inputs.first)) {
      const key = JSON.stringify(read(item, firstKey));
      if (!second.has(key)) {
        result.only_in_first.push(item);
        continue;
      }
      matched.add(key);
      const other = second.get(key);
      if (same(item, other)) result.same.push(item);
      else {
        const fields = [...new Set([...Object.keys(item ?? {}), ...Object.keys(other ?? {})])].filter((field) => !same(item?.[field], other?.[field]));
        result.different.push({ key: read(item, firstKey), first: item, second: other, fields });
      }
    }
    for (const [key, item] of second) if (!matched.has(key)) result.only_in_second.push(item);
    return result;
  },

  /**
   * Call a flow (n8n's Execute Workflow): another flow in the room, one that starts on "Called by another flow", runs with what's sent, and its last step's
   * output comes back; or, not waiting, it's queued and its run's id comes back. The worker running this flow does it (host.mjs, on the engine's own port).
   */
  async call_flow(inputs) {
    if (!process.env.AP_SANDBOX_WS_PORT) throw new Error("Call a flow only works in a run.");
    let data = inputs.data ?? {};
    if (typeof data === "string") {
      try {
        data = data.trim() ? JSON.parse(data) : {};
      } catch {
        throw new Error("What to send isn't valid JSON.");
      }
    }
    const answer = await askWorker("/v1/codechatter/call-flow", { flowId: String(inputs.flow ?? ""), data, wait: inputs.wait !== false && inputs.wait !== "false" });
    return answer.queued ? { runId: answer.runId, queued: true } : answer.output;
  },

  /**
   * Save run data (n8n's Execution Data): a few things this run is kept with, to be found by in the list of runs, such as the order or customer it was for.
   * Up to 10 a run, each a name of up to 50 characters and text of up to 512; a later step can add more or change one. It gives back all the run keeps.
   */
  async run_data(inputs) {
    const given = objectOf(inputs.data);
    const data = {};
    for (const [key, value] of Object.entries(given)) {
      const name = String(key).trim();
      if (!name) continue;
      if (name.length > 50) throw new Error(`"${name.slice(0, 20)}…" is a name over 50 characters.`);
      const text = value === undefined || value === null ? "" : typeof value === "string" ? value : JSON.stringify(value);
      if (text.length > 512) throw new Error(`What's kept as ${name} is over 512 characters.`);
      data[name] = text;
    }
    if (!Object.keys(data).length) throw new Error("Say what to keep, such as {\"order\": \"{{trigger.output.body.id}}\"}.");
    if (!process.env.AP_SANDBOX_WS_PORT) throw new Error("Save run data only works in a run.");
    const answer = await askWorker("/v1/codechatter/run-data", { data });
    return { saved: answer.data ?? data };
  },

  /**
   * Approval links: a link for each choice ("approve, reject"), to send to whoever decides, before the run waits for one to be clicked with Respond and Wait
   * for Next Webhook (the webhook piece), which then gives the choice as its queryParams.action. Made before the wait, as the wait's own address only exists
   * once the run has paused.
   */
  async approval_links(inputs) {
    const choices = String(inputs.choices ?? "approve, reject")
      .split(",")
      .map((each) => each.trim())
      .filter(Boolean)
      .slice(0, 10);
    if (!choices.length) throw new Error("Give at least one choice, such as approve.");
    const { url } = await askWorker("/v1/codechatter/approval-links", {});
    const links = Object.fromEntries(choices.map((choice) => [choice, `${url}?action=${encodeURIComponent(choice)}`]));
    return { ...links, links, url };
  },

  /**
   * Run a command (n8n's Execute Command), in the room's sandbox, in its files: tests, a build, a deploy script, git. It runs where the flow does (inside
   * the sandbox's jail, with no network but the room's own services), and gives back its exit code and what it printed. A command that fails fails the
   * step, unless told not to, so a router can look at the code instead.
   */
  async run_command(inputs) {
    const command = String(inputs.command ?? "").trim();
    if (!command) throw new Error("Say which command to run, such as npm test.");
    const cwd = folderOf(inputs.folder);
    const seconds = Math.min(Math.max(Number(inputs.seconds) || 60, 1), 600);
    const failOnError = inputs.fail_on_error !== false && inputs.fail_on_error !== "false";
    const started = Date.now();
    const result = await new Promise((resolve) => {
      const child = spawn("bash", ["-lc", command], { cwd, env: commandEnv(), stdio: ["ignore", "pipe", "pipe"], detached: true });
      const out = { stdout: "", stderr: "", cut: false };
      const keep = (name) => (chunk) => {
        if (out[name].length < MOST_OUTPUT) out[name] += chunk.toString("utf8");
        else out.cut = true;
      };
      child.stdout.on("data", keep("stdout"));
      child.stderr.on("data", keep("stderr"));
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        // The whole group: a command's own children go too.
        try {
          process.kill(-child.pid, "SIGKILL");
        } catch {
          child.kill("SIGKILL");
        }
      }, seconds * 1000);
      child.on("error", (error) => {
        clearTimeout(timer);
        resolve({ exitCode: null, stdout: "", stderr: String(error.message), timedOut: false, cut: false });
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        resolve({ exitCode: timedOut ? null : code, stdout: out.stdout.slice(0, MOST_OUTPUT), stderr: out.stderr.slice(0, MOST_OUTPUT), timedOut, cut: out.cut });
      });
    });
    const answer = { exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr, timedOut: result.timedOut, durationMs: Date.now() - started, ...(result.cut && { cut: true }) };
    if (failOnError && (result.timedOut || result.exitCode !== 0)) {
      const tail = (result.stderr || result.stdout).trim().split("\n").slice(-5).join("\n");
      throw new Error(result.timedOut ? `The command took longer than ${seconds} ${seconds === 1 ? "second" : "seconds"}, so it was stopped.` : `The command ended with ${result.exitCode}${tail ? `: ${tail}` : "."}`);
    }
    return answer;
  },

  /**
   * Ask the room's AI: the model the room uses, through its gateway (no key in the room), with the room's rules on using it and its limits. Its answer as
   * text, or read as JSON when asked, for the next steps to use.
   */
  async ask_ai(inputs) {
    const prompt = String(inputs.prompt ?? "").trim();
    if (!prompt) throw new Error("Say what to ask.");
    const asJson = inputs.json === true || inputs.json === "true";
    const messages = [];
    const instructions = String(inputs.instructions ?? "").trim();
    if (instructions || asJson) messages.push({ role: "system", content: [instructions, asJson ? "Answer with JSON only, no other words." : ""].filter(Boolean).join("\n\n") });
    messages.push({ role: "user", content: prompt.slice(0, 100_000) });
    const answer = await askDoor("/v1/chat/completions", { model: String(inputs.model ?? "").trim() || "default", messages, ...(inputs.temperature !== undefined && inputs.temperature !== "" && { temperature: Number(inputs.temperature) }) }, 300);
    const text = String(answer?.choices?.[0]?.message?.content ?? "").trim();
    const usage = answer?.usage ? { inputTokens: answer.usage.prompt_tokens ?? null, outputTokens: answer.usage.completion_tokens ?? null } : null;
    if (!asJson) return { text, model: answer?.model ?? null, usage };
    const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
    try {
      return { json: JSON.parse(fenced ? fenced[1] : text), text, model: answer?.model ?? null, usage };
    } catch {
      throw new Error(`The AI's answer isn't JSON: ${text.slice(0, 200)}`);
    }
  },

  /** Post to the room's chat: a message everyone in the room sees, marked as the automations', never as a person's. 20 a minute at most. */
  async post_to_chat(inputs) {
    const text = String(inputs.text ?? "").trim();
    if (!text) throw new Error("Say what to post.");
    if (text.length > 4000) throw new Error("A message is up to 4,000 characters.");
    const posted = await askDoor("/codechatter/chat", { text }, 30);
    return { id: posted.id, text, postedAt: posted.createdAt };
  },

  /**
   * Read files (n8n's Read Files from Disk): the room's files a path or a pattern names (reports/*.csv, docs/**\/*.md), one item each, with the file as a
   * step's file is (for File Helper, CSV, an email's attachment) and, when asked, its text. A path that isn't there fails the step; a pattern can find none.
   */
  async read_files(inputs) {
    const asked = String(inputs.paths ?? "")
      .split("\n")
      .map((each) => each.trim())
      .filter(Boolean);
    if (!asked.length) throw new Error("Say which files, such as reports/*.csv.");
    const most = Math.min(Math.max(Math.floor(numberOf(inputs.max ?? 100)) || 100, 1), 100);
    const asText = inputs.as_text === true || inputs.as_text === "true";
    const paths = [];
    for (const each of asked) {
      const { paths: found, more } = filesMatching(workspaceRoot(), each, most);
      if (more || paths.length + found.length > most) throw new Error(`More than ${most} files match: name fewer, or raise the most to read.`);
      for (const path of found) if (!paths.includes(path)) paths.push(path);
    }
    const items = [];
    let total = 0;
    for (const path of paths) {
      const full = posix.join(workspaceRoot(), path);
      let size;
      try {
        const stat = statSync(full);
        if (!stat.isFile()) throw new Error("not a file");
        size = stat.size;
      } catch {
        throw new Error(`There's no file ${path} in the room.`);
      }
      if (size > MOST_FILE_BYTES) throw new Error(`${path} is over ${MOST_FILE_BYTES / 1024 / 1024} MB, the most a step's file can be.`);
      total += size;
      if (total > 5 * MOST_FILE_BYTES) throw new Error(`These files are over ${(5 * MOST_FILE_BYTES) / 1024 / 1024} MB together: read fewer at a time.`);
      const data = readFileSync(full);
      const fileName = path.split("/").at(-1);
      const { url } = await askWorker("/v1/codechatter/files", { name: fileName, data: data.toString("base64") });
      items.push({ path, fileName, size, mimeType: typeOf(fileName), file: url, ...(asText && { text: data.toString("utf8") }) });
    }
    return items;
  },

  /**
   * Write a file (n8n's Write File to Disk): text, JSON or a step's file (from File Helper, CSV, an earlier Read files, or any address) into the room's files,
   * as anyone in the room then sees it. A new file, replacing one, or adding to its end; folders are made as needed.
   */
  async write_file(inputs) {
    const path = roomPathOf(inputs.path);
    const full = posix.join(workspaceRoot(), path);
    const mode = inputs.mode || "replace";
    if (!["replace", "append", "new"].includes(mode)) throw new Error(`Write a file doesn't know how to "${mode}".`);
    const there = existsSync(full);
    if (there && statSync(full).isDirectory()) throw new Error(`${path} is a folder.`);
    if (mode === "new" && there) throw new Error(`${path} is already in the room, and this step only makes new files.`);
    const content = inputs.content;
    let data;
    if (inputs.content_is === "file") {
      // A step's file is its address (or a data: address); an object with one is taken too: Read files' and Unzip File's file, Create File's url.
      const address = typeof content === "string" ? content.trim() : typeof content?.file === "string" ? content.file : typeof content?.url === "string" ? content.url : "";
      if (!/^(data:|https?:\/\/)/.test(address)) throw new Error("Give a file's address, as an earlier step gives it (Read files' file, say).");
      const answer = await fetch(address, { signal: AbortSignal.timeout(60_000) }).catch(() => null);
      if (!answer?.ok) throw new Error(answer ? `The file couldn't be read: its address said ${answer.status}.` : "The file couldn't be read from its address.");
      data = Buffer.from(await answer.arrayBuffer());
    } else if (typeof content === "string") data = Buffer.from(content, "utf8");
    else if (content === undefined || content === null) data = Buffer.alloc(0);
    else data = Buffer.from(`${JSON.stringify(content, null, 2)}\n`, "utf8");
    if (data.length > MOST_FILE_BYTES) throw new Error(`That's over ${MOST_FILE_BYTES / 1024 / 1024} MB, the most this step writes.`);
    mkdirSync(posix.dirname(full), { recursive: true });
    if (mode === "append") appendFileSync(full, data);
    else writeFileSync(full, data);
    return { path, size: statSync(full).size, written: data.length, action: !there ? "created" : mode === "append" ? "added to" : "replaced" };
  },

  /** Stop and Error: stops the run, with this message, so an error flow or a person sees why. */
  stop_and_error(inputs) {
    throw new Error(String(inputs.message || "This flow was stopped on purpose."));
  },
};

/** What a built-in code step calls. */
export async function run(name, inputs) {
  const builtin = BUILTINS[name];
  if (!builtin) throw new Error(`There's no built-in step called "${name}".`);
  return builtin(inputs ?? {});
}
