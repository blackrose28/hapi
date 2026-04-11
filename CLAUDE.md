# Claude + Codex repo workflow

You are operating in a repo that uses:
- Claude Code for planning and review
- Codex MCP for implementation and command execution

## Task routing

Choose the workflow based on task type.

### Feature / enhancement work
Use:
1. planner
2. Codex MCP implementation
3. reviewer

### Bug / regression / crash / flaky behavior
Use:
1. bug-triager
2. Codex MCP diagnosis + fix
3. reviewer

## Bug workflow rules

For bug tasks:
- Do not patch before triage
- Establish expected vs actual behavior
- Prefer reproduction and evidence gathering before code changes
- Require a root cause explanation from Codex
- Prefer fixes that address the cause, not just the symptom
- Add or update a regression test when possible
- Persist bug triage output to `.ai/artifacts/latest-plan.md`
- Persist review output to `.ai/artifacts/latest-review.md`

## Required sequence

For implementation tasks, always follow this order:

1. Use the `planner` subagent first.
2. Show the plan to the user unless they explicitly asked for silent execution.
3. After plan approval, use the Codex MCP tool to implement the plan.
4. After Codex completes, use the `reviewer` subagent.
5. If review fails, do at most one additional Codex fix round unless the user asks for more.

## Planning requirements

The planner must produce:
- Goal
- Acceptance Criteria
- Constraints
- Target Files
- Test Plan
- Risks
- Execution Prompt for Codex

## Artifact persistence rules

The planner subagent must return only the final plan artifact.

After the planner returns, the main agent must:
1. write the returned content to `.ai/artifacts/latest-plan.md`
2. show the same plan to the user
3. only then continue

The reviewer subagent must return only the final review.
After the reviewer returns, the main agent must:
1. write the returned content to `.ai/artifacts/latest-review.md`
2. show the same review to the user
3. only then continue

The task is not complete until the artifact file has been written successfully.

## Codex execution requirements

When calling Codex:
- Send the approved plan, not a vague task
- Prefer the smallest patch that satisfies the plan
- Stay within target files unless necessary
- Run the listed test commands when possible
- Return:
  - summary of changes
  - files changed
  - commands run
  - test results
  - unresolved concerns

## Review requirements

The reviewer must:
- Compare implementation against the approved plan
- Check every acceptance criterion
- Identify unexpected file changes
- Identify missing tests or weak edge cases
- Return PASS or FAIL
- If FAIL, provide a single fix prompt for Codex

## General repo rules

- Prefer minimal diffs
- Do not add dependencies unless the task explicitly requires it
- Do not change public APIs unless required
- Do not self-approve code without review
- Be explicit about uncertainty

## Codex MCP call configuration

When calling the Codex MCP tool, always use:

- cwd: "."
- approval-policy: "never"
- sandbox: "danger-full-access"
- include-plan-tool: false

## Artifact persistence

The main agent must always persist the plan to:
- .ai/artifacts/latest-plan.md

The main agent must always persist the review to:
- .ai/artifacts/latest-review.md

These files should be overwritten on each run and contain only the finalized artifact.