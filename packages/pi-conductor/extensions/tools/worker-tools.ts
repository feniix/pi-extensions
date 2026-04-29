import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "typebox";
import * as conductor from "../conductor.js";
export function registerWorkerTools(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "conductor_list_workers",
    label: "Conductor List Workers",
    description: "List durable pi-conductor workers for the current repository",
    parameters: Type.Object({
      includeArchived: Type.Optional(
        Type.Boolean({ description: "Include archived workers preserved for audit history" }),
      ),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const run = conductor.getOrCreateRunForRepo(ctx.cwd);
      const workers = params.includeArchived ? [...run.workers, ...run.archivedWorkers] : run.workers;
      const text =
        workers.length === 0
          ? "no conductor workers"
          : workers.map((worker) => `${worker.name} [${worker.workerId}] state=${worker.lifecycle}`).join("\n");
      return { content: [{ type: "text", text }], details: { workers } };
    },
  });

  pi.registerTool({
    name: "conductor_create_worker",
    label: "Conductor Create Worker",
    description: "Create a durable pi-conductor worker for the current repository",
    parameters: Type.Object({
      name: Type.String({ description: "Worker name" }),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const worker = await conductor.createWorkerForRepo(ctx.cwd, params.name);
      return {
        content: [
          { type: "text", text: `created worker ${worker.name} [${worker.workerId}] on branch ${worker.branch}` },
        ],
        details: { worker },
      };
    },
  });

  pi.registerTool({
    name: "conductor_recover_worker",
    label: "Conductor Recover Worker",
    description: "Recover a broken conductor worker with missing worktree or session linkage",
    parameters: Type.Object({
      name: Type.String({ description: "Worker name" }),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const worker = await conductor.recoverWorkerForRepo(ctx.cwd, params.name);
      return {
        content: [{ type: "text", text: `recovered worker ${worker.name}: session=${worker.sessionFile}` }],
        details: { workerId: worker.workerId, sessionFile: worker.sessionFile, worktreePath: worker.worktreePath },
      };
    },
  });

  pi.registerTool({
    name: "conductor_cleanup_worker",
    label: "Conductor Cleanup Worker",
    description:
      "Gate-protected cleanup for a named idle worker, its worktree, session link, and branch. First call may create a destructive_cleanup gate; approve it through /conductor human dashboard, then rerun conductor_cleanup_worker({ name }).",
    parameters: Type.Object({
      name: Type.String({ description: "Worker name" }),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const worker = conductor.removeWorkerForRepo(ctx.cwd, params.name);
      return {
        content: [{ type: "text", text: `removed worker ${worker.name} [${worker.workerId}]` }],
        details: { workerId: worker.workerId },
      };
    },
  });

  pi.registerTool({
    name: "conductor_commit_worker",
    label: "Conductor Commit Worker",
    description: "Commit all current changes in a worker worktree",
    parameters: Type.Object({
      name: Type.String({ description: "Worker name" }),
      message: Type.String({ description: "Commit message" }),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const worker = conductor.commitWorkerForRepo(ctx.cwd, params.name, params.message);
      return {
        content: [{ type: "text", text: `committed worker ${worker.name}: ${params.message}` }],
        details: { workerId: worker.workerId, commitSucceeded: worker.pr.commitSucceeded },
      };
    },
  });

  pi.registerTool({
    name: "conductor_push_worker",
    label: "Conductor Push Worker",
    description: "Push a worker branch to origin",
    parameters: Type.Object({
      name: Type.String({ description: "Worker name" }),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const worker = conductor.pushWorkerForRepo(ctx.cwd, params.name);
      return {
        content: [{ type: "text", text: `pushed worker ${worker.name} on branch ${worker.branch}` }],
        details: { workerId: worker.workerId, pushSucceeded: worker.pr.pushSucceeded },
      };
    },
  });

  pi.registerTool({
    name: "conductor_create_worker_pr",
    label: "Conductor Create Worker PR",
    description: "Gate-protected GitHub PR creation for a worker branch",
    parameters: Type.Object({
      name: Type.String({ description: "Worker name" }),
      title: Type.String({ description: "PR title" }),
      body: Type.Optional(Type.String({ description: "Optional PR body" })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const worker = conductor.createWorkerPrForRepo(ctx.cwd, params.name, params.title, params.body);
      return {
        content: [{ type: "text", text: `created PR for ${worker.name}: ${worker.pr.url}` }],
        details: { workerId: worker.workerId, pr: worker.pr },
      };
    },
  });
}
