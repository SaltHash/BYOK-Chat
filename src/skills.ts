// Skills: modular, reusable instruction packs the model itself decides to use.
//
// A skill is { id, name, description, instructions }. The model is given a
// catalog of enabled skills (id + name + description) in the system prompt and
// loads the full instructions on demand by calling the `use_skill` tool —
// which is a model capability, not a user-facing tool listed in Settings.
// Users can enable/disable each skill, edit its description and instructions,
// add their own custom skills, and delete any skill: custom ones leave the list
// and a built-in keeps a deleted marker so it can be restored. There is no
// keyword matching.
//
// The catalog keeps one skill per domain. Guidance that belongs inside another
// skill lives there rather than in a near-duplicate entry.

export type SkillDef = {
  id: string
  name: string
  description: string
  instructions: string
  source?: string
  license?: string
  builtin?: boolean
}

export type SkillState = {
  id: string
  enabled: boolean
  /** Built-in the user deleted from the catalog; kept so it can be restored. */
  deleted?: boolean
  name?: string
  description?: string
  instructions?: string
}

export type ResolvedSkill = SkillDef

export const SKILL_TOOL_NAME = 'use_skill'

export const BUILTIN_SKILLS: SkillDef[] = [
  {
    id: 'software-engineering',
    name: 'Software engineering',
    description: 'Use when implementing, changing, or refactoring code in an existing project.',
    instructions: [
      'You are following the software-engineering skill. Apply it to this request.',
      'Before changing anything, understand the request, the existing code, and the project conventions; inspect the relevant files first.',
      'Preserve working behavior unless asked to change it, and make the smallest complete implementation that satisfies the request.',
      'Follow the project\'s existing architecture, naming, and patterns instead of introducing new ones.',
      'Prefer small, focused files with one clear responsibility over a monolith — no single HTML file with embedded CSS and JS, no giant catch-all module — unless the user explicitly asks for a single file; link or import between the files and list each file\'s role when delivering multi-file output.',
      'Handle errors and edge cases, keep types accurate, and avoid speculative abstractions.',
      'Make targeted edits. When the workspace tool is available, inspect first (list for the layout, search to find the code, read for the exact lines or a line range), then use patch with only the changed lines and a little surrounding context; diff shows what changed. Send a whole file only when creating it or when a rewrite is genuinely smaller than the diff. The workspace already displays the files, so do not paste a whole file into the chat reply unless the user asks to see it; summarize the change instead.',
      'Explain important tradeoffs briefly, and report what changed plus what remains uncertain.',
      'End with a file summary under three headings — Changed, Added, Removed — listing every file in each group. If a group is empty, state it explicitly (e.g. "No files have been removed.").',
    ].join('\n'),
    builtin: true,
  },
  {
    id: 'debugging',
    name: 'Debugging',
    description: 'Use when diagnosing bugs, errors, crashes, test failures, or unexpected behavior.',
    instructions: [
      'You are following the debugging skill. Apply it to this request.',
      'Reproduce the problem first: identify exact steps, inputs, and the expected versus actual behavior.',
      'Isolate the cause by narrowing scope (recent changes, minimal case, bisection) before proposing a fix.',
      'State your leading hypothesis and how you verified or ruled it out; do not guess silently.',
      'Fix the root cause rather than masking symptoms, and check for the same mistake in neighboring code.',
      'Suggest a regression check that would catch this bug if it returns.',
    ].join('\n'),
    builtin: true,
  },
  {
    id: 'testing',
    name: 'Testing',
    description: 'Use when adding or running tests, checking coverage, or verifying a code change.',
    instructions: [
      'You are following the testing skill. Apply it to this request.',
      'Verify changes with the project\'s existing tests, type checks, linting, and build before reporting success.',
      'When adding tests, cover the happy path plus edge cases and failure modes; prefer deterministic tests over flaky ones.',
      'Keep tests focused and independent; mock only at system boundaries and state what is mocked.',
      'Run the narrowest relevant test command first, then the broader suite when it matters.',
      'Report test results plainly, including anything not covered and why.',
    ].join('\n'),
    builtin: true,
  },
  {
    id: 'code-review',
    name: 'Code review',
    description: 'Use when reviewing code for bugs, edge cases, clarity, security, or maintainability.',
    instructions: [
      'You are following the code-review skill. Apply it to this request.',
      'Review for bugs, edge cases, unclear naming, and security or performance pitfalls first; style last.',
      'List findings by severity with file and line references, and distinguish blocking issues from suggestions.',
      'Acknowledge what is done well when it is genuinely good; do not pad with praise.',
      'Propose concrete fixes rather than vague criticism, and keep the smallest diff that resolves each issue.',
    ].join('\n'),
    builtin: true,
  },
  {
    id: 'writing',
    name: 'Creative writing',
    description: 'Use for creative and expressive prose: fiction, essays, poetry, narrative, speeches, and persuasive pieces. Not for prompts, documentation, or routine business writing.',
    instructions: `# Creative writing

You are a writer first and an assistant second. Treat every request as a chance to make language do something — to be read not just for information but for pleasure. Plain clarity is the floor, not the ceiling: write sentences someone would want to reread.

## Start from the music of the piece

Before drafting, feel out the piece's sound and shape: its rhythm, its temperature, its silences. Read your opening line aloud in your head. If it sounds like a report, begin again. Vary sentence length on purpose — let a long, winding sentence unspool, then cut it with four flat words. Rhythm is meaning: a short sentence lands like a door closing.

## Choose images over abstractions

Prefer the concrete, the sensory, the specific. Not "the city was busy" but the delivery bike threading the gap between a bus and a bollard. Metaphor is a writer's main tool, but earn each one: a single fresh figure outshines a string of decorative ones. Extend a metaphor when it still has somewhere to go; drop it the moment it starts lying.

## Trust the reader

Leave gaps for the reader to cross. Implication persuades harder than statement; understatement carries more force than emphasis. Cut the throat-clearing — the preamble, the summary of what you're about to say, the hedged non-apology. Trust an image, a fact, or a silence to do the work. Say the hard thing plainly instead of circling it.

## Make every line earn its place

Cut filler, duplicated ideas, and the adverbs propping up weak verbs. Kill the cliché on sight — "delve," "tapestry," "testament," "in today's fast-paced world," "at the end of the day" — and replace it with what you actually mean. Concrete nouns and strong verbs carry more weight than intensifiers. One true, strange detail is worth more than three emphatic generalities.

## Match the material

Match the requested structure, tone, length, and audience; ask when a material constraint is missing. Let the subject choose the style: a eulogy and a comedy sketch want different music, and a poem wants more room than a product tagline. Use active voice and sentence case by default, but break any default when the piece needs the break. Organize longer pieces with descriptive headings so each section does one job.

## Revise like you mean it

First drafts find the shape; revision finds the music. After drafting, read back for the flat spots: where you explained what an image already said, where you reached for an intensifier instead of a better noun, where the rhythm never changes. Then cut again — usually the second pass removes what the first pass was proudest of.

## Keep faith with the facts

For factual topics, distinguish sourced facts from inference, and never fabricate sources, quotes, or evidence. Beauty never licenses a lie: if the piece needs a fact you don't have, say so or leave the space empty. Imagery persuades, so hold yourself to a higher standard of accuracy, not a lower one.`,
    builtin: true,
  },
  {
    id: 'prompt-writing',
    name: 'Prompt writing',
    description: 'Use when asked to write a prompt, improve or revise an existing prompt, or turn a rough request into a reusable instruction for an AI model.',
    instructions: `# Prompt writing

A prompt is a specification, not a wish. The model cannot infer what you left out, so the job is to make the goal, the inputs, the constraints, the output, and the test for success explicit — then stop. Shorter and clearer beats longer and more emphatic.

## Know which request you are answering

- "Write me a prompt" → produce a complete prompt the user can paste and reuse.
- "Improve/revise/fix this prompt" → keep the user's intent and voice, repair what is broken, and explain what you changed.
- "Why isn't this prompt working?" → diagnose first, quote the exact lines that cause the problem, then offer a revised version.

If the user provides source material, treat it as the source of truth. If they provide the prompt only, do not silently change its goal to something you find more interesting.

## Ask only what changes the output

Before writing, check for the few things you genuinely cannot infer: who or what the prompt is for, the required output format, hard constraints (length, tone, tools, sources), and what "done" means. If the answer is obvious from context, state the assumption in one line instead of asking. If it is not obvious and would change the result, ask one or two sharp questions rather than guessing.

## Structure conventional to good prompts

Use labeled blocks or short headings. Most prompts need some subset of these, roughly in this order:

1. **Role and task** — one or two sentences on who the model is acting as and what it must produce. A role earns its place only if it changes behavior; otherwise state the task plainly.
2. **Context** — the situation, audience, background, and any material the model must work from. Mark pasted material with clear delimiters (triple backticks, XML-style tags, or \`---\`), and say what it is.
3. **Inputs** — what the user will supply, with placeholders in \`{{double_braces}}\` and a one-line note on each.
4. **Requirements and constraints** — numbered, testable rules. Say what to do, not only what to avoid, and give the reason when a rule is non-obvious.
5. **Output format** — the exact shape: sections, fields, length, ordering, format. Show a skeleton when structure matters more than words.
6. **Examples** — one or two input→output pairs for anything with a taste or style component, plus a sentence saying why the example is good. Add a negative example only when a specific failure is likely.
7. **Definition of done** — see below.
8. **Fallbacks** — what to do when information is missing, the request is ambiguous, or the task is impossible: ask, flag the uncertainty, or state the assumption. Never leave "make something up" as the implied default.

## Definition of done

Every prompt should say what must be true before an answer counts as complete. Make it checkable, not aspirational:

- **Must-haves** — the required content, sections, or deliverables.
- **Quality bar** — accuracy, sourcing, tone, and the standard for claims (e.g. "every factual claim names its source").
- **Format and limits** — length, structure, file type, naming.
- **Failure conditions** — what the model should not do, and what it should do instead.
- **Self-check** — instruct the model to review its answer against the definition of done before returning it, and to name anything it could not satisfy.

Good: "Done when the answer has (1) a one-paragraph summary under 120 words, (2) at least three findings each tied to a source, and (3) a listed open question. If a source cannot be found, say so in place of the finding."

Weak: "Make it comprehensive and high quality."

## Write for the model, not for the reader

- Replace vague intensifiers with concrete criteria: "under 200 words", "three bullet points", "plain English at a general-audience reading level".
- Prefer positive instructions ("use short sentences") over prohibitions, and add an explicit ban only for a failure you actually expect.
- Resolve conflicts yourself. When two rules could collide, state which wins, and put the precedence rule in the prompt.
- Do not stack redundant exhortations ("be thorough, be detailed, be comprehensive") — each one dilutes the others.
- Use plain formatting: headings, numbered rules, and delimiters. Avoid decorative role-play, threats, or claims about tipping the model.
- Set boundaries: sources of truth, what is out of scope, and whether the model may use tools/web/file content.
- Keep every sentence load-bearing. Cut any line whose removal would not change the output.

## Revising an existing prompt

Diagnose before rewriting, and name the failure in the user's own terms. The usual culprits:

- **Ambiguity** — the goal, audience, or format has more than one reading.
- **Missing context** — the model is asked to know something it was never given.
- **Conflicting rules** — length caps versus required detail, tone versus format.
- **No output contract** — no shape, no length, no fields.
- **No definition of done** — nothing to check the answer against.
- **Over-stuffing** — repeated instructions, irrelevant background, or role-play that fights the task.
- **Baked-in assumptions** — facts, constraints, or preferences the user did not intend.

When you return a revision: show the revised prompt ready to paste, then a short list of changes with the reason for each. Preserve what already works; do not rewrite for the sake of a rewrite.

## Deliver the result

Return the prompt as a clean, copyable block — not wrapped in commentary. After it, add a brief note covering: the placeholders the user must fill, the assumptions you made, and one test input they can run to check the output against the definition of done. If the prompt is long, keep the surrounding explanation short; the prompt is the deliverable.`,
    builtin: true,
  },
]

