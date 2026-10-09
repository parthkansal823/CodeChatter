import type { DatabaseKind, DatabaseTable, QueryResultSet } from "@codechatter/contracts";

/**
 * The query console and table browser (roadmap §14 D). Queries run inside each
 * database's own container with its own client, so nothing new is exposed:
 * these build the client's command line and read what it prints. The query is
 * always one argument, never part of a shell script.
 */

/** Most rows a result shows; anything past it is counted as truncated. */
export const MAX_ROWS = 500;
/** Rows the table browser shows. */
export const PREVIEW_ROWS = 100;
/** How psql prints NULL here: a control character no real value starts with. */
const PG_NULL = "\x1a";

/** The client command for a console query, run as the database's own user inside its container. */
export function queryCommand(kind: DatabaseKind, query: string, password: string): { cmd: string[]; env: string[] } {
  switch (kind) {
    case "postgres":
      return {
        cmd: ["psql", "-X", "-v", "ON_ERROR_STOP=1", "-A", "-F", "\x1f", "-R", "\x1e", "-P", "footer=on", "-P", `null=${PG_NULL}`, "-U", "app", "-d", "app", "-c", query],
        env: [`PGPASSWORD=${password}`, "PGOPTIONS=-c statement_timeout=30s"],
      };
    case "mysql":
      return { cmd: ["mysql", "--xml", "-vv", "--init-command=SET SESSION max_execution_time=30000", "-u", "app", "app", "-e", query], env: [`MYSQL_PWD=${password}`] };
    case "mariadb":
      return { cmd: ["mariadb", "--xml", "-vv", "--init-command=SET SESSION max_statement_time=30", "-u", "app", "app", "-e", query], env: [`MYSQL_PWD=${password}`] };
    case "mongo":
      return {
        cmd: ["mongosh", "--quiet", "--norc", mongoUrl(password), "--json=relaxed", "--eval", mongoEval(query)],
        env: [],
      };
    case "redis":
      // valkey-cli reads one command per line from stdin, quotes and all; the password is in REDISCLI_AUTH.
      return { cmd: ["sh", "-c", 'printf "%s\\n" "$1" | valkey-cli --no-auth-warning --json', "sh", query], env: [] };
  }
}

/**
 * One mongosh expression, its answer printed as JSON. A cursor (find,
 * aggregate) can't be printed, so it's read into an array first: one more
 * document than shown, to tell whether there were more.
 */
export function mongoEval(expression: string): string {
  const code = expression.trim().replace(/;+$/, "");
  return [
    `const __cc = (${code});`,
    `(__cc !== null && typeof __cc === "object" && typeof __cc.toArray === "function") ? (typeof __cc.limit === "function" ? __cc.limit(${MAX_ROWS + 1}) : __cc).toArray() : __cc`,
  ].join("\n");
}

/**
 * A backup: the client's dump on its standard output. The SQL dumps replace
 * what they hold when loaded again (pg_dump --clean, mysqldump's DROP TABLE),
 * so a backup restores by running it. Redis gives its RDB snapshot.
 */
export function dumpCommand(kind: DatabaseKind, password: string): { cmd: string[]; env: string[]; extension: string; contentType: string } {
  switch (kind) {
    case "postgres":
      return {
        cmd: ["pg_dump", "-U", "app", "-d", "app", "--clean", "--if-exists", "--no-owner", "--no-privileges"],
        env: [`PGPASSWORD=${password}`],
        extension: "sql",
        contentType: "application/sql",
      };
    case "mysql":
      return { cmd: ["mysqldump", "-u", "app", "--single-transaction", "--no-tablespaces", "app"], env: [`MYSQL_PWD=${password}`], extension: "sql", contentType: "application/sql" };
    case "mariadb":
      return { cmd: ["mariadb-dump", "-u", "app", "--single-transaction", "app"], env: [`MYSQL_PWD=${password}`], extension: "sql", contentType: "application/sql" };
    case "mongo":
      return { cmd: ["mongodump", `--uri=${mongoUrl(password)}`, "--archive", "--gzip", "--quiet"], env: [], extension: "archive.gz", contentType: "application/gzip" };
    case "redis":
      return { cmd: ["valkey-cli", "--no-auth-warning", "--rdb", "-"], env: [], extension: "rdb", contentType: "application/octet-stream" };
  }
}

