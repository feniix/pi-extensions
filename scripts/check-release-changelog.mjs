import { readFileSync } from "node:fs";
import { join } from "node:path";

const packages = process.argv.slice(2);
if (packages.length === 0) {
  console.error("Usage: node scripts/check-release-changelog.mjs <package-directory> [...]");
  process.exit(1);
}

for (const directory of packages) {
  const changelogPath = join(directory, "CHANGELOG.md");
  try {
    const { name, version } = JSON.parse(readFileSync(join(directory, "package.json"), "utf8"));
    const changelog = readFileSync(changelogPath, "utf8");
    const headings = [...changelog.matchAll(/^## \[([^\]]+)\](.*)$/gm)];
    const entries = headings.filter((heading) => heading[1] === version);
    if (entries.length !== 1) throw new Error(`Expected exactly one entry for ${version}.`);
    const entry = entries[0];
    const date = entry[2].trim().match(/^- (\d{4}-\d{2}-\d{2})$/)?.[1];
    if (!date || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date) {
      throw new Error(`Entry for ${version} must have a real YYYY-MM-DD release date, not Unreleased.`);
    }
    const next = headings[headings.indexOf(entry) + 1];
    const notes = changelog.slice(entry.index + entry[0].length, next?.index);
    if (!/^- \S.+$/m.test(notes)) throw new Error(`Entry for ${version} must contain release notes.`);
    console.log(`Validated ${name}@${version}: ${changelogPath}`);
  } catch (error) {
    console.error(`${changelogPath}: ${error.message}`);
    process.exitCode = 1;
  }
}