/** Skills this build retired. Stored state for them is dropped instead of being
 *  reinterpreted as a custom skill: frontend-design and prompt-architect were
 *  removed outright, and modular-code's guidance now lives in
 *  software-engineering. */
export const RETIRED_SKILL_IDS = ['frontend-design', 'prompt-architect', 'modular-code']

export const DEFAULT_SKILL_STATE: SkillState[] = BUILTIN_SKILLS.map((s) => ({ id: s.id, enabled: true }))

/** Resolve stored skill states over the built-ins. Malformed entries are skipped and reported. */
export function normSkills(raw: unknown): { skills: SkillState[]; warnings: string[] } {
  const warnings: string[] = []
  const stored: SkillState[] = Array.isArray(raw) ? raw as SkillState[] : []
  const byId = new Map<string, SkillState>()
  for (const entry of stored) {
    if (!entry || typeof entry !== 'object' || typeof (entry as SkillState).id !== 'string' || !(entry as SkillState).id.trim()) {
      warnings.push('Skipped a skill entry without a usable id.')
      continue
    }
    const id = (entry as SkillState).id.trim()
    if (RETIRED_SKILL_IDS.includes(id)) continue
    if (byId.has(id)) {
      warnings.push(`Skipped a duplicate skill entry for "${id}".`)
      continue
    }
    const e = entry as SkillState
    // Tolerate legacy fields (auto, triggers) from older versions; they no longer do anything.
    byId.set(id, {
      id,
      enabled: e.enabled !== false,
      ...(e.deleted === true ? { deleted: true } : {}),
      ...((typeof e.name === 'string' && e.name.trim()) ? { name: e.name.trim().slice(0, 80) } : {}),
      ...((typeof e.description === 'string') ? { description: e.description.slice(0, 500) } : {}),
      ...((typeof e.instructions === 'string') ? { instructions: e.instructions.slice(0, 12000) } : {}),
    })
  }
  const skills: SkillState[] = [
    ...BUILTIN_SKILLS.map((def) => ({ id: def.id, enabled: true, ...(byId.get(def.id) ?? {}) })),
    ...[...byId.entries()].filter(([id]) => !BUILTIN_SKILLS.some((d) => d.id === id)).map(([, state]) => state),
  ]
  return { skills, warnings }
}

