import { describe, expect, it } from "vitest";

import { loadCommand, MAX_ROWS, mongoEval, parseMongo, parseMysqlXml, parsePsql, parseQueryOutput, parseValkey, previewQuery, redisRows, sniff, tablesFrom } from "./database-queries.js";

// Outputs captured from the real clients (postgres:18-alpine, mysql:8.4, mongo:8.0, valkey:9-alpine).
const US = "\x1f";
const RS = "\x1e";

describe("parsePsql", () => {
  it("reads a table, keeping a value with a newline whole", () => {
    expect(parsePsql(`id${US}name${RS}2${US}line\nbreak${RS}1${US}\x1a${RS}(2 rows)\n`)).toEqual([
      { type: "rows", columns: ["id", "name"], rows: [["2", "line\nbreak"], ["1", null]] },
    ]);
  });

  it("tells tables from statements' status, in order", () => {
    expect(parsePsql(`a${RS}1${RS}(1 row)\nCREATE TABLE\nb${RS}(0 rows)\nINSERT 0 2\n`)).toEqual([
      { type: "rows", columns: ["a"], rows: [["1"]] },
      { type: "message", text: "CREATE TABLE" },
      { type: "rows", columns: ["b"], rows: [] },
      { type: "message", text: "INSERT 0 2" },
    ]);
  });

  it("caps long results", () => {
    const rows = Array.from({ length: MAX_ROWS + 5 }, (_, i) => String(i)).join(RS);
    const [set] = parsePsql(`n${RS}${rows}${RS}(${MAX_ROWS + 5} rows)\n`);
    expect(set).toMatchObject({ type: "rows", truncated: true });
    expect(set?.type === "rows" && set.rows.length).toBe(MAX_ROWS);
  });
});

describe("parseMysqlXml", () => {
  const out = [
    "--------------",
    "select id, name from t",
    "--------------",
    "",
    '<?xml version="1.0"?>',
    "",
    '<resultset statement="select id, name from t" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">',
    "  <row>",
    '\t<field name="id">1</field>',
    '\t<field name="name">a\tb &lt;x&amp;y&gt;</field>',
    "  </row>",
    "",
    "  <row>",
    '\t<field name="id">2</field>',
    '\t<field name="name" xsi:nil="true" />',
    "  </row>",
    "</resultset>",
    "2 rows in set",
    "",
    "--------------",
    "update t set id = 4 where id = 2",
    "--------------",
    "",
    "Query OK, 1 row affected",
    "Rows matched: 1  Changed: 1  Warnings: 0",
    "",
    "--------------",
    "select 1 as one where false",
    "--------------",
    "",
    '<?xml version="1.0"?>',
    '<resultset statement="select 1 as one where false" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"></resultset>',
    "Empty set",
    "",
    "Bye",
    "",
  ].join("\n");

  it("reads result sets (NULL included) and statements' status", () => {
    expect(parseMysqlXml(out)).toEqual([
      { type: "rows", columns: ["id", "name"], rows: [["1", "a\tb <x&y>"], ["2", null]] },
      { type: "message", text: "Query OK, 1 row affected · Rows matched: 1  Changed: 1  Warnings: 0" },
      { type: "rows", columns: [], rows: [] },
    ]);
  });
});

describe("parseMongo", () => {
  it("shows documents as a table", () => {
    const docs = JSON.stringify([
      { _id: { $oid: "6ac8d1d02e3db9b8e7d1d198" }, name: "Ada", born: { $date: "1815-12-10T00:00:00Z" } },
      { _id: { $oid: "6ac8d1d02e3db9b8e7d1d199" }, name: "Linus", tags: ["git"] },
    ]);
    expect(parseMongo(docs, "", 0)).toEqual({
      results: [
        {
          type: "rows",
          columns: ["_id", "name", "born", "tags"],
          rows: [
            ["6ac8d1d02e3db9b8e7d1d198", "Ada", "1815-12-10T00:00:00Z", null],
            ["6ac8d1d02e3db9b8e7d1d199", "Linus", null, '["git"]'],
          ],
        },
      ],
      error: null,
    });
  });

  it("shows any other answer as JSON, and an error by its message", () => {
    expect(parseMongo("2\n", "", 0)).toEqual({ results: [{ type: "value", text: "2" }], error: null });
    expect(parseMongo(JSON.stringify({ message: "db.nope.findd is not a function", name: "TypeError" }), "", 1)).toEqual({ results: [], error: "db.nope.findd is not a function" });
  });

  it("reads a cursor into an array, one past the limit", () => {
    expect(mongoEval("db.people.find({ a: 1 });")).toContain("const __cc = (db.people.find({ a: 1 }));");
    expect(mongoEval("db.people.find()")).toContain(`__cc.limit(${MAX_ROWS + 1})`);
  });
});

