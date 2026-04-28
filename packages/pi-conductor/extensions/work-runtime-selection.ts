import type { RunRuntimeMode } from "./types.js";

function hasExecutionIntent(request: string): boolean {
  return /\b(run|start|execute|launch|do|implement|fix|build|ship|create|work on)\b/i.test(request);
}

function hasHeadlessRuntimeIntent(request: string): boolean {
  return /\b(headless|without tmux|no tmux|do not use tmux|don't use tmux|dont use tmux|not tmux|without iterm|no iterm|do not use iterm|don't use iterm|dont use iterm)\b/i.test(
    request,
  );
}

function hasStatusOnlyIntent(request: string): boolean {
  return (
    /\b(show|list|display|view|inspect|status)\b/i.test(request) &&
    /\b(current|active|existing|all)?\s*(workers|runs|tasks|project|status|sessions|panes|terminals|tmux|iterm)\b/i.test(
      request,
    ) &&
    !hasExecutionIntent(request)
  );
}

function hasVisibleSupervisionIntent(request: string): boolean {
  return (
    hasExecutionIntent(request) &&
    /\b(show|open|watch|view|supervise|visible|viewer|terminal|pane)\b/i.test(request) &&
    /\b(worker|workers|run|runs|session|sessions|pane|panes|terminal|output|progress)\b/i.test(request)
  );
}

export function isStatusOnlyWorkRequest(request: string): boolean {
  return hasStatusOnlyIntent(request.trim());
}

export function selectRuntimeModeForWork(input: {
  request: string;
  explicitRuntimeMode?: RunRuntimeMode;
}): RunRuntimeMode | undefined {
  if (input.explicitRuntimeMode) {
    return input.explicitRuntimeMode;
  }
  const request = input.request.trim();
  if (!request || hasStatusOnlyIntent(request)) {
    return undefined;
  }
  if (hasHeadlessRuntimeIntent(request)) {
    return "headless";
  }
  if (!hasExecutionIntent(request)) {
    return undefined;
  }
  if (/\biterm(?:2)?\b|\biterm-tmux\b/i.test(request)) {
    return "iterm-tmux";
  }
  if (/\btmux\b/i.test(request)) {
    return "tmux";
  }
  return hasVisibleSupervisionIntent(request) ? "iterm-tmux" : undefined;
}
