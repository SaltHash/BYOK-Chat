// Skills: modular, reusable instruction packs the model itself decides to use.
//
// A skill is { id, name, description, instructions }. The model is given a
// catalog of enabled skills (id + name + description) in the system prompt and
// loads the full instructions on demand by calling the `use_skill` tool —
// which is a model capability, not a user-facing tool listed in Settings.
// Users can enable/disable each skill, edit its description and instructions,
// and add or remove their own custom skills. There is no keyword matching.
//
// The `frontend-design` skill is Anthropic's skill verbatim from its official
// source (https://github.com/anthropics/skills/tree/main/skills/frontend-design),
// Apache-2.0 licensed. Only its frontmatter is adapted into skill fields; the
// instruction text is preserved word for word.

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
  name?: string
  description?: string
  instructions?: string
}

export type ResolvedSkill = SkillDef

export const SKILL_TOOL_NAME = 'use_skill'

const FRONTEND_DESIGN_INSTRUCTIONS = `# Frontend Design

Approach this as the design lead at a design studio known for giving every client a distinct visual identity that is not mistaken for anyone else's. This client has already rejected proposals that felt cliché or templated, and is paying for a distinctive point of view: make deliberate, opinionated choices about palette, typography, and layout that are specific to this brief, and take aesthetic risk if justified.

## Ground your designs in the subject matter

If the brief does not identify what the product or subject matter is, identify it yourself before designing, and confirm with the client. You can come up with one concrete subject, the design's audience, and the design's primary job, as a proposal. If there's any information in your memory about the client's preferences or context about what they're building, use that as a hint. The subject's industry, subject matter, materials, and vernacular are where distinctive visual choices come from — a design for a toy for girls aged 8–11 will be very aesthetically different from a dashboard for financial analysts. Build with the brief's real content and subject matter throughout.

## Design principles

For web designs, the hero is the first thing viewers will see. Open with the most characteristic thing in the subject's world, in the form that is most appropriate: a headline, an image, an animation, a live demo, an interactive moment, or other treatments. Be deliberate with your choice: a big number with a small label, supporting stats, and a gradient accent is the default treatment, so only use it if that's truly the best option.

Typography carries the personality of the page. You don't need a different typeface for display or headline text and body content: use one family or two, and if two, make them clearly distinct.

Choose your typefaces deliberately, not the default families you would reach for on any other project, and set a clear type scale following the default guidance of The Elements of Typographic Style with intentional weights, widths, and spacing. When type is used as a headline or visual element, use the type treatment itself as an active part of the design, not a neutral delivery vehicle for the content.

Default to line lengths of less than 80 characters. Serif typefaces can have slightly longer line lengths; give serif body text slightly more line-height than a sans-serif.

Avoid these default typographic treatments; they are the commonest tells of a generated page:
- Accenting just a single word or phrase in a headline, like putting one word in italic/bold or a different color.
- Using all caps for labels.
- Adding unnecessary typographic labels above content.

Visual structure is information. Structural devices like outlines, borders, numbering, eyebrows, dividers, labels, etc., encode useful information about the content rather than decorate it. Many generic designs use numbered markers (01 / 02 / 03), but that's only appropriate if the content actually is a sequence — like a stepped process or a timeline. Before adding numbered markers, check the content really is a sequence.

Use non-user-triggered motion sparingly and deliberately, only to draw attention. A single orchestrated moment — one page-load sequence or one reveal — lands better than scattered effects; fade-and-slide-up entrances on each section and hover transitions on every card are the generic default and read as AI-generated. Motion that answers a person's action (opening, expanding, confirming) is welcome when it shows what changed.

Consider written content carefully. Often a design brief may not contain real content, and it's up to you to come up with copy and placeholder content. Copy can make a design feel as templated as the design itself. See the below section on writing for more guidance.

## Process: plan, review against the brief, build, critique

For calibration, AI-generated design right now clusters around some traits:
1. a warm cream background (near #F4F1EA) with a high-contrast serif display and a terracotta or warm-clay accent (often near #D97757 — Anthropic's own Claude-interaction accent, so on a user's brief it reads as a tell);
2. a near-black background with a single bright acid-green or vermilion accent;
3. a broadsheet-style layout with hairline rules, zero border-radius, and dense newspaper-like columns;
4. the SaaS-card kit: content chopped into identical rounded cards, one border-radius on everything regardless of hierarchy, the same soft grey shadow (rgba(0,0,0,.1)) under each, and gradient washes as decoration;
5. template chrome that appears whatever the subject: a tracked-out ALL-CAPS eyebrow label above every heading; meta strings joined with middle dots ('A · B · C'); labels built as 'WORD — fragment' with a spaced em dash; tinted near-black (#0B0B0B, #111) standing in for black; a monospace face for small data labels; a '→' appended to link and button text.

All traits are legitimate for some briefs, but they are defaults rather than choices, and they appear regardless of subject. Where the brief pins down a visual direction, follow it exactly — the brief's own words always win, including when it asks for one of these looks. Where it leaves an axis free, don't spend that freedom on one of these defaults. As with a hired human designer, there's often a careful balance between doing what you're good at and taking each project as a chance to experiment and learn.

Work in two passes. First, brainstorm a short design plan based on the client's design brief: create a compact token system with color, type, layout, and principles.
- Color: describe the core base palette as 4–6 named hex values.
- Type: the typefaces and their roles.
- Layout: a layout concept, using one-sentence prose descriptions and ASCII wireframes to ideate and compare. Include alignment guidance; should the content be left aligned, center aligned, justified?
- Principles: the high-level guidance for what makes this page unique.

Then review that plan against the brief before building: if any part of it reads like the generic default you would produce for any similar page (work through a similar prompt to see if you arrive somewhere similar) rather than a choice made for this specific brief — revise that part, say what you changed and why. Only after you've confirmed the relative uniqueness of your design plan should you start to write the code, following the revised plan.

When writing the code, be careful of structuring your CSS selector specificities. It's easy to generate CSS classes that cancel each other out (especially with a type-based selector like .section and an element-based selector like .cta). This can happen often with padding/margin between sections.

## Restraint and self-critique

Spend your boldness in one place. Let one element be the memorable thing, keep everything around it quiet and disciplined, and cut any decoration that does not serve the brief. Build to a quality floor without announcing it: responsive down to mobile, visible keyboard focus, reduced motion respected, visually accessible, harmonious color palettes. Critique your own work as you build, taking screenshots to review if your environment supports it — a picture is worth 1000 tokens. Consider Chanel's advice: before leaving the house, take a look in the mirror and remove one accessory. Human creatives have memory and always try to do something new, so if you have a space to quickly jot down notes about what you've tried, it can help you in future passes.

## More on writing in design

Words appear in a design for one reason: to make it easier to understand and use. They are design content, not decoration. Bring the same intentionality and minimalism to copywriting that you would bring to spacing and color. Before writing anything, ask what the design needs to say, and how it can best be said to help the person navigate the experience.

Write from the end user's perspective. Name things by what users will understand in simple language, not by how the system is built. A user manages notifications, not webhook config. Describe what something is or does in plain terms rather than selling it. Being specific and legible to new users is always better than being clever.

Use active voice as default. A CTA says exactly what happens when it is used: "Save changes," not "Submit." An action keeps the same name through the whole flow, so the button that says "Publish" produces a toast that says "Published." The vocabulary of an interface is the signposting for someone navigating the product. Cohesion and consistency are how people learn their way around.

Treat failure and emptiness as moments for direction, not mood. Explain what went wrong and how to fix it, in the interface's voice rather than a person's. Errors don't apologize, and they are never vague about what happened. An empty screen is an invitation to act.

Keep the tone conversational: plain verbs, sentence case, no filler, with tone matched to the brand and the audience. Let each written element do exactly one job.`

