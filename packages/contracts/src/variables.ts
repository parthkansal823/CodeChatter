/**
 * A room's variables for its automations, as n8n's $vars: names and text kept with the room (a base address, an environment's name, a channel), read
 * in a flow as {{variables.NAME}}, Activepieces' own expression. Not secrets (those are connections): anyone who can run the room's code sees them, and
 * its owners change them. The API gives them to each run, as it does connections.
 */
import { z } from "zod";

/** A name a flow can read as {{variables.NAME}}: letters, digits and _, not starting with a digit. */
export const VARIABLE_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
export const MOST_VARIABLES = 100;
export const MOST_VARIABLE_CHARACTERS = 4000;

export const VariableName = z.string().regex(VARIABLE_NAME, "A name is letters, numbers and _, not starting with a number, up to 64.");

/** A variable's value, set by name (PUT .../variables/:name). */
export const AutomationVariableInput = z.object({
  value: z.string().max(MOST_VARIABLE_CHARACTERS, `A value is up to ${MOST_VARIABLE_CHARACTERS.toLocaleString("en")} characters.`),
});
export type AutomationVariableInput = z.infer<typeof AutomationVariableInput>;

/** A variable as the tool shows it: its value, and who set it when. */
export type AutomationVariable = { name: string; value: string; by: string | null; at: number | null };

/** What a run is given: names to values. The API sets it from the room; a browser never does. */
export const RunVariables = z.record(VariableName, z.string().max(MOST_VARIABLE_CHARACTERS)).optional();

/** How a flow reads one. */
export const variableExpression = (name: string) => `{{variables.${name}}}`;
