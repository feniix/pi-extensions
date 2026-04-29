import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import conductorExtension from "../extensions/index.js";

function collectRegistration(): { commands: string[]; tools: string[] } {
  const commands: string[] = [];
  const tools: string[] = [];
  const fakePi = {
    registerCommand: (name: string) => commands.push(name),
    registerTool: (tool: { name: string }) => tools.push(tool.name),
  };
  conductorExtension(fakePi as never);
  return { commands, tools };
}

describe("pi-conductor extension", () => {
  it("registers the main conductor command group", () => {
    expect(collectRegistration().commands).toEqual(["conductor"]);
  });

  it("registers resource-oriented conductor tools", () => {
    const expectedTools = [
      "conductor_get_project",
      "conductor_list_objectives",
      "conductor_get_objective",
      "conductor_create_objective",
      "conductor_update_objective",
      "conductor_refresh_objective_status",
      "conductor_plan_objective",
      "conductor_link_task_to_objective",
      "conductor_reconcile_project",
      "conductor_run_next_action",
      "conductor_run_work",
      "conductor_run_parallel_work",
      "conductor_view_active_workers",
      "conductor_cancel_active_work",
      "conductor_schedule_objective",
      "conductor_scheduler_tick",
      "conductor_assess_task",
      "conductor_read_artifact",
      "conductor_objective_dag",
      "conductor_prepare_human_review",
      "conductor_diagnose_blockers",
      "conductor_resource_timeline",
      "conductor_task_brief",
      "conductor_project_brief",
      "conductor_next_actions",
      "conductor_build_evidence_bundle",
      "conductor_check_readiness",
      "conductor_backend_status",
      "conductor_list_events",
      "conductor_list_artifacts",
      "conductor_list_workers",
      "conductor_list_tasks",
      "conductor_get_task",
      "conductor_list_runs",
      "conductor_list_gates",
      "conductor_create_worker",
      "conductor_create_task",
      "conductor_update_task",
      "conductor_assign_task",
      "conductor_delegate_task",
      "conductor_create_gate",
      "conductor_resolve_gate",
      "conductor_start_task_run",
      "conductor_run_task",
      "conductor_cancel_task_run",
      "conductor_retry_task",
      "conductor_recover_worker",
      "conductor_cleanup_worker",
      "conductor_commit_worker",
      "conductor_push_worker",
      "conductor_create_worker_pr",
    ];
    expect([...collectRegistration().tools].sort()).toEqual([...expectedTools].sort());
  });

  it("packages conductor workflow skills", () => {
    const packageJson = JSON.parse(readFileSync(join(__dirname, "../package.json"), "utf-8"));
    const gateReviewSkill = readFileSync(join(__dirname, "../skills/conductor-gate-review/SKILL.md"), "utf-8");
    const orchestrationSkill = readFileSync(join(__dirname, "../skills/conductor-orchestration/SKILL.md"), "utf-8");

    expect(packageJson.files).toContain("skills/");
    expect(packageJson.pi.skills).toEqual(["./skills"]);
    expect(gateReviewSkill).toContain("/conductor human dashboard");
    expect(orchestrationSkill).toContain('policy: "execute"');
  });
});
