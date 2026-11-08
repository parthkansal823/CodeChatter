/**
 * A router's branches: each has groups of tests, where every test in a group must hold (and) and any group will do (or), as the engine reads them. Branches can
 * be added and removed, and the router can run the first branch that matches or every one that does.
 */
"use client";

import { Plus, Trash2, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import { CONDITIONS, newCondition, type Branch, type Condition, type FlowStep } from "./model";

const field = "h-7 min-w-0 rounded-md border bg-background px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring";
const conditionOf = (operator: string) => CONDITIONS.find((condition) => condition.value === operator);

export function RouterFields({
  step,
  canEdit,
  onStep,
  onAddBranch,
  onRemoveBranch,
  onFieldFocus,
}: {
  step: FlowStep;
  canEdit: boolean;
  onStep: (change: (step: FlowStep) => void) => void;
  onAddBranch: () => void;
  onRemoveBranch: (index: number) => void;
  /** Where "Use" on some data puts its expression. */
  onFieldFocus: (element: HTMLInputElement, write: (text: string) => void) => void;
}) {
  const branches = (step.settings.branches ?? []) as Branch[];
  const tests = branches.filter((branch) => branch.branchType === "CONDITION").length;
  const branchesOf = (current: FlowStep) => current.settings.branches as Branch[];
  const groupsAt = (current: FlowStep, index: number) => (branchesOf(current)[index]!.conditions ??= [[newCondition()]]);
  const setCondition = (index: number, group: number, at: number, change: Partial<Condition>) => onStep((current) => void Object.assign(groupsAt(current, index)[group]![at]!, change));

  return (
    <section aria-label="Branches" className="grid gap-2">
      <div className="flex items-center gap-2">
        <h4 className="flex-1 font-medium">Branches</h4>
        <label className="flex items-center gap-1">
          <span className="sr-only">Which branches run</span>
          <select className={field} disabled={!canEdit} value={String(step.settings.executionType ?? "EXECUTE_FIRST_MATCH")} onChange={(event) => onStep((current) => void (current.settings.executionType = event.target.value))}>
            <option value="EXECUTE_FIRST_MATCH">The first that matches</option>
            <option value="EXECUTE_ALL_MATCH">Each that matches</option>
          </select>
        </label>
      </div>
      <p className="text-muted-foreground">{step.settings.executionType === "EXECUTE_ALL_MATCH" ? "Every branch whose tests hold runs, in order, then what comes after the router." : "The first branch whose tests hold runs, then what comes after the router."}</p>
      {branches.map((branch, index) => (
        <div key={index} role="group" aria-label={`Branch ${branch.branchName}`} className="grid gap-1.5 rounded-md border p-2">
          <div className="flex items-center gap-1">
            <Input aria-label={`Name of branch ${index + 1}`} className="h-7 flex-1 text-xs" readOnly={!canEdit} value={branch.branchName} onChange={(event) => onStep((current) => void (branchesOf(current)[index]!.branchName = event.target.value))} />
            {canEdit && branch.branchType === "CONDITION" && tests > 1 && (
              <Button size="icon-xs" variant="ghost" aria-label={`Remove the ${branch.branchName} branch and its steps`} title="Remove this branch and its steps" onClick={() => onRemoveBranch(index)}>
                <Trash2 />
              </Button>
            )}
          </div>
          {branch.branchType === "FALLBACK" ? (
            <p className="text-muted-foreground">When no branch above matches.</p>
          ) : (
            <>
              {(branch.conditions ?? []).map((group, groupIndex) => (
                <div key={groupIndex} className="grid gap-1">
                  {groupIndex > 0 && <p className="text-[11px] font-medium text-muted-foreground">Or</p>}
                  {group.map((condition, at) => {
                    const known = conditionOf(condition.operator);
                    const label = `branch ${index + 1}, test ${groupIndex + 1}.${at + 1}`;
                    return (
                      <div key={at} className="grid gap-1 rounded-md bg-chrome p-1.5">
                        {at > 0 && <p className="text-[11px] font-medium text-muted-foreground">And</p>}
                        <Input
                          aria-label={`Value to test, ${label}`}
                          className="h-7 font-mono text-xs"
                          placeholder="{{step_1.output.x}}"
                          readOnly={!canEdit}
                          value={condition.firstValue}
                          onFocus={(event) => onFieldFocus(event.currentTarget, (text) => setCondition(index, groupIndex, at, { firstValue: text }))}
                          onChange={(event) => setCondition(index, groupIndex, at, { firstValue: event.target.value })}
                        />
                        <div className="flex items-center gap-1">
                          <select aria-label={`Test, ${label}`} className={`${field} flex-1`} disabled={!canEdit} value={condition.operator} onChange={(event) => setCondition(index, groupIndex, at, { operator: event.target.value })}>
                            {!known && <option value={condition.operator}>{condition.operator} (the engine doesn't know this test)</option>}
                            {CONDITIONS.map((option) => (
                              <option key={option.value} value={option.value}>
                                {option.words}
                              </option>
                            ))}
                          </select>
                          {canEdit && (group.length > 1 || (branch.conditions ?? []).length > 1) && (
                            <Button
                              size="icon-xs"
                              variant="ghost"
                              aria-label={`Remove ${label}`}
                              title="Remove this test"
                              onClick={() =>
                                onStep((current) => {
                                  const groups = groupsAt(current, index);
                                  groups[groupIndex]!.splice(at, 1);
                                  if (!groups[groupIndex]!.length) groups.splice(groupIndex, 1);
                                })
                              }
                            >
                              <X />
                            </Button>
                          )}
                        </div>
                        {known?.needsValue !== false && (
                          <Input
                            aria-label={`Compared with, ${label}`}
                            className="h-7 font-mono text-xs"
                            readOnly={!canEdit}
                            value={condition.secondValue ?? ""}
                            onFocus={(event) => onFieldFocus(event.currentTarget, (text) => setCondition(index, groupIndex, at, { secondValue: text }))}
                            onChange={(event) => setCondition(index, groupIndex, at, { secondValue: event.target.value })}
                          />
                        )}
                        {known?.text && (
                          <label className="flex items-center gap-1.5">
                            <input type="checkbox" disabled={!canEdit} checked={condition.caseSensitive === true} onChange={(event) => setCondition(index, groupIndex, at, { caseSensitive: event.target.checked })} />
                            Capitals matter
                          </label>
                        )}
                      </div>
                    );
                  })}
                  {canEdit && (
                    <div>
                      <Button size="xs" variant="ghost" onClick={() => onStep((current) => void groupsAt(current, index)[groupIndex]!.push(newCondition()))}>
                        <Plus /> And
                      </Button>
                    </div>
                  )}
                </div>
              ))}
              {canEdit && (
                <div>
                  <Button size="xs" variant="ghost" onClick={() => onStep((current) => void groupsAt(current, index).push([newCondition()]))}>
                    <Plus /> Or
                  </Button>
                </div>
              )}
            </>
          )}
        </div>
      ))}
      {canEdit && (
        <div>
          <Button size="xs" variant="outline" onClick={onAddBranch}>
            <Plus /> Add a branch
          </Button>
        </div>
      )}
    </section>
  );
}
