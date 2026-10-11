import * as fs from "node:fs/promises";
import { mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createResearchCycles, researchProjectId } from "../extensions/research-cycles.js";

vi.mock("node:fs/promises", async (importOriginal) => {
  const original = await importOriginal<typeof fs>();
  return { ...original, rename: vi.fn(original.rename) };
});

const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("durable research cycles", () => {
  it("serializes racing step writes and explicitly rejects a duplicate sequence", async () => {
    const root = await mkdtemp(join(tmpdir(), "exa-cycles-"));
    roots.push(root);
    const controller = await createResearchCycles({ root: join(root, "store"), cwd: root, sessionId: "session" });
    await controller.start("topic");
    const updates = await Promise.all(
      ["one", "two"].map((label) =>
        controller.recordStep({
          topic: "topic",
          stage: "framing",
          note: label,
          thought_number: 1,
          total_thoughts: 1,
          next_step_needed: false,
          criteria: [{ label }],
        }),
      ),
    );
    expect(updates.filter((update) => update.warnings.some((warning) => warning.includes("Duplicate")))).toHaveLength(
      1,
    );
    const durable = await controller.status();
    expect(durable?.revision).toBe(1);
    expect(durable?.plan.steps).toHaveLength(1);
    expect(durable?.plan.criteria).toHaveLength(1);
  });

  it("does not expose mutable runtime ownership through returned records", async () => {
    const root = await mkdtemp(join(tmpdir(), "exa-cycles-"));
    roots.push(root);
    const controller = await createResearchCycles({ root: join(root, "store"), cwd: root, sessionId: "session" });
    const cycle = await controller.start("topic");
    const resumed = await controller.resume(cycle.id);
    if (!resumed.owner) throw new Error("Expected owned cycle");
    resumed.owner.token = "tampered";
    expect((await controller.status())?.id).toBe(cycle.id);
  });

  it("uses the Git common directory across worktrees", async () => {
    const root = await mkdtemp(join(tmpdir(), "exa-cycles-git-"));
    roots.push(root);
    const exec = promisify(execFile);
    await exec("git", ["init", "--quiet", root]);
    // An unborn linked-worktree fixture avoids commits or Git identity overrides.
    const linked = join(root, "linked");
    const metadata = join(root, ".git", "worktrees", "linked");
    await mkdir(linked);
    await mkdir(metadata, { recursive: true });
    await writeFile(join(linked, ".git"), `gitdir: ${metadata}\n`);
    await writeFile(join(metadata, "commondir"), "../..\n");
    await writeFile(join(metadata, "HEAD"), "ref: refs/heads/linked\n");
    await writeFile(join(metadata, "gitdir"), `${join(linked, ".git")}\n`);
    expect(await researchProjectId(linked)).toBe(await researchProjectId(root));
  });

  it("recovers a verified dead local owner without making a completed cycle editable", async () => {
    const root = await mkdtemp(join(tmpdir(), "exa-cycles-"));
    roots.push(root);
    const controller = await createResearchCycles({ root: join(root, "store"), cwd: root, sessionId: "new-session" });
    const cycle = await controller.start("topic");
    const archived = await controller.archive();
    const { stdout } = await promisify(execFile)(process.execPath, ["-e", "process.stdout.write(String(process.pid))"]);
    const fixture = {
      ...archived,
      status: "completed",
      owner: { sessionId: "dead-session", token: "dead-token", pid: Number(stdout) },
    };
    await writeFile(join(root, "store", controller.projectId, `${cycle.id}.json`), JSON.stringify(fixture));
    const resumed = await controller.resume(cycle.id);
    expect(resumed.status).toBe("completed");
    expect(resumed.owner?.sessionId).toBe("new-session");
    expect(await controller.summary()).toContain("Status: completed");
    await expect(
      controller.recordStep({
        topic: "topic",
        stage: "framing",
        note: "",
        thought_number: 1,
        total_thoughts: 1,
        next_step_needed: false,
      }),
    ).rejects.toThrow("not editable");
    expect((await controller.archive()).status).toBe("completed");
    expect(await controller.inspect(cycle.id)).toMatchObject({ status: "completed", archived: true });
  });

  it("retains unknown attempts, ledger, and grants when archived or resumed", async () => {
    const root = await mkdtemp(join(tmpdir(), "exa-cycles-"));
    roots.push(root);
    const controller = await createResearchCycles({ root: join(root, "store"), cwd: root, sessionId: "session" });
    const cycle = await controller.start("topic");
    const archived = await controller.archive();
    const fixture = {
      ...archived,
      status: "unknown",
      attempts: [{ id: "attempt-one", status: "unknown", runId: "remote-one" }],
      ledger: [{ kind: "unknown", attemptId: "attempt-one" }],
      grants: [{ source: "command", budget: 1 }],
    };
    await writeFile(join(root, "store", controller.projectId, `${cycle.id}.json`), JSON.stringify(fixture));
    const resumed = await controller.resume(cycle.id);
    await expect(
      controller.recordStep({
        topic: "topic",
        stage: "framing",
        note: "",
        thought_number: 1,
        total_thoughts: 1,
        next_step_needed: false,
      }),
    ).rejects.toThrow("not editable");
    const reset = await controller.archive();
    expect(reset.status).toBe("unknown");
    expect(reset.attempts).toEqual(resumed.attempts);
    expect(reset.ledger).toEqual(fixture.ledger);
    expect(reset.grants).toEqual(fixture.grants);
  });

  it("rejects unsupported records and traversal without changing disk state", async () => {
    const root = await mkdtemp(join(tmpdir(), "exa-cycles-"));
    roots.push(root);
    const controller = await createResearchCycles({ root: join(root, "store"), cwd: root, sessionId: "session" });
    const cycle = await controller.start("topic");
    await controller.detach();
    const path = join(root, "store", controller.projectId, `${cycle.id}.json`);
    const future = JSON.stringify({ ...cycle, schemaVersion: 2 });
    await writeFile(path, future);
    await expect(controller.resume(cycle.id)).rejects.toThrow("unsupported");
    await expect(controller.inspect("../secret")).rejects.toThrow("Invalid research cycle ID");
    expect(await readFile(path, "utf8")).toBe(future);
  });

  it("does not advance a revision when durable replacement fails", async () => {
    const root = await mkdtemp(join(tmpdir(), "exa-cycles-"));
    roots.push(root);
    const controller = await createResearchCycles({ root: join(root, "store"), cwd: root, sessionId: "session" });
    await controller.start("topic");
    vi.mocked(fs.rename).mockRejectedValueOnce(new Error("disk failure"));
    await expect(
      controller.recordStep({
        topic: "topic",
        stage: "framing",
        note: "private",
        thought_number: 1,
        total_thoughts: 1,
        next_step_needed: false,
      }),
    ).rejects.toThrow("disk failure");
    const stored = await controller.status();
    expect(stored?.revision).toBe(0);
    expect(stored?.plan.steps).toHaveLength(0);
  });

  it("enforces runtime ownership and keeps projects isolated", async () => {
    const root = await mkdtemp(join(tmpdir(), "exa-cycles-"));
    const otherProject = await mkdtemp(join(tmpdir(), "exa-project-"));
    roots.push(root, otherProject);
    const options = { root: join(root, "store"), cwd: root, sessionId: "session" };
    const first = await createResearchCycles(options);
    const cycle = await first.start("topic");
    const competitor = await createResearchCycles(options);
    await expect(competitor.resume(cycle.id)).rejects.toThrow("live");
    const outsider = await createResearchCycles({ ...options, cwd: otherProject });
    expect(await outsider.list()).toEqual([]);
    await expect(outsider.resume(cycle.id)).rejects.toThrow();
    await first.detach();
    await competitor.resume(cycle.id);
    await expect(
      first.recordStep({
        topic: "topic",
        stage: "framing",
        note: "old owner",
        thought_number: 1,
        total_thoughts: 1,
        next_step_needed: false,
      }),
    ).rejects.toThrow("No active");
  });

  it("archives without raw planning notes and stores private records", async () => {
    const root = await mkdtemp(join(tmpdir(), "exa-cycles-"));
    roots.push(root);
    const controller = await createResearchCycles({ root: join(root, "store"), cwd: root, sessionId: "session" });
    const cycle = await controller.start("topic");
    await controller.recordStep({
      topic: "topic",
      stage: "framing",
      note: "PRIVATE_CHATTER_SENTINEL",
      thought_number: 1,
      total_thoughts: 1,
      next_step_needed: false,
    });
    const archived = await controller.archive();
    expect(archived.archived).toBe(true);
    expect(archived.owner).toBeUndefined();
    expect(archived.grants).toEqual([]);
    expect(await controller.status()).toBeUndefined();
    const path = join(root, "store", controller.projectId, `${cycle.id}.json`);
    expect(await readFile(path, "utf8")).not.toContain("PRIVATE_CHATTER_SENTINEL");
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    expect((await stat(join(root, "store", controller.projectId))).mode & 0o777).toBe(0o700);
    await controller.resume(cycle.id);
    expect((await controller.status())?.revision).toBe(1);
  });

  it("permits only one active cycle when start commands race", async () => {
    const root = await mkdtemp(join(tmpdir(), "exa-cycles-"));
    roots.push(root);
    const controller = await createResearchCycles({ root: join(root, "store"), cwd: root, sessionId: "session" });
    const results = await Promise.allSettled([controller.start("one"), controller.start("two")]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(await controller.list()).toHaveLength(1);
  });

  it("refuses a symlink storage root rather than writing outside its namespace", async () => {
    const root = await mkdtemp(join(tmpdir(), "exa-cycles-"));
    roots.push(root);
    const outside = await mkdtemp(join(tmpdir(), "exa-outside-"));
    roots.push(outside);
    await symlink(outside, join(root, "store"));
    const controller = await createResearchCycles({ root: join(root, "store"), cwd: root, sessionId: "session" });
    await expect(controller.start("topic")).rejects.toThrow("directory");
    expect(await controller.status()).toBeUndefined();
  });

  it("requires explicit resume after restart and retains curated planning state", async () => {
    const root = await mkdtemp(join(tmpdir(), "exa-cycles-"));
    roots.push(root);
    const options = { root: join(root, "store"), cwd: root, sessionId: "session-one" };
    const first = await createResearchCycles(options);
    const cycle = await first.start("pricing");
    await first.recordStep({
      topic: "pricing",
      stage: "framing",
      note: "Private raw planning chatter",
      thought_number: 1,
      total_thoughts: 2,
      next_step_needed: true,
      criteria: [{ label: "Official price" }],
      sources: [{ title: "Pricing", url: "https://example.com/pricing" }],
      assumptions: ["Price may vary"],
    });
    await first.detach();
    const restarted = await createResearchCycles({ ...options, sessionId: "session-two" });
    expect(await restarted.status()).toBeUndefined();
    const resumed = await restarted.resume(cycle.id);
    expect(resumed.revision).toBe(1);
    expect(resumed.plan.criteria[0].label).toBe("Official price");
    expect(resumed.plan.sources[0].url).toBe("https://example.com/pricing");
    expect(resumed.plan.assumptions).toEqual(["Price may vary"]);
    expect(await restarted.summary({ mode: "execution_plan" })).toContain("Official price");
    const next = await restarted.recordStep({
      topic: "pricing",
      stage: "criteria_discovery",
      note: "Another private note",
      thought_number: 2,
      total_thoughts: 2,
      next_step_needed: false,
      criteria: [{ label: "Coverage" }],
    });
    expect(next.cycle.revision).toBe(2);
    expect(next.criteria.map((criterion) => criterion.id)).toEqual(["C1", "C2"]);
  });
});

import { execFile } from "node:child_process";
