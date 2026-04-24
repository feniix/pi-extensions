import { describe, expect, it } from "vitest";
import { computeNextActions } from "../extensions/conductor.js";
import {
  addObjective,
  addTask,
  createEmptyRun,
  createObjectiveRecord,
  createTaskRecord,
} from "../extensions/storage.js";

describe("LLM-focused conductor orchestration helpers", () => {
  it("filters next actions by objective", () => {
    let run = createEmptyRun("abc", "/repo");
    const first = createObjectiveRecord({ objectiveId: "objective-1", title: "First", prompt: "Ship first" });
    const second = createObjectiveRecord({ objectiveId: "objective-2", title: "Second", prompt: "Ship second" });
    run = addObjective(addObjective(run, first), second);
    run = addTask(
      run,
      createTaskRecord({ taskId: "task-1", title: "Ready", prompt: "Do it", objectiveId: first.objectiveId }),
    );

    const result = computeNextActions(run, { objectiveId: second.objectiveId });

    expect(result.actions).toHaveLength(1);
    expect(result.actions[0]).toMatchObject({
      kind: "plan_objective",
      resourceRefs: { objectiveId: second.objectiveId },
    });
  });
});
