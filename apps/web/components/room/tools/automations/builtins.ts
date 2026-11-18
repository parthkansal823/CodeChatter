/**
 * The forms for CodeChatter's built-in steps, as n8n has for working on data (Edit Fields, Filter, Sort and the rest): what each needs, in the shape pieces'
 * fields have, so the step panel draws them the same way. What they do is sandbox/image/automation/builtins.mjs, in the room's sandbox; this side only describes
 * them. A built-in step is a code step marked `builtin`, so the engine works out its inputs' expressions as for any code step.
 */
import type { PieceField } from "@codechatter/contracts";

/** "room": CodeChatter's own steps, with the room (its sandbox, its AI, its chat), listed under This room; the rest work on data. */
export type Builtin = { label: string; description: string; fields: Record<string, PieceField>; defaults: Record<string, unknown>; group?: "room" };

const text = (label: string, description = "", required = false): PieceField => ({ type: "SHORT_TEXT", label, description, required });
const json = (label: string, description = "", required = false): PieceField => ({ type: "JSON", label, description, required });
const long = (label: string, description = "", required = false): PieceField => ({ type: "LONG_TEXT", label, description, required });
const number = (label: string, description = "", required = false): PieceField => ({ type: "NUMBER", label, description, required });
const check = (label: string, description = ""): PieceField => ({ type: "CHECKBOX", label, description, required: false });
const choice = (label: string, options: Array<[string, string]>, description = ""): PieceField => ({ type: "STATIC_DROPDOWN", label, description, required: true, options: options.map(([value, words]) => ({ label: words, value })) });

const items = json("Items", "The list to work on, from a step before: click into this, then Use on its data, such as {{step_1.output}}.", true);
const first = json("First list", "From a step before, such as {{step_1.output}}.", true);
const second = json("Second list", "From another step, such as {{step_2.output}}.", true);

/** The tests Filter can do, by the names builtins.mjs uses. */
export const FILTER_TESTS: Array<[string, string]> = [
  ["equals", "is"],
  ["not_equals", "isn't"],
  ["contains", "contains"],
  ["not_contains", "doesn't contain"],
  ["starts_with", "starts with"],
  ["ends_with", "ends with"],
  ["greater", "is more than"],
  ["less", "is less than"],
  ["at_least", "is at least"],
  ["at_most", "is at most"],
  ["before", "is before the date"],
  ["after", "is after the date"],
  ["matches", "matches the pattern"],
  ["exists", "has a value"],
  ["not_exists", "has no value"],
  ["empty", "is empty"],
  ["not_empty", "isn't empty"],
  ["is_true", "is true"],
  ["is_false", "is false"],
];

