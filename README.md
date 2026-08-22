# Pi extensions

A monorepo of extensions, tools, and integrations for
[pi](https://pi.dev/), the AI coding agent. Each package is versioned and
published independently under the [`@feniix`](https://www.npmjs.com/~feniix)
npm scope.

## Packages

| Package | What it adds |
| --- | --- |
| [`@feniix/pi-devtools`](packages/pi-devtools/) | Branch, pull-request, merge, CI, and release workflows |
| [`@feniix/pi-exa`](packages/pi-exa/) | Exa search, content retrieval, grounded answers, and research planning |
| [`@feniix/pi-notion`](packages/pi-notion/) | Notion access through the official Notion MCP server |
| [`@feniix/pi-ref-tools`](packages/pi-ref-tools/) | Token-efficient technical documentation search through Ref.tools |
| [`@feniix/pi-statusline`](packages/pi-statusline/) | A two-line terminal status display for model, context, Git, token, and skill state |

Follow a package link for its requirements, configuration, tool reference, and
security notes.

### Retired packages

These packages are no longer maintained. Each had a final archival release on
npm and its history now lives in an archived repository. Do not start new work
on them.

| Package | What it added | Archive |
| --- | --- | --- |
| `@feniix/pi-code-reasoning` | Reflective sequential reasoning with branching and revision support for pi and MCP | [feniix/pi-code-reasoning](https://github.com/feniix/pi-code-reasoning) |
| `@feniix/pi-sequential-thinking` | Structured progressive thinking through defined cognitive stages | [feniix/pi-sequential-thinking](https://github.com/feniix/pi-sequential-thinking) |
| `@feniix/pi-specdocs` | PRD, ADR, and implementation-plan documentation workflows | [feniix/pi-specdocs](https://github.com/feniix/pi-specdocs) |
| `@feniix/pi-conductor` | Local control plane for parallel pi workers across Git worktrees | [feniix/pi-conductor](https://github.com/feniix/pi-conductor) |

The specs that described them stay under `docs/`, marked superseded or
archived.

## Install

Install only the package you need:

```bash
pi install npm:@feniix/pi-devtools
```

Run a package for one session without installing it:

```bash
pi -e npm:@feniix/pi-devtools
```

Replace `pi-devtools` with any package name from the table above.

## Develop

This repository is an npm workspace. It requires Node.js 22.19.0 or newer.

```bash
npm ci
npm run check
npm test
```

Useful commands:

```bash
npm run lint
npm run typecheck
npm run test:coverage
npm run audit:workspaces
```

To load one package directly from a checkout:

```bash
pi -e ./packages/pi-devtools
```

Package tests live alongside their extension under
`packages/<package>/__tests__/`. Shared CI detects affected packages and runs
package-scoped lint, type checking, tests, and coverage checks.

## Repository structure

```text
packages/                 independently published pi packages
docs/solutions/           write-ups for solved implementation problems
scripts/                  workspace audit and CI change-detection helpers
CONCEPTS.md               shared project vocabulary
```

## License

MIT. See [`LICENSE`](LICENSE). Individual packages also include a copy of the
license in their published artifacts.
