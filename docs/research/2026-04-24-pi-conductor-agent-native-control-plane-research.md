# Research: pi-conductor as LLM-directed long-lived multi-session subagent orchestration for Pi

## Summary
A `pi-conductor` concept aligns with several converging patterns: durable workflow engines for long-running stateful work, multi-agent/subagent delegation frameworks, and Kubernetes-style reconciliation/control planes. The strongest prior-art signal is not “one-shot chat agents,” but durable, observable orchestration where an LLM plans and delegates while a deterministic runtime owns persistence, retries, resource limits, worktree/session lifecycle, and auditability.

## Findings
1. **Durable execution is the key technical substrate for long-lived agents** — Temporal’s core model treats workflows as durable, replayable executions with retries, timers, signals, queries, and activity workers, which maps well to “agent conductor owns intent/state; workers perform side effects.” This suggests `pi-conductor` should avoid storing critical state only in chat context and instead persist task/session/worktree state in a durable log/state machine. [Temporal docs](https://docs.temporal.io/)

2. **Developer-facing durable-function platforms validate demand for persistent background work with observability** — Inngest positions itself around durable functions, steps, retries, concurrency, and event-driven execution; Hatchet similarly emphasizes distributed task execution, retries, scheduling, and worker orchestration. These are strong market signals that developers want orchestration semantics without building queues, retry stores, and dashboards from scratch. [Inngest docs](https://www.inngest.com/docs), [Hatchet docs](https://docs.hatchet.run/)

3. **Kubernetes control-plane design is a useful analogy: desired state + reconciliation beats imperative scripts** — Kubernetes controllers continuously compare desired state with actual cluster state and make changes to converge them; Operators extend this to app-specific lifecycle management. For `pi-conductor`, a similar model could treat “desired sessions/tasks/worktrees/agents” as resources and reconcile them via Pi tools, rather than executing a brittle linear script. [Kubernetes Controllers](https://kubernetes.io/docs/concepts/architecture/controller/), [Kubernetes Operator pattern](https://kubernetes.io/docs/concepts/extend-kubernetes/operator/)

4. **Resource governance matters early if agents can create long-lived work** — Kubernetes ResourceQuota, Jobs, and controller semantics show that systems with autonomous workers need quotas, ownership, cleanup, restart policy, and status conditions. A conductor that can spawn sessions/worktrees should likely include max concurrent agents, TTLs, cancellation, budgets, locks, and garbage collection. [Kubernetes Resource Quotas](https://kubernetes.io/docs/concepts/policy/resource-quotas/), [Kubernetes Jobs](https://kubernetes.io/docs/concepts/workloads/controllers/job/)

5. **Multi-agent frameworks show demand for role-specialized delegation but often under-emphasize durable local execution** — Microsoft AutoGen provides multi-agent conversation patterns and orchestration abstractions; CrewAI markets role-based agent teams, processes, and tasks; OpenAI’s Agents SDK emphasizes agents, handoffs, tools, guardrails, and tracing. These validate the UX pattern of a high-level agent delegating to specialized agents, but `pi-conductor` can differentiate by integrating local repo/session/worktree lifecycle and durable execution. [AutoGen docs](https://microsoft.github.io/autogen/stable/), [CrewAI docs](https://docs.crewai.com/), [OpenAI Agents SDK](https://openai.github.io/openai-agents-python/)

6. **LangGraph is especially adjacent because it frames agents as stateful graphs with persistence** — LangGraph’s public positioning around controllable agents, persistence, human-in-the-loop, memory, and durable execution is close to the “agent control plane” idea. It is useful prior art for representing agent work as resumable graphs/state transitions rather than stateless prompts. [LangGraph concepts](https://langchain-ai.github.io/langgraph/concepts/)

7. **Claude Code-style subagents indicate that subagent delegation has become a mainstream IDE/CLI agent primitive** — Anthropic documents subagents as specialized assistants with separate context windows, custom system prompts, and tool permissions. This supports the idea that Pi users may understand and value named, role-scoped subagents; `pi-conductor` could add lifecycle, durability, and orchestration above that primitive. [Claude Code subagents](https://docs.anthropic.com/en/docs/claude-code/sub-agents)

8. **Git worktrees are a practical isolation primitive for parallel repo agents** — Git’s `worktree` feature allows multiple working trees attached to one repository, enabling isolated branches/checkouts for concurrent work. For conductor design, worktrees provide a natural unit of scheduling, locking, cleanup, and result collation for subagents working in parallel. [git-worktree manual](https://git-scm.com/docs/git-worktree)

9. **Session multiplexers and notebook/job systems offer analogies for long-lived interactive workers** — tmux persists terminal sessions beyond a single client connection; Jupyter kernels separate persistent execution state from UI clients. These analogies support separating Pi front-end chat from durable backend agent sessions. [tmux wiki](https://github.com/tmux/tmux/wiki), [Jupyter architecture docs](https://docs.jupyter.org/en/latest/projects/architecture/content-architecture.html)

10. **Observability and traceability are a market expectation for agent orchestration** — OpenAI Agents SDK includes tracing; LangSmith/LangGraph emphasize observability for agent runs; Temporal exposes workflow history and task visibility. For `pi-conductor`, run histories, task DAGs, prompts/tool-call logs, status conditions, and resumability are likely core product features, not add-ons. [OpenAI Agents SDK tracing](https://openai.github.io/openai-agents-python/tracing/), [LangSmith observability](https://docs.smith.langchain.com/), [Temporal visibility](https://docs.temporal.io/visibility)

11. **A promising architecture is “LLM as planner, conductor as reconciler, workers as executors”** — Across workflow engines and Kubernetes, reliability comes from constraining nondeterministic decision-making and letting deterministic infrastructure handle retries, idempotency, cancellation, and state. `pi-conductor` should likely let the LLM propose plans and resource specs, while the runtime validates, persists, schedules, monitors, and cleans up.

12. **The strongest differentiation opportunity is local developer-environment orchestration** — Existing agent frameworks orchestrate conversations or cloud workers; durable task queues orchestrate generic code; Kubernetes orchestrates containers. A Pi-native conductor could combine repo-aware worktrees, terminal/editor sessions, Pi extension tools, subagent delegation, and durable task state in one local control plane.

## Sources
- Kept: Temporal Documentation (https://docs.temporal.io/) — primary source for durable workflow execution, retries, signals, workflow history, and workers.
- Kept: Inngest Documentation (https://www.inngest.com/docs) — developer-market signal for durable background functions and event-driven orchestration.
- Kept: Hatchet Documentation (https://docs.hatchet.run/) — adjacent open-source task orchestration/workers platform.
- Kept: Kubernetes Controllers (https://kubernetes.io/docs/concepts/architecture/controller/) — primary source for reconciliation/control-plane analogy.
- Kept: Kubernetes Operator pattern (https://kubernetes.io/docs/concepts/extend-kubernetes/operator/) — source for app-specific lifecycle automation pattern.
- Kept: Kubernetes Resource Quotas (https://kubernetes.io/docs/concepts/policy/resource-quotas/) — source for resource governance analogy.
- Kept: Kubernetes Jobs (https://kubernetes.io/docs/concepts/workloads/controllers/job/) — source for finite task execution semantics.
- Kept: Microsoft AutoGen docs (https://microsoft.github.io/autogen/stable/) — prior art for multi-agent orchestration.
- Kept: CrewAI docs (https://docs.crewai.com/) — market signal for role-based agent crews/tasks.
- Kept: OpenAI Agents SDK docs (https://openai.github.io/openai-agents-python/) — prior art for agents, handoffs, tools, guardrails, and tracing.
- Kept: LangGraph concepts (https://langchain-ai.github.io/langgraph/concepts/) — close prior art for stateful/durable agent graphs.
- Kept: Anthropic Claude Code subagents (https://docs.anthropic.com/en/docs/claude-code/sub-agents) — direct signal that subagents are a recognized coding-agent UX primitive.
- Kept: git-worktree manual (https://git-scm.com/docs/git-worktree) — primary source for worktree isolation primitive.
- Kept: tmux wiki (https://github.com/tmux/tmux/wiki) — analogy for detached persistent terminal sessions.
- Kept: Jupyter architecture docs (https://docs.jupyter.org/en/latest/projects/architecture/content-architecture.html) — analogy for persistent execution kernels separated from clients.
- Dropped: SEO listicles comparing “AI agent frameworks” — generally redundant and less authoritative than project docs.
- Dropped: Vendor blog posts announcing agent products — useful for trend scanning but weaker than docs unless they describe concrete architecture.
- Dropped: Academic multi-agent surveys — broad but less actionable for Pi extension/product design than durable execution and developer tooling docs.

## Gaps
- Pi-specific public extension architecture documentation was not verified here; the brief intentionally avoids codebase content and focuses on external analogies.
- Exact feasibility depends on Pi’s extension lifecycle, tool invocation model, persistence APIs, and ability to spawn/resume independent sessions.
- Next steps: validate Pi runtime constraints; prototype a minimal resource model (`Task`, `Worker`, `Session`, `Worktree`, `Run`); compare a lightweight local SQLite-backed reconciler versus using an external durable engine such as Temporal, Inngest, or Hatchet.
