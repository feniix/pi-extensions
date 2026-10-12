/** Private local-process locks. Never reclaim by age or overwrite a live owner. */
import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { link, open, unlink } from "node:fs/promises";
import { join } from "node:path";
import { Type } from "typebox";
import { Value } from "typebox/value";

const ownerSchema = Type.Object(
  {
    kind: Type.Literal("research-storage-lock-v1"),
    pid: Type.Integer({ minimum: 1, maximum: 2147483647 }),
    token: Type.String({ pattern: "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$" }),
  },
  { additionalProperties: false },
);
const errorCode = (error: unknown) =>
  typeof error === "object" && error !== null && "code" in error ? String(error.code) : undefined;

async function snapshot(path: string) {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const info = await file.stat({ bigint: true });
    if (
      !info.isFile() ||
      info.size > 1024n ||
      info.mode & 0o077n ||
      (process.getuid && info.uid !== BigInt(process.getuid()))
    )
      throw new Error("Unsafe lock.");
    const owner: unknown = JSON.parse(await file.readFile("utf8"));
    if (!Value.Check(ownerSchema, owner)) throw new Error("Unknown lock owner.");
    return { owner, info };
  } finally {
    await file.close();
  }
}

function dead(pid: number) {
  try {
    process.kill(pid, 0);
    return false;
  } catch (error) {
    return errorCode(error) === "ESRCH";
  }
}

export async function withResearchStorageLock<T>(directory: string, action: () => Promise<T>): Promise<T> {
  const path = join(directory, ".lock");
  const deadline = performance.now() + 1000;
  const candidate = join(directory, `.lock-owner-${randomUUID()}.tmp`);
  const owner = { kind: "research-storage-lock-v1", pid: process.pid, token: randomUUID() };
  const file = await open(candidate, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600);
  try {
    try {
      // Publish an already complete, synced owner record with atomic exclusive
      // link(), not open(.lock) followed by an interruptible PID write.
      await file.writeFile(JSON.stringify(owner), "utf8");
      await file.sync();
    } finally {
      await file.close();
    }
  } catch (error) {
    await unlink(candidate);
    throw error;
  }
  const unavailable = (target: string) =>
    new Error(
      `Research cycle storage is locked or unavailable at ${target}; no state changed. Unknown/legacy owners require explicit offline repair; never remove a live process lock.`,
    );

  async function acquire(target: string, depth = 0): Promise<() => Promise<void>> {
    while (performance.now() < deadline) {
      try {
        await link(candidate, target);
        return async () => {
          const current = await snapshot(target);
          if (current.owner.token !== owner.token || current.owner.pid !== owner.pid)
            throw new Error(`Research cycle lock ownership changed at ${target}.`);
          await unlink(target);
        };
      } catch (error) {
        if (errorCode(error) !== "EEXIST") throw error;
      }
      let previous: Awaited<ReturnType<typeof snapshot>>;
      try {
        previous = await snapshot(target);
      } catch (error) {
        if (errorCode(error) === "ENOENT") continue;
        throw unavailable(target);
      }
      if (dead(previous.owner.pid)) {
        // One reclaimer per immutable dead-owner token. Other reclaimers
        // cannot unlink a replacement acquired after the old lock disappears.
        // A crashed reclaimer is recovered by the same protocol; recursion is
        // bounded so adversarial/legacy files require explicit repair.
        if (depth >= 4) throw unavailable(target);
        const release = await acquire(`${target}.recovery-${previous.owner.token}`, depth + 1);
        try {
          const current = await snapshot(target).catch((error: unknown) => {
            if (errorCode(error) === "ENOENT") return undefined;
            throw unavailable(target);
          });
          if (
            current?.owner.token === previous.owner.token &&
            current.owner.pid === previous.owner.pid &&
            current.info.dev === previous.info.dev &&
            current.info.ino === previous.info.ino &&
            dead(current.owner.pid)
          )
            await unlink(target);
        } finally {
          await release();
        }
        continue;
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw unavailable(target);
  }

  try {
    const release = await acquire(path);
    try {
      return await action();
    } finally {
      await release();
    }
  } finally {
    await unlink(candidate);
  }
}
