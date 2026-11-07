/**
 * Evals: a prompt's test cases, each with checks on the answer, run by promptfoo in the room's sandbox against the Playground's
 * columns, through the AI gateway. This is what's sent, the config promptfoo gets, and what comes back.
 */
import { z } from "zod";

import { PROMPT_LIMITS } from "./prompts.js";

export const EVAL_CHECK_TYPES = ["contains", "icontains", "not-contains", "equals", "regex", "is-json", "contains-json", "javascript", "llm-rubric", "latency"] as const;
export type EvalCheckType = (typeof EVAL_CHECK_TYPES)[number];

/** These look at the answer's form, and need nothing to compare it with. */
export const checkNeedsValue = (type: EvalCheckType) => type !== "is-json" && type !== "contains-json";

export const EVAL_LIMITS = { cases: 30, checks: 10, columns: 4, valueChars: 20_000, checkChars: 4_000, nameChars: 120, idChars: 64, outputChars: 800, reasonChars: 400, bodyBytes: 8 * 1024 * 1024 } as const;

const EvalCheck = z
  .object({ type: z.enum(EVAL_CHECK_TYPES), value: z.string().max(EVAL_LIMITS.checkChars, "A check is too long.").default("") })
  .superRefine((check, context) => {
    if (checkNeedsValue(check.type) && !check.value.trim()) context.addIssue({ code: "custom", message: "A check is missing what to look for." });
    if (check.type === "latency" && !/^\d+$/.test(check.value.trim())) context.addIssue({ code: "custom", message: "A time limit has to be a whole number of milliseconds." });
  });

const Id = z.string().min(1).max(EVAL_LIMITS.idChars).regex(/^[\w-]+$/);

export const EvalInput = z.object({
  system: z.string().max(PROMPT_LIMITS.systemChars).default(""),
  messages: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(PROMPT_LIMITS.messageChars) }))
    .min(1)
    .max(PROMPT_LIMITS.messages)
    .refine((list) => list.at(-1)?.role === "user" && list.at(-1)!.content.trim().length > 0, "The last message has to be the user's, with something in it."),
  columns: z
    .array(z.object({ id: Id, model: z.string().trim().min(1).max(PROMPT_LIMITS.modelChars), temperature: z.number().min(0).max(2).nullable(), maxTokens: z.number().int().min(1).max(PROMPT_LIMITS.maxTokens).nullable(), json: z.boolean() }))
    .min(1)
    .max(EVAL_LIMITS.columns),
  cases: z
    .array(
      z.object({
        id: Id,
        name: z.string().max(EVAL_LIMITS.nameChars),
        values: z.record(z.string().regex(/^[A-Za-z_][\w.-]*$/), z.string().max(EVAL_LIMITS.valueChars)),
        checks: z.array(EvalCheck).max(EVAL_LIMITS.checks),
      }),
    )
    .min(1, "Add a test case first.")
    .max(EVAL_LIMITS.cases),
  /** Models here share one machine: one call at a time. */
  oneAtATime: z.boolean().default(false),
  /** The model that judges `llm-rubric` checks. */
  grader: z.string().trim().min(1).max(PROMPT_LIMITS.modelChars).nullable().default(null),
});
export type EvalInput = z.infer<typeof EvalInput>;

const assertion = (check: EvalInput["cases"][number]["checks"][number]) => {
  if (check.type === "latency") return { type: "latency", threshold: Number(check.value) };
  return checkNeedsValue(check.type) ? { type: check.type, value: check.value } : { type: check.type };
};

/** A promptfoo config, the same whether it's run here or copied out to run anywhere. Each column's label is its id, to tell the results apart. */
export function promptfooConfig(input: EvalInput) {
  const turns = [...(input.system ? [{ role: "system", content: input.system }] : []), ...input.messages];
  return {
    description: "From CodeChatter's Prompts tool",
    prompts: [{ label: "prompt", raw: JSON.stringify(turns) }],
    providers: input.columns.map((column) => ({
      id: `openai:chat:${column.model}`,
      label: column.id,
      config: {
        ...(column.temperature !== null && { temperature: column.temperature }),
        ...(column.maxTokens !== null && { max_tokens: column.maxTokens }),
        ...(column.json && { response_format: { type: "json_object" } }),
      },
    })),
    ...(input.grader && { defaultTest: { options: { provider: `openai:chat:${input.grader}` } } }),
    tests: input.cases.map((test) => ({ description: test.name, vars: test.values, assert: test.checks.map(assertion) })),
    evaluateOptions: { maxConcurrency: input.oneAtATime ? 1 : 4 },
  };
}

/** One test case on one column. */
export type EvalCell = {
  caseId: string;
  columnId: string;
  pass: boolean;
  /** The call itself failed, rather than a check on its answer. */
  error: string | null;
  output: string;
  failed: Array<{ type: string; value: string; reason: string }>;
  latencyMs: number | null;
  inputTokens: number;
  outputTokens: number;
};

export type EvalReport = { cells: EvalCell[]; passed: number; failed: number; errors: number; inputTokens: number; outputTokens: number; ms: number };

/** POST /api/rooms/:roomId/evals answers with these, one JSON object per line. `calls` is how many have gone through the gateway so far. */
export type EvalEvent = { type: "progress"; calls: number } | { type: "done"; report: EvalReport } | { type: "error"; message: string };
