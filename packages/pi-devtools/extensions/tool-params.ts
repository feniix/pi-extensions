import { Type } from "@sinclair/typebox";

export const createBranchParams = Type.Object({
  branchName: Type.String({ description: "Name of the branch to create (e.g., feature/add-login)" }),
  switchBranch: Type.Optional(Type.Boolean({ description: "Whether to switch to the new branch (default: true)" })),
});

export const commitParams = Type.Object({
  message: Type.String({ description: "Commit message (conventional format: type: description)" }),
  files: Type.Optional(Type.Array(Type.String(), { description: "Specific files to commit (default: all staged)" })),
  noVerify: Type.Optional(Type.Boolean({ description: "Skip pre-commit hooks (default: false)" })),
});

export const pushParams = Type.Object({
  branch: Type.Optional(Type.String({ description: "Branch to push (default: current)" })),
  setUpstream: Type.Optional(Type.Boolean({ description: "Set upstream tracking (default: true)" })),
});

export const createPrParams = Type.Object({
  title: Type.String({ description: "PR title" }),
  body: Type.Optional(Type.String({ description: "PR body/description" })),
  base: Type.Optional(Type.String({ description: "Target branch (default: default branch)" })),
  draft: Type.Optional(Type.Boolean({ description: "Create as draft PR (default: false)" })),
  assignees: Type.Optional(Type.Array(Type.String(), { description: "Assignees (GitHub usernames)" })),
});

export const mergePrParams = Type.Object({
  prNumber: Type.Optional(Type.Integer({ description: "PR number (default: current branch PR)" })),
  squash: Type.Optional(Type.Boolean({ description: "Squash merge (default: false)" })),
  deleteBranch: Type.Optional(Type.Boolean({ description: "Delete source branch after merge (default: true)" })),
  commitTitle: Type.Optional(Type.String({ description: "Title for the squash commit" })),
  commitMessage: Type.Optional(Type.String({ description: "Message for the squash commit" })),
});

export const checkCiParams = Type.Object({
  prNumber: Type.Optional(Type.Integer({ description: "PR number (default: current branch PR)" })),
  branch: Type.Optional(Type.String({ description: "Branch to check (default: current)" })),
});

export const emptyParams = Type.Object({});

export const bumpVersionParams = Type.Object({
  newVersion: Type.String({ description: "New version (e.g., 1.2.3)" }),
  file: Type.Optional(Type.String({ description: "File to update (default: package.json)" })),
});

export const createReleaseParams = Type.Object({
  tag: Type.String({ description: "Version tag (e.g., v1.2.3)" }),
  title: Type.String({ description: "Release title" }),
  body: Type.Optional(Type.String({ description: "Release notes/changelog" })),
  draft: Type.Optional(Type.Boolean({ description: "Create as draft (default: false)" })),
  prerelease: Type.Optional(Type.Boolean({ description: "Mark as prerelease (default: false)" })),
});
