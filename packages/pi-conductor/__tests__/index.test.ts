import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import conductorExtension from "../extensions/index.js";

function collectToolNames(): string[] {
  const names: string[] = [];
  const fakePi = {
    registerCommand: () => undefined,
    registerTool: (tool: { name: string }) => names.push(tool.name),
  };
  conductorExtension(fakePi as never);
  return names;
}

describe("pi-conductor extension", () => {
  afterEach(() => {
    delete process.env.PI_CONDUCTOR_ENABLE_LEGACY_WORKER_TOOLS;
  });
  it("registers the main conductor command group", () => {
    const extension = readFileSync(join(__dirname, "../extensions/index.ts"), "utf-8");
    expect(extension).toContain('registerCommand("conductor"');
  });

  it("registers resource-oriented conductor tools", () => {
    const extension = readFileSync(join(__dirname, "../extensions/index.ts"), "utf-8");
    expect(extension).toContain('name: "conductor_get_project"');
    expect(extension).toContain('name: "conductor_list_objectives"');
    expect(extension).toContain('name: "conductor_get_objective"');
    expect(extension).toContain('name: "conductor_create_objective"');
    expect(extension).toContain('name: "conductor_update_objective"');
    expect(extension).toContain('name: "conductor_refresh_objective_status"');
    expect(extension).toContain('name: "conductor_plan_objective"');
    expect(extension).toContain('name: "conductor_link_task_to_objective"');
    expect(extension).toContain('name: "conductor_list_workers"');
    expect(extension).toContain('name: "conductor_list_tasks"');
    expect(extension).toContain('name: "conductor_get_task"');
    expect(extension).toContain('name: "conductor_list_runs"');
    expect(extension).toContain('name: "conductor_list_gates"');
    expect(extension).toContain('name: "conductor_create_worker"');
    expect(extension).toContain('name: "conductor_create_task"');
    expect(extension).toContain('name: "conductor_update_task"');
    expect(extension).toContain('name: "conductor_assign_task"');
    expect(extension).toContain('name: "conductor_delegate_task"');
    expect(extension).not.toContain('name: "conductor_child_progress"');
    expect(extension).not.toContain('name: "conductor_child_complete"');
    expect(extension).not.toContain('name: "conductor_child_create_gate"');
    expect(extension).toContain('name: "conductor_create_gate"');
    expect(extension).toContain('name: "conductor_resolve_gate"');
    expect(extension).not.toContain('name: "conductor_resolve_gate_as_human"');
    expect(extension).toContain('name: "conductor_start_task_run"');
    expect(extension).toContain('name: "conductor_run_task"');
    expect(extension).toContain('name: "conductor_cancel_task_run"');
    expect(extension).toContain('name: "conductor_retry_task"');
    expect(extension).toContain('name: "conductor_list_events"');
    expect(extension).toContain('name: "conductor_list_artifacts"');
    expect(extension).toContain('name: "conductor_backend_status"');
    expect(extension).toContain('name: "conductor_reconcile_project"');
    expect(extension).toContain('name: "conductor_next_actions"');
    expect(extension).toContain('name: "conductor_project_brief"');
    expect(extension).toContain('name: "conductor_task_brief"');
    expect(extension).toContain('name: "conductor_resource_timeline"');
    expect(extension).toContain('name: "conductor_run_next_action"');
    expect(extension).toContain('name: "conductor_scheduler_tick"');
    expect(extension).toContain('name: "conductor_schedule_objective"');
    expect(extension).toContain('name: "conductor_assess_task"');
    expect(extension).toContain('name: "conductor_read_artifact"');
    expect(extension).toContain('name: "conductor_objective_dag"');
    expect(extension).toContain('name: "conductor_prepare_human_review"');
    expect(extension).toContain('name: "conductor_diagnose_blockers"');
    expect(extension).toContain('name: "conductor_build_evidence_bundle"');
    expect(extension).toContain('name: "conductor_check_readiness"');
    expect(extension).toContain('name: "conductor_recover_worker"');
    expect(extension).toContain('name: "conductor_cleanup_worker"');
    expect(extension).toContain('name: "conductor_commit_worker"');
    expect(extension).toContain('name: "conductor_push_worker"');
    expect(extension).toContain('name: "conductor_create_worker_pr"');
  });

  it("hides legacy worker tools unless compatibility is enabled", () => {
    const names = collectToolNames();
    expect(names).toContain("conductor_get_project");
    expect(names).not.toContain("conductor_start");
    expect(names).not.toContain("conductor_run");
    expect(names).not.toContain("conductor_pr_create");
  });

  it("registers legacy worker tools when compatibility is enabled", () => {
    process.env.PI_CONDUCTOR_ENABLE_LEGACY_WORKER_TOOLS = "1";
    const names = collectToolNames();
    expect(names).toContain("conductor_start");
    expect(names).toContain("conductor_run");
    expect(names).toContain("conductor_pr_create");
  });
});