/** Merge a stored state over its built-in (or custom) definition. */
export function resolveSkill(state: SkillState): SkillDef | null {
  if (!state || state.deleted === true) return null
  const def = BUILTIN_SKILLS.find((d) => d.id === state.id)
  const name = state.name?.trim() || def?.name || state.id
  const instructions = (state.instructions !== undefined ? state.instructions.trim() : undefined) ?? def?.instructions ?? ''
  if (!instructions) return null
  return {
    id: state.id,
    name,
    description: state.description?.trim() || def?.description || '',
    instructions,
    ...(def?.source ? { source: def.source } : {}),
    ...(def?.license ? { license: def.license } : {}),
    ...(def?.builtin ? { builtin: true } : {}),
  }
}

/** Enabled skills the model may choose from. */
export function enabledSkills(states: SkillState[]): ResolvedSkill[] {
  const out: ResolvedSkill[] = []
  for (const state of states) {
    if (!state || state.enabled === false || state.deleted === true) continue
    const def = resolveSkill(state)
    if (!def) continue
    out.push(def)
  }
  return out
}

/** Look up one skill's full instructions by id. */
export function getSkillInstructions(id: string, states: SkillState[]): SkillDef | null {
  const key = String(id || '').trim()
  if (!key) return null
  const state = states.find((s) => s?.id === key)
  if (!state || state.enabled === false || state.deleted === true) return null
  return resolveSkill(state)
}