export const BUILTINS: Record<string, Builtin> = {
  edit_fields: {
    label: "Edit Fields",
    description: "Set fields on each item, keep only some, or take some away",
    fields: {
      items: { ...items, required: false, description: "The list to change. Leave it empty to make one item from the fields." },
      mode: choice("Do", [["set", "Set these fields"], ["keep", "Keep only these fields"], ["remove", "Take these fields away"]]),
      fields: json("Fields", 'To set: names and values as JSON, such as {"status": "done", "who": "$item.user.login"}, where $item reads from each item. To keep or take away: their names, with commas.', true),
    },
    defaults: { items: "", mode: "set", fields: {} },
  },
  filter: {
    label: "Filter",
    description: "Keep the items whose field passes a test",
    fields: {
      items,
      field: text("Field", "In each item, such as status or user.login. Leave it empty to test the item itself."),
      test: choice("Test", FILTER_TESTS),
      value: text("Compared with", "Not needed for tests like has a value or is empty."),
      keep: choice("Keep", [["passing", "The items that pass"], ["failing", "The items that don't"]]),
    },
    defaults: { items: "", field: "", test: "equals", value: "", keep: "passing" },
  },
  sort: {
    label: "Sort",
    description: "Put the items in order by a field",
    fields: {
      items,
      field: text("Field", "In each item, such as ms or created_at.", true),
      direction: choice("Order", [["ascending", "Smallest or earliest first"], ["descending", "Largest or latest first"]]),
      compare_as: choice("Compare as", [["text", "Text"], ["number", "Numbers"], ["date", "Dates"]]),
    },
    defaults: { items: "", field: "", direction: "ascending", compare_as: "text" },
  },
  limit: {
    label: "Limit",
    description: "Keep the first few items, or the last few",
    fields: { items, max: number("How many", "", true), from: choice("From", [["start", "The start"], ["end", "The end"]]) },
    defaults: { items: "", max: "10", from: "start" },
  },
  aggregate: {
    label: "Aggregate",
    description: "Gather a field from every item into one list",
    fields: {
      items,
      fields: text("Fields", "Names, with commas, each gathered into a list. Leave it empty to gather whole items."),
      skip_empty: check("Leave out empty values"),
    },
    defaults: { items: "", fields: "", skip_empty: true },
  },
  summarize: {
    label: "Summarize",
    description: "Count, sum, average and more, overall or for each group",
    fields: {
      items,
      operation: choice("Work out", [["count", "How many"], ["sum", "The sum"], ["average", "The average"], ["min", "The smallest"], ["max", "The largest"], ["count_unique", "How many different values"], ["join", "The values, joined"]]),
      field: text("Field", "What to add up, average and so on. Not needed to count items."),
      group_by: text("Group by", "Fields, with commas, for a result for each group. Leave it empty for one result."),
      separator: text("Joined with", "For joining values."),
    },
    defaults: { items: "", operation: "count", field: "", group_by: "", separator: ", " },
  },
  remove_duplicates: {
    label: "Remove Duplicates",
    description: "Keep each item once",
    fields: {
      items,
      fields: text("The same when these match", "Fields, with commas. Leave it empty to compare whole items."),
      keep: choice("Keep", [["first", "The first"], ["last", "The last"]]),
    },
    defaults: { items: "", fields: "", keep: "first" },
  },
  split_out: {
    label: "Split Out",
    description: "Make each entry of a list inside an item an item of its own",
    fields: { items, field: text("Field with the list", "Such as files or labels.", true), keep_other_fields: check("Keep the item's other fields") },
    defaults: { items: "", field: "", keep_other_fields: false },
  },
  rename_keys: {
    label: "Rename Keys",
    description: "Give fields new names",
    fields: { items, renames: json("Renames", 'Old names and new, as JSON, such as {"login": "user"}.', true) },
    defaults: { items: "", renames: {} },
  },
  merge: {
    label: "Merge",
    description: "Put two lists together",
    fields: {
      first,
      second,
      mode: choice("How", [["append", "One after the other"], ["match", "Matched by a field"], ["position", "Side by side, by position"], ["every_pair", "Every pairing"]]),
      first_key: text("Field in the first", "To match by."),
      second_key: text("Field in the second", "If it's called something else there."),
      keep: choice("Keep", [["both", "Only the matches"], ["all_first", "Everything from the first"], ["all", "Everything from both"], ["unmatched", "Only the first's without a match"]]),
    },
    defaults: { first: "", second: "", mode: "append", first_key: "", second_key: "", keep: "both" },
  },
  compare_datasets: {
    label: "Compare Datasets",
    description: "What's only in one list, the same in both, and different",
    fields: { first, second, first_key: text("Field in the first", "To match by.", true), second_key: text("Field in the second", "If it's called something else there.") },
    defaults: { first: "", second: "", first_key: "", second_key: "" },
  },
  call_flow: {
    label: "Call a flow",
    description: "Run another flow in the room with what you send, and get what its last step gave, as n8n's Execute Workflow",
    fields: {
      flow: text("Flow", "One whose trigger is Called by another flow.", true),
      data: json("What to send", "It's the called flow's trigger output."),
      wait: check("Wait for it to finish", "Off: it's started after this run, and this step gives its run's id."),
    },
    defaults: { flow: "", data: {}, wait: true },
  },
  approval_links: {
    label: "Approval links",
    description: "A link for each choice, to send to whoever decides, before Respond and Wait for Next Webhook waits for one to be clicked",
    fields: { choices: text("Choices", "Comma-separated: each gets a link, as this step's output (approve, reject…). The wait after it gives the one clicked as queryParams.action.", true) },
    defaults: { choices: "approve, reject" },
  },
  run_command: {
    group: "room",
    label: "Run a command",
    description: "In the room's sandbox, in its files: tests, a build, a script, git. Its exit code and what it printed",
    fields: {
      command: long("Command", "Run with bash in the room's files, such as npm test or python3 deploy.py {{trigger.output.data.args}}.", true),
      folder: text("In the folder", "A folder in the room, such as tests. Empty is the room's top folder."),
      seconds: number("Up to how many seconds", "It's stopped after this: 60 if empty, 600 at most."),
      fail_on_error: check("Fail the step when the command fails", "Off: the step gives exitCode, for a router to look at."),
    },
    defaults: { command: "", folder: "", seconds: 60, fail_on_error: true },
  },
  ask_ai: {
    group: "room",
    label: "Ask the room's AI",
    description: "The model the room uses, with no key in the room: its answer as text, or as JSON",
    fields: {
      prompt: long("Ask", "What to ask, with what steps before found: Why did this fail? {{run_tests.output.stderr}}", true),
      instructions: long("Instructions", "How to answer, such as: Answer in two sentences, for a developer."),
      json: check("Answer as JSON", "The answer is read as JSON, as this step's json, for the next steps."),
      model: text("Model", "Empty is the room's own."),
    },
    defaults: { prompt: "", instructions: "", json: false, model: "" },
  },
  post_to_chat: {
    group: "room",
    label: "Post to the room's chat",
    description: "A message everyone in the room sees, from Automations",
    fields: { text: long("Message", "Up to 4,000 characters, such as: Deployed {{trigger.output.data.args}}.", true) },
    defaults: { text: "" },
  },
  stop_and_error: {
    label: "Stop and Error",
    description: "Stop the run here, saying why",
    fields: { message: text("Message", "What the run says when it stops.", true) },
    defaults: { message: "Stopped on purpose." },
  },
};

export const builtinOf = (step: { builtin?: unknown }) => (typeof step.builtin === "string" ? (BUILTINS[step.builtin] ?? null) : null);