/**
 * Run a file through the database's client: SQL, a mongosh script or a
 * mongodump archive, or Redis commands. The client reads exactly `bytes` from
 * standard input (head -c): the exec's stdin can't be closed on its own on
 * every Docker, so the client gets its end of input this way.
 */
export function loadCommand(kind: DatabaseKind, password: string, bytes: number, archive: boolean): { cmd: string[]; env: string[] } {
  const piped = (client: string) => ["sh", "-c", `head -c "$1" | ${client}`, "sh", String(bytes), mongoUrl(password)];
  switch (kind) {
    case "postgres":
      return { cmd: piped("psql -X -q -v ON_ERROR_STOP=1 -o /dev/null -U app -d app -f -"), env: [`PGPASSWORD=${password}`] };
    case "mysql":
      return { cmd: piped("mysql -u app app"), env: [`MYSQL_PWD=${password}`] };
    case "mariadb":
      return { cmd: piped("mariadb -u app app"), env: [`MYSQL_PWD=${password}`] };
    case "mongo":
      return { cmd: piped(archive ? 'mongorestore --uri="$2" --archive --gzip --drop --quiet' : 'mongosh --quiet --norc "$2"'), env: [] };
    case "redis":
      return { cmd: piped("valkey-cli --no-auth-warning"), env: [] };
  }
}

/** What kind of file a load is, from its first bytes: a gzip archive (mongodump), or a Redis snapshot. */
export function sniff(head: Buffer): { archive: boolean; rdb: boolean } {
  return { archive: head[0] === 0x1f && head[1] === 0x8b, rdb: head.subarray(0, 5).toString("latin1") === "REDIS" };
}

function mongoUrl(password: string): string {
  return `mongodb://app:${password}@127.0.0.1:27017/app?authSource=admin`;
}

/** The console's answer from what the client printed. */
export function parseQueryOutput(kind: DatabaseKind, stdout: string, stderr: string, exitCode: number | null, query: string): { results: QueryResultSet[]; error: string | null } {
  switch (kind) {
    case "postgres":
      return { results: parsePsql(stdout), error: exitCode === 0 ? null : clientError(stderr, exitCode) };
    case "mysql":
    case "mariadb":
      return { results: parseMysqlXml(stdout), error: exitCode === 0 ? null : clientError(stderr, exitCode) };
    case "mongo":
      return parseMongo(stdout, stderr, exitCode);
    case "redis":
      return { results: [parseValkey(stdout, query)], error: exitCode === 0 ? null : clientError(stderr, exitCode) };
  }
}

/**
 * psql in unaligned mode: fields split by \x1f and records by \x1e, so values
 * with newlines stay whole. Each table ends with its "(N rows)" footer; the
 * other lines are statements' status ("INSERT 0 1").
 */
export function parsePsql(out: string): QueryResultSet[] {
  const sets: QueryResultSet[] = [];
  const footer = /\x1e\(\d+ rows?\)\n/;
  let rest = out;
  for (let m = footer.exec(rest); m; m = footer.exec(rest)) {
    const chunk = rest.slice(0, m.index);
    rest = rest.slice(m.index + m[0].length);
    const first = chunk.indexOf("\x1e");
    const head = (first < 0 ? chunk : chunk.slice(0, first)).split("\n");
    const header = head.pop() ?? "";
    sets.push(...messages(head.join("\n")));
    const records = first < 0 ? [] : chunk.slice(first + 1).split("\x1e");
    sets.push(capped(header.split("\x1f"), records.map((record) => record.split("\x1f").map((v) => (v === PG_NULL ? null : v)))));
  }
  sets.push(...messages(rest));
  return sets;
}

/**
 * mysql and mariadb with --xml -vv: each statement is echoed between dashed
 * lines, then comes its result set as XML ("Empty set" when it has no rows) or
 * its status ("Query OK, 2 rows affected").
 */
export function parseMysqlXml(out: string): QueryResultSet[] {
  const lines = out.split("\n");
  const sets: QueryResultSet[] = [];
  const dashes = (line: string | undefined) => line !== undefined && /^-{14}$/.test(line);
  for (let i = 0; i < lines.length; i++) {
    if (!dashes(lines[i])) continue;
    let end = i + 1;
    while (end < lines.length && !dashes(lines[end])) end++; // the echoed statement
    let next = end + 1;
    while (next < lines.length && !dashes(lines[next])) next++;
    const body = lines.slice(end + 1, next).join("\n");
    if (body.includes("<resultset")) sets.push(xmlRows(body));
    else {
      const text = body
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line && line !== "Bye")
        .join(" · ");
      if (text) sets.push({ type: "message", text });
    }
    i = next - 1;
  }
  return sets;
}