export const BUILTIN_SKILLS: SkillDef[] = [
  {
    id: 'frontend-design',
    name: 'Frontend design',
    description: `Use when building new UI or reshaping existing UI: picking layout, palette, typography, and visual direction.`,
    instructions: FRONTEND_DESIGN_INSTRUCTIONS,
    source: 'https://github.com/anthropics/skills/tree/main/skills/frontend-design',
    license: 'Apache-2.0 © Anthropic (verbatim; see repository THIRD_PARTY_NOTICES)',
    builtin: true,
  },
  {
    id: 'software-engineering',
    name: 'Software engineering',
    description: 'Use when implementing, changing, or refactoring code in an existing project.',
    instructions: [
      'You are following the software-engineering skill. Apply it to this request.',
      'Before changing anything, understand the request, the existing code, and the project conventions; inspect the relevant files first.',
      'Preserve working behavior unless asked to change it, and make the smallest complete implementation that satisfies the request.',
      'Follow the project\'s existing architecture, naming, and patterns instead of introducing new ones.',
      'Handle errors and edge cases, keep types accurate, and avoid speculative abstractions.',
      'Deliver each touched file in full, not as excerpts or patches. The only exception is a change of a few lines inside a large file (300+ lines), where showing just the surrounding section is clearer.',
      'Explain important tradeoffs briefly, and report what changed plus what remains uncertain.',
      'End with a file summary under three headings — Changed, Added, Removed — listing every file in each group. If a group is empty, state it explicitly (e.g. "No files have been removed.").',
    ].join('\n'),
    builtin: true,
  },
  {
    id: 'modular-code',
    name: 'Modular code',
    description: 'Use when writing new code or files: prefer small modular files over a single monolith.',
    instructions: [
      'You are following the modular-code skill. Apply it to this request.',
      'Write modular code by default: split work across small, focused files with clear separation of concerns (e.g. separate markup, styles, and scripts; separate modules, helpers, and entry points).',
      'Do not put everything in one file — no single HTML file with embedded CSS and JS, no single massive Python script, no giant catch-all module — unless the user explicitly asks for a single file.',
      'If the user explicitly asks for a single file or a single script, follow that instruction; this skill does not override the user.',
      'Keep each file focused on one responsibility, use imports or links between files, and keep naming consistent with the project conventions.',
      'When delivering multi-file output, list the files and their roles briefly so the user knows where everything lives.',
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
    name: 'Writing',
    description: 'Use when drafting or editing prose: documents, messages, READMEs, proposals, or summaries.',
    instructions: `# Writing

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

Match the requested structure, tone, length, and audience; ask when a material constraint is missing. Let the subject choose the style: a eulogy and a README want different music, and a poem wants more room than a changelog. Use active voice and sentence case by default, but break any default when the piece needs the break. Organize longer pieces with descriptive headings so each section does one job.

## Revise like you mean it

First drafts find the shape; revision finds the music. After drafting, read back for the flat spots: where you explained what an image already said, where you reached for an intensifier instead of a better noun, where the rhythm never changes. Then cut again — usually the second pass removes what the first pass was proudest of.

## Keep faith with the facts

For factual topics, distinguish sourced facts from inference, and never fabricate sources, quotes, or evidence. Beauty never licenses a lie: if the piece needs a fact you don't have, say so or leave the space empty. Imagery persuades, so hold yourself to a higher standard of accuracy, not a lower one.`,
    builtin: true,
  },
]

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
    if (byId.has(id)) {
      warnings.push(`Skipped a duplicate skill entry for "${id}".`)
      continue
    }
    const e = entry as SkillState
    // Tolerate legacy fields (auto, triggers) from older versions; they no longer do anything.
    byId.set(id, {
      id,
      enabled: e.enabled !== false,
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
    if (!state || state.enabled === false) continue
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
  if (!state || state.enabled === false) return null
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
