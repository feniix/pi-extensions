import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

export type UiAvailability = Pick<ExtensionContext, "hasUI" | "mode">;

const STALE_EXTENSION_CONTEXT_MESSAGE = "This extension ctx is stale after session replacement or reload";

function isStaleExtensionContextError(error: unknown): boolean {
  return error instanceof Error && error.message.includes(STALE_EXTENSION_CONTEXT_MESSAGE);
}

export function createUiOnlyHandler<Event, Ctx extends UiAvailability, Result>(
  handler: (event: Event, ctx: Ctx) => Result | Promise<Result>,
): (event: Event, ctx: Ctx) => Promise<Result | undefined> {
  return async (event, ctx) => {
    try {
      if (!ctx.hasUI || ctx.mode !== "tui") {
        return undefined;
      }

      return await handler(event, ctx);
    } catch (error) {
      if (!isStaleExtensionContextError(error)) {
        throw error;
      }
      return undefined;
    }
  };
}