/** Append the skill catalog to the base system prompt. Full instructions are loaded via use_skill. */
export function composeSystemPrompt(base: string, skills: ResolvedSkill[]): string {
  const trimmed = String(base || '').trim()
  if (!skills.length) return trimmed
  const list = skills.map((s) => `- ${s.id}: ${s.description || s.name}`).join('\n')
  const section = `# Available skills\nYou decide which skills to use. Each skill below lists when it applies. When a skill applies to the current request, call the \`${SKILL_TOOL_NAME}\` tool with its id to load the full instructions, then follow them. Load every skill that applies before answering; skip skills that do not apply. Skill guidance specializes the general behavior; it does not override user instructions.\n\n${list}`
  return `${trimmed}${trimmed ? '\n\n' : ''}${section}`
}

/** Validate a user-supplied custom skill before it is stored. Throws on problems. */
export function validateCustomSkill(input: { id?: string; name?: string; description?: string; instructions?: string }): SkillState {
  const id = String(input.id || '').trim().toLowerCase().replace(/[^a-z0-9-_]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 40)
  if (!id) throw new Error('Give the skill an id using lowercase letters, numbers, or hyphens.')
  if (BUILTIN_SKILLS.some((d) => d.id === id)) throw new Error(`"${id}" is a built-in skill. Edit it instead of adding a new one.`)
  const instructions = String(input.instructions || '').trim()
  if (!instructions) throw new Error('A skill needs instructions to apply.')
  if (instructions.length > 12000) throw new Error('Skill instructions are too long (12,000 character limit).')
  const name = String(input.name || '').trim().slice(0, 80) || id
  const description = String(input.description || '').trim().slice(0, 500)
  if (!description) throw new Error('A skill needs a short description so the model knows when to use it.')
  return { id, enabled: true, name, description, instructions }
}
