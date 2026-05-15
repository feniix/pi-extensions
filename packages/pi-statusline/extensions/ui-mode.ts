export type UiAvailability = { hasUI: boolean };

export function createUiOnlyHandler<Event, Ctx extends UiAvailability, Result>(
  handler: (event: Event, ctx: Ctx) => Result | Promise<Result>,
): (event: Event, ctx: Ctx) => Result | Promise<Result> | undefined {
  return (event, ctx) => {
    if (!ctx.hasUI) {
      return undefined;
    }

    return handler(event, ctx);
  };
}
