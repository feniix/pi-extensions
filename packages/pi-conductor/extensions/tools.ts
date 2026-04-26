import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { registerEvidenceTools } from "./tools/evidence-tools.js";
import { registerGateTools } from "./tools/gate-tools.js";
import { registerObjectiveTools } from "./tools/objective-tools.js";
import { registerProjectTools } from "./tools/project-tools.js";
import { registerTaskTools } from "./tools/task-tools.js";
import { registerWorkerTools } from "./tools/worker-tools.js";

export function registerConductorTools(pi: ExtensionAPI, findRepoRoot: (cwd: string) => string | null): void {
  registerProjectTools(pi, findRepoRoot);
  registerObjectiveTools(pi);
  registerTaskTools(pi);
  registerGateTools(pi);
  registerEvidenceTools(pi);
  registerWorkerTools(pi);
}