function xmlRows(xml: string): QueryResultSet {
  let columns: string[] = [];
  const rows: (string | null)[][] = [];
  for (const row of xml.matchAll(/<row>([\s\S]*?)<\/row>/g)) {
    const fields = [...row[1]!.matchAll(/<field name="([^"]*)"(?: xsi:nil="true" \/>|>([\s\S]*?)<\/field>)/g)];
    if (columns.length === 0) columns = fields.map((field) => unescapeXml(field[1]!));
    rows.push(fields.map((field) => (field[2] === undefined ? null : unescapeXml(field[2]))));
  }
  return capped(columns, rows);
}

function unescapeXml(text: string): string {
  return text.replace(/&(lt|gt|amp|quot|apos|#\d+|#x[0-9a-f]+);/gi, (_, entity: string) => {
    if (entity[0] === "#") return String.fromCodePoint(entity[1] === "x" || entity[1] === "X" ? Number.parseInt(entity.slice(2), 16) : Number(entity.slice(1)));
    return { lt: "<", gt: ">", amp: "&", quot: '"', apos: "'" }[entity.toLowerCase()] ?? "";
  });
}

/**
 * mongosh --json: the answer as relaxed Extended JSON. A list of documents
 * becomes a table (top-level fields as columns); anything else is shown as
 * JSON. A failure prints the error as JSON too.
 */
export function parseMongo(stdout: string, stderr: string, exitCode: number | null): { results: QueryResultSet[]; error: string | null } {
  let value: unknown;
  try {
    value = JSON.parse(stdout);
  } catch {
    return { results: [], error: exitCode === 0 ? null : clientError(stderr || stdout, exitCode) };
  }
  if (exitCode !== 0) {
    const message = typeof value === "object" && value !== null && "message" in value ? String((value as { message: unknown }).message) : stdout.trim();
    return { results: [], error: message.split("\n")[0] ?? message };
  }
  if (Array.isArray(value) && value.length > 0 && value.every((doc) => typeof doc === "object" && doc !== null && !Array.isArray(doc))) {
    const columns = [...new Set(value.flatMap((doc) => Object.keys(doc as object)))].slice(0, 50);
    return { results: [capped(columns, value.map((doc) => columns.map((column) => cell((doc as Record<string, unknown>)[column]))))], error: null };
  }
  return { results: [{ type: "value", text: JSON.stringify(value, null, 2) }], error: null };
}

/** A document's field as table text: strings as they are, ids and dates by their value, the rest as JSON. */
function cell(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value === "string") return value;
  if (typeof value === "object") {
    const keys = Object.keys(value);
    if (keys.length === 1 && (keys[0] === "$oid" || keys[0] === "$date")) return String((value as Record<string, unknown>)[keys[0]]);
  }
  return JSON.stringify(value);
}

/** valkey-cli --json reading commands from stdin: one JSON reply per line, `error:"…"` for a failed one. */
export function parseValkey(stdout: string, query: string): QueryResultSet {
  const commands = query.split("\n").map((line) => line.trim()).filter(Boolean);
  const replies = stdout.split("\n").filter((line) => line.length > 0);
  const rows = commands.map((command, i) => {
    const reply = replies[i] ?? "";
    if (reply.startsWith("error:")) return [command, `(error) ${jsonText(reply.slice(6))}`];
    return [command, jsonText(reply)];
  });
  return capped(["Command", "Reply"], rows);
}

/** A JSON reply as people read it: strings without their quotes. */
function jsonText(json: string): string {
  try {
    const value: unknown = JSON.parse(json);
    return typeof value === "string" ? value : JSON.stringify(value);
  } catch {
    return json;
  }
}

/** The tables, views, collections or keys of a database: the command and how to read its answer. */
export function tablesCommand(kind: DatabaseKind): string {
  switch (kind) {
    case "postgres":
      return "select table_schema, table_name, table_type from information_schema.tables where table_schema not in ('pg_catalog', 'information_schema') order by table_schema <> 'public', 1, 2";
    case "mysql":
    case "mariadb":
      return "select table_name, table_type from information_schema.tables where table_schema = database() order by table_name";
    case "mongo":
      return "db.getCollectionNames().sort()";
    case "redis":
      return "";
  }
}