describe("parseValkey", () => {
  it("pairs each command with its reply, errors included", () => {
    const out = ['"OK"', '"two words"', "2", `error:"ERR unknown command 'BADCMD', with args beginning with: "`, '["y","x"]', ""].join("\n");
    const query = 'SET a "two words"\nGET a\nLPUSH l x y\nBADCMD\nLRANGE l 0 -1';
    expect(parseValkey(out, query)).toEqual({
      type: "rows",
      columns: ["Command", "Reply"],
      rows: [
        ['SET a "two words"', "OK"],
        ["GET a", "two words"],
        ["LPUSH l x y", "2"],
        ["BADCMD", "(error) ERR unknown command 'BADCMD', with args beginning with: "],
        ["LRANGE l 0 -1", '["y","x"]'],
      ],
    });
  });

  it("reads hashes and sorted sets as pairs", () => {
    expect(redisRows('{"a":"1","b":"2"}', true)).toEqual([["a", "1"], ["b", "2"]]);
    expect(redisRows('["m","1.5","n","2"]', true)).toEqual([["m", "1.5"], ["n", "2"]]);
    expect(redisRows('["x","y"]', false)).toEqual([["x"], ["y"]]);
  });
});

describe("parseQueryOutput", () => {
  it("explains a timeout", () => {
    expect(parseQueryOutput("postgres", "", "", 124, "select pg_sleep(60)").error).toMatch(/longer than 30 seconds/);
  });

  it("gives MySQL's error without its prefix", () => {
    const stderr = "ERROR 1064 (42000) at line 1: You have an error in your SQL syntax near 'selec x' at line 1\n";
    expect(parseQueryOutput("mysql", "", stderr, 1, "selec x").error).toBe("You have an error in your SQL syntax near 'selec x' at line 1");
  });
});

describe("loading files", () => {
  it("tells a mongodump archive and a Redis snapshot by their first bytes", () => {
    expect(sniff(Buffer.from([0x1f, 0x8b, 0x08, 0]))).toEqual({ archive: true, rdb: false });
    expect(sniff(Buffer.from("REDIS0011"))).toEqual({ archive: false, rdb: true });
    expect(sniff(Buffer.from("create table t(x int);"))).toEqual({ archive: false, rdb: false });
  });

  it("feeds the client exactly the file's length, so it ends without stdin being closed", () => {
    const { cmd } = loadCommand("postgres", "pw", 1303, false);
    expect(cmd.slice(0, 2)).toEqual(["sh", "-c"]);
    expect(cmd[2]).toMatch(/^head -c "\$1" \| psql .* -f -$/);
    expect(cmd[4]).toBe("1303");
    expect(loadCommand("mongo", "pw", 10, true).cmd[2]).toContain("mongorestore");
    expect(loadCommand("mongo", "pw", 10, false).cmd[2]).toContain("mongosh");
  });
});

describe("table browser", () => {
  it("quotes names for each database", () => {
    expect(previewQuery("postgres", { schema: "sales", name: 'odd"name' })).toBe('select * from "sales"."odd""name" limit 100');
    expect(previewQuery("mysql", { name: "odd`name" })).toBe("select * from `odd``name` limit 100");
    expect(previewQuery("mongo", { name: 'we"ird' })).toBe('db.getCollection("we\\"ird").find().limit(100)');
  });

  it("lists Postgres tables with their schema when it isn't public", () => {
    const rows = { type: "rows" as const, columns: ["table_schema", "table_name", "table_type"], rows: [["public", "notes", "BASE TABLE"], ["sales", "orders", "VIEW"]] };
    expect(tablesFrom("postgres", [rows])).toEqual([{ name: "notes" }, { name: "orders", schema: "sales", detail: "view" }]);
  });
});
