import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("pi-conductor extension", () => {
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
    expect(extension).toContain('name: "conductor_build_evidence_bundle"');
    expect(extension).toContain('name: "conductor_check_readiness"');
    expect(extension).toContain('name: "conductor_cleanup_worker"');
    expect(extension).toContain('name: "conductor_commit_worker"');
    expect(extension).toContain('name: "conductor_push_worker"');
    expect(extension).toContain('name: "conductor_create_worker_pr"');
  });

  it("still registers legacy worker tools during the transition", () => {
    const extension = readFileSync(join(__dirname, "../extensions/index.ts"), "utf-8");
    expect(extension).toContain('name: "conductor_status"');
    expect(extension).toContain('name: "conductor_start"');
    expect(extension).toContain('name: "conductor_task_update"');
    expect(extension).toContain('name: "conductor_recover"');
    expect(extension).toContain('name: "conductor_summary_refresh"');
    expect(extension).toContain('name: "conductor_cleanup"');
    expect(extension).toContain('name: "conductor_resume"');
    expect(extension).toContain('name: "conductor_lifecycle_update"');
    expect(extension).toContain('name: "conductor_commit"');
    expect(extension).toContain('name: "conductor_push"');
    expect(extension).toContain('name: "conductor_pr_create"');
    expect(extension).toContain('name: "conductor_run"');
  });
});
