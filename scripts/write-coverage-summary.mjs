import { appendFileSync, readFileSync } from "node:fs";

const [summaryPath, packageName] = process.argv.slice(2);

if (!summaryPath || !packageName) {
  console.error("Usage: node scripts/write-coverage-summary.mjs <summary-path> <package-name>");
  process.exit(1);
}

const summary = JSON.parse(readFileSync(summaryPath, "utf-8"));
const total = summary.total;
const output = [
  `## Coverage: ${packageName}`,
  "",
  "| Metric | Covered | Total | Pct |",
  "| --- | ---: | ---: | ---: |",
  `| Lines | ${total.lines.covered} | ${total.lines.total} | ${total.lines.pct}% |`,
  `| Statements | ${total.statements.covered} | ${total.statements.total} | ${total.statements.pct}% |`,
  `| Functions | ${total.functions.covered} | ${total.functions.total} | ${total.functions.pct}% |`,
  `| Branches | ${total.branches.covered} | ${total.branches.total} | ${total.branches.pct}% |`,
  "",
].join("\n");

appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${output}\n`);