export function tablesFrom(kind: DatabaseKind, result: QueryResultSet[]): DatabaseTable[] {
  const rows = result.find((set) => set.type === "rows");
  if (kind === "mongo") {
    const value = result.find((set) => set.type === "value");
    return value ? (JSON.parse(value.text) as string[]).map((name) => ({ name, detail: "collection" })) : [];
  }
  if (!rows || rows.type !== "rows") return [];
  if (kind === "postgres") {
    return rows.rows.map(([schema, name, type]) => ({ name: name ?? "", ...(schema !== "public" && { schema: schema ?? "" }), ...(type === "VIEW" && { detail: "view" }) }));
  }
  return rows.rows.map(([name, type]) => ({ name: name ?? "", ...(type === "VIEW" && { detail: "view" }) }));
}

/** The first rows of a table or collection, as a console query. Names are quoted for the database. */
export function previewQuery(kind: Exclude<DatabaseKind, "redis">, table: { name: string; schema?: string }): string {
  switch (kind) {
    case "postgres": {
      const quote = (id: string) => `"${id.replace(/"/g, '""')}"`;
      return `select * from ${table.schema ? `${quote(table.schema)}.` : ""}${quote(table.name)} limit ${PREVIEW_ROWS}`;
    }
    case "mysql":
    case "mariadb":
      return `select * from \`${table.name.replace(/`/g, "``")}\` limit ${PREVIEW_ROWS}`;
    case "mongo":
      return `db.getCollection(${JSON.stringify(table.name)}).find().limit(${PREVIEW_ROWS})`;
  }
}

/** For a Redis key: the command that shows its value, by its type, and the columns of the answer. */
export function redisPreview(type: string): { args: string[]; columns: string[]; pairs: boolean } | null {
  switch (type) {
    case "string":
      return { args: ["GET", "{key}"], columns: ["Value"], pairs: false };
    case "hash":
      return { args: ["HGETALL", "{key}"], columns: ["Field", "Value"], pairs: true };
    case "list":
      return { args: ["LRANGE", "{key}", "0", String(PREVIEW_ROWS - 1)], columns: ["Value"], pairs: false };
    case "set":
      return { args: ["SRANDMEMBER", "{key}", String(PREVIEW_ROWS)], columns: ["Member"], pairs: false };
    case "zset":
      return { args: ["ZRANGE", "{key}", "0", String(PREVIEW_ROWS - 1), "WITHSCORES"], columns: ["Member", "Score"], pairs: true };
    default:
      return null;
  }
}

/** Rows from a Redis preview reply (a JSON value from valkey-cli --json). */
export function redisRows(reply: string, pairs: boolean): (string | null)[][] {
  let value: unknown;
  try {
    value = JSON.parse(reply);
  } catch {
    return [[reply]];
  }
  if (typeof value === "string") return [[value]];
  if (Array.isArray(value)) {
    if (!pairs) return value.map((item) => [typeof item === "string" ? item : JSON.stringify(item)]);
    const rows: (string | null)[][] = [];
    for (let i = 0; i + 1 < value.length; i += 2) rows.push([String(value[i]), String(value[i + 1])]);
    return rows;
  }
  if (value && typeof value === "object") return Object.entries(value).map(([k, v]) => [k, typeof v === "string" ? v : JSON.stringify(v)]);
  return [[value === null ? null : String(value)]];
}

export function capped(columns: string[], rows: (string | null)[][]): QueryResultSet {
  return rows.length > MAX_ROWS ? { type: "rows", columns, rows: rows.slice(0, MAX_ROWS), truncated: true } : { type: "rows", columns, rows };
}

function messages(text: string): QueryResultSet[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => ({ type: "message", text: line }));
}

/** The client's own words for what went wrong, without its noise. */
function clientError(stderr: string, exitCode: number | null): string {
  if (exitCode === 124) return "The query took longer than 30 seconds and was stopped.";
  const lines = stderr
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => line && !/^(mysql|mariadb): \[Warning\]/.test(line));
  return lines.join("\n").replace(/^ERROR \d+ \(\w+\) at line \d+: /, "") || `The query failed (exit code ${exitCode}).`;
}
