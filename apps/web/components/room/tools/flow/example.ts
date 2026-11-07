/** The Flow tool's example: a real dbt project, from messy orders to totals by state, with SQL recipes, a Python recipe and checks. One check warns on purpose, to show what that looks like. */
import { createFileAtPath, findByPath } from "@codechatter/workspace-model";
import type * as Y from "yjs";

export const EXAMPLE_FOLDER = "orders-flow";

const FILES: Record<string, string> = {
  "README.md": `# Orders flow

A small data project, in the shape dbt expects, so it runs anywhere dbt does.

- \`seeds/\` is data that came as files.
- \`models/\` is recipes: each SQL or Python file makes one dataset.
- \`models/schema.yml\` and \`tests/\` are checks on the data.

Open the **Flow** tool to see how it all connects, and press **Build all**. Or, in a terminal in this folder, run \`dbt build\`.

One order has no amount, and a check warns about it on purpose: select \`clean_orders\` in the Flow tool, and look at its checks.
`,
  "dbt_project.yml": `name: orders_flow
version: "1.0"
profile: codechatter

models:
  orders_flow:
    +materialized: table
`,
  "seeds/raw_orders.csv": `order_id,city,amount
1,Pune,120.50
2,Delhi,80
2,Delhi,80
3,pune,
4,Agra,12
5,Delhi,300
6,Pune,45
7,Mumbai,210
8,mumbai,95.25
9,Agra,60
`,
  "seeds/cities.csv": `city,state
Pune,Maharashtra
Mumbai,Maharashtra
Delhi,Delhi
Agra,Uttar Pradesh
`,
  "models/clean_orders.sql": `-- Takes out repeated rows, and tidies the city's name.
select distinct
  order_id,
  upper(city[1]) || lower(city[2:]) as city,
  amount
from {{ ref('raw_orders') }}
`,
  "models/orders_by_state.sql": `-- Each order's city tells us its state.
select
  c.state,
  count(*) as orders,
  sum(o.amount) as total
from {{ ref('clean_orders') }} as o
join {{ ref('cities') }} as c on o.city = c.city
group by c.state
`,
  "models/state_share.py": `def model(dbt, session):
    # A Python recipe: whatever this returns becomes the dataset.
    frame = dbt.ref("orders_by_state").df()
    frame["share"] = (frame["total"] / frame["total"].sum()).round(3)
    return frame.sort_values("total", ascending=False)
`,
  "models/schema.yml": `version: 2

models:
  - name: clean_orders
    description: One row for each order, with the city's name tidied.
    columns:
      - name: order_id
        data_tests:
          - unique
          - not_null
      - name: amount
        data_tests:
          # A warning, not a failure: what's made from this still gets built.
          - not_null:
              config:
                severity: warn
  - name: orders_by_state
    description: Orders and their total for each state.
    columns:
      - name: state
        data_tests:
          - unique
`,
  "tests/clean_orders__amount__range.sql": `-- The rows where amount is out of its range.
select *
from {{ ref('clean_orders') }}
where "amount" < 0
`,
};

/** Adds the project, unless the room has one by this name already. */
export function createExampleProject(doc: Y.Doc, by: string): void {
  if (findByPath(doc, `${EXAMPLE_FOLDER}/dbt_project.yml`)) return;
  doc.transact(() => {
    for (const [path, content] of Object.entries(FILES)) createFileAtPath(doc, `${EXAMPLE_FOLDER}/${path}`, content, by);
  });
}
