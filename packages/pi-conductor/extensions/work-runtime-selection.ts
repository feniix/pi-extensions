import type { RunRuntimeMode } from "./types.js";

function hasExecutionIntent(request: string): boolean {
  return /\b(run|start|execute|launch|do|implement|fix|build|ship|create|work on)\b/i.test(request);
}

function hasHeadlessRuntimeIntent(request: string): boolean {
  return /\b(headless|without tmux|no tmux|do not use tmux|don't use tmux|dont use tmux|not tmux|without iterm|no iterm|do not use iterm|don't use iterm|dont use iterm)\b/i.test(
    request,
  );
}

function hasStatusBlockingExecutionIntent(request: string): boolean {
  return (
    /\b(start|execute|launch|implement|fix|build|ship|create|work on)\b/i.test(request) ||
    /\bdo\s+(?:this|that|the\s+work|the\s+task|work|task)\b/i.test(request) ||
    /^(?:please\s+|can you\s+|could you\s+)?\s*run\b/i.test(request) ||
    /\b(?:and|then|to)\s+run\b/i.test(request) ||
    /\bworkers?\s+run\b/i.test(request)
  );
}

function hasStatusOnlyIntent(request: string): boolean {
  if (hasStatusBlockingExecutionIntent(request)) {
    return false;
  }

  const statusResource =
    /\b(worker|workers|run|runs|running|task|tasks|project|status|session|sessions|pane|panes|terminal|terminals|tmux|iterm|output|log|logs)\b/i;
  const startsWithInspectionVerb =
    /^(?:please\s+|can you\s+|could you\s+)?\s*(show|list|display|view|inspect|status|check|get)\b/i.test(request);
  const startsWithViewerInspectionVerb =
    /^(?:please\s+|can you\s+|could you\s+)?\s*(watch|open|tail)\s+(?:the\s+)?(?:current|active|existing|all|status)\b/i.test(
      request,
    );
  const startsWithStatusQuestion =
    /^(?:please\s+|can you\s+|could you\s+)?\s*(what(?:'s| is)|what are|are there|are any|do i have|is there|is any)\b/i.test(
      request,
    );
  const startsWithResourceStatus =
    /^(?:please\s+|can you\s+|could you\s+)?\s*(?:the\s+)?(?:current|active|existing|all)\s+(worker|workers|run|runs|task|tasks|project|session|sessions|pane|panes|terminal|terminals|tmux|iterm)\b/i.test(
      request,
    );

  return (
    (startsWithInspectionVerb ||
      startsWithViewerInspectionVerb ||
      startsWithStatusQuestion ||
      startsWithResourceStatus) &&
    statusResource.test(request)
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
