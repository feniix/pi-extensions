import { buildStatusLines } from "./format.js";
import { defaultPalette } from "./palette.js";
import { getCwdLabel, getRepoFallbackLabel } from "./session.js";
import type { StatuslinePalette, StatuslineState } from "./types.js";

type StatuslineInput = {
  modelLabel: string;
  thinkingLabel: string;
  contextLabel: string;
  branchLabel: string;
  dirtyLabel: string;
  tokenLabel: string;
  repoLabel: string;
  cwdLabel: string;
  worktreeLabel: string;
  skillLabel: string;
  activityLabel: string;
};

export function getBranchLabel(branch: string | null | undefined): string {
  return `⎇ ${branch || "no git"}`;
}

export function getWorktreeLabel(worktreeLabel: string): string {
  return `𖠰 ${worktreeLabel || "no git"}`;
}

export function getDirtyLabel(dirtyCount: number): string {
  return `dirty: +${dirtyCount}`;
}

export function buildLines(
  cwd: string,
  state: StatuslineState,
  branchLabel: string | null,
  width?: number,
  palette: StatuslinePalette = defaultPalette,
): string[] {
  const input: StatuslineInput = {
    modelLabel: state.modelLabel,
    thinkingLabel: state.thinkingLabel,
    contextLabel: state.contextLabel,
    branchLabel: getBranchLabel(branchLabel),
    dirtyLabel: getDirtyLabel(state.gitSnapshot.dirtyCount),
    tokenLabel: state.tokenLabel,
    repoLabel: state.gitSnapshot.repoName || getRepoFallbackLabel(cwd),
    cwdLabel: getCwdLabel(cwd),
    worktreeLabel: getWorktreeLabel(state.gitSnapshot.worktreeLabel),
    skillLabel: `Skill: ${state.lastSkill || "none"}`,
    activityLabel: state.activityLabel,
  };

  return buildStatusLines(input, width, palette);
}
