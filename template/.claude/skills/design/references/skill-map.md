# Design Skill Map

Complete catalog of available design skills with routing guidance.

## Issue → Skill Mapping

Use this table during diagnostic scans to map problems to the right skill.

| Observed Problem                         | Skill               | Notes                                   |
| ---------------------------------------- | ------------------- | --------------------------------------- |
| No design context / brand unclear        | `/impeccable teach`   | Run once per project                       |
| No design system (colors, fonts, tokens) | `/impeccable teach`   | Gather context and define design system    |
| Need requirements clarified before code  | `/impeccable shape`   | (v2) Shape phase before craft              |
| Build a new feature / page               | `/impeccable craft`   | Main build flow (replaces v1 frontend-design) |
| Deviates from design system              | `/polish`             | (v2.1) Absorbs v1 /normalize               |
| Too many elements, overwhelming          | `/distill`            | Simplify before enhancing                  |
| Repeated patterns not extracted          | `/impeccable extract` | (v2.1) Pull into design system             |
| Poor spacing, weak layout, bad grouping  | `/layout`             | (v2.1 renamed from /arrange)               |
| Generic fonts, no type hierarchy         | `/typeset`            | Font choice, scale, weight                 |
| Monochromatic, all gray                  | `/colorize`           | Strategic color addition                   |
| Too safe, boring, generic                | `/bolder`             | Amplify visual impact                      |
| Too intense, aggressive, noisy           | `/quieter`            | Tone down, add sophistication              |
| No transitions, jarring state changes    | `/animate`            | Purposeful motion                          |
| Unclear labels, jargon, bad errors       | `/clarify`            | UX copy improvement                        |
| Functional but lifeless                  | `/delight`            | Joy, personality, surprise                 |
| Poor first-time experience               | `/harden`             | (v2.1) Absorbs v1 /onboard                 |
| No error/loading/empty states            | `/harden`             | Edge cases, i18n, resilience               |
| Slow load, janky scroll, heavy bundle    | `/optimize`           | Performance improvement                    |
| Doesn't work on mobile/tablet            | `/adapt`              | Cross-device adaptation                    |
| Needs pixel-perfect final pass           | `/polish`             | Alignment, consistency, details            |
| Want "how did they do that?" moment      | `/overdrive`          | Technically ambitious                      |

## Skill Categories

### Foundational (run first)

- **`/impeccable teach`** — Establishes persistent design context (`.impeccable.md`). Run once per project. All other design skills read this file. (v2.0 renamed from `/teach-impeccable`)
- **`/impeccable shape`** — (v2) Requirements gathering before code generation. Good for reducing rework.
- **`/impeccable craft`** — Main build flow. Produces distinctive, production-grade frontend code. Umbrella skill that absorbed v1 `frontend-design`.
- **`/nuxt-ui`** — Nuxt UI v4 component library reference (125+ components). Use when project has `@nuxt/ui`. Provides component APIs, theming via `app.config.ts`, and Tailwind Variants integration.

### Diagnostic (assess without changing)

- **`/audit`** — Systematic scan: accessibility, performance, theming, responsive. Outputs severity-rated report. Best for: comprehensive quality assessment.
- **`/critique`** — Holistic design evaluation: visual hierarchy, information architecture, emotional resonance. Includes AI slop detection. Best for: design direction assessment.

### Structural (reshape)

- **`/layout`** — Layout, spacing, visual rhythm, hierarchy. Fixes monotonous grids and weak grouping. (v2.1 renamed from `/arrange`)
- **`/distill`** — Removes unnecessary complexity. 80/20 analysis, progressive disclosure.
- **`/impeccable extract`** — Identifies and consolidates reusable components and design tokens. (v2.1 moved into `impeccable` umbrella)
- **`/polish`** — Aligns feature with existing design system, fixes drift + final pass. (v2.1 absorbed v1 `/normalize`)

### Visual (refine aesthetics)

- **`/typeset`** — Font selection, hierarchy, scale, weight consistency, readability.
- **`/colorize`** — Adds strategic color: semantic meaning, hierarchy, categorization.
- **`/bolder`** — Amplifies safe designs: extreme scale, bold palette, distinctive fonts.
- **`/quieter`** — Tones down intensity: reduces saturation, simplifies, adds sophistication.

### Experiential (enhance feel)

- **`/animate`** — Motion: entrance sequences, micro-interactions, state transitions. Includes performance guidance (60fps, GPU, reduced-motion).
- **`/clarify`** — UX copy: error messages, form labels, CTAs, help text, empty states.
- **`/delight`** — Personality: micro-interactions with joy, playful copy, easter eggs, celebrations.

### Resilience (strengthen)

- **`/harden`** — Edge cases, text overflow, i18n, error handling, input validation, a11y resilience, AND first-time UX (welcome flows, tooltips, empty states, progressive disclosure). (v2.1 absorbed v1 `/onboard`)
- **`/optimize`** — Performance: Core Web Vitals, bundle size, rendering, animations.
- **`/audit`** — Diagnostic verification: accessibility, performance, theming, responsive. Run before `/polish` to catch Critical issues.

### Production (ship)

- **`/polish`** — Final pass: alignment, spacing tokens, typography details, interaction states, micro-interactions, content, icons, forms, edge cases, responsive, performance, code quality. 16-dimension checklist.
- **`/adapt`** — Cross-platform: mobile, tablet, desktop, print. Touch targets, navigation patterns, responsive layouts.
- **`/overdrive`** — Technically ambitious: View Transitions, scroll-driven animations, WebGL, spring physics. MUST propose 2-3 directions first.

## Mutual Exclusivity

Some skills are alternatives, not complements:

- `/bolder` vs `/quieter` — opposite directions. Pick one based on whether design is too safe or too aggressive.
- `/distill` before `/bolder` — simplify complexity, THEN amplify if needed. Never both on the same target simultaneously.
- `/colorize` vs `/quieter` — if the goal is to tone down, don't also add color. Choose the dominant direction.

## Common Workflows

### Quick Fix (1-2 issues)

```
/audit or /critique → identify the 1-2 biggest issues → targeted skill → /polish
```

### Visual Refresh

```
/critique → /layout → /typeset → /colorize → /animate → /polish
```

### Production Hardening

```
/audit → /harden → /optimize → /adapt → /polish
```

### Design System Bootstrap

```
/impeccable teach → /polish → /impeccable extract
```

### Nuxt UI Project (auto-detected)

```
/impeccable teach → /nuxt-ui (component reference) → build with <UComponent> markup → /polish
```

---

## Open Source Library Recommendations

When recommending skills, also suggest compatible open-source libraries for faster implementation.

### By Skill Category

#### Foundational

| Skill               | Recommended Libraries                                                                                 | Notes                                       |
| ------------------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| `/impeccable teach` | —                                                                                                     | Outputs `.impeccable.md`, no library needed |
| `/polish`           | [Style Dictionary](https://amzn.github.io/style-dictionary/), [Tokens Studio](https://tokens.studio/) | Token management & sync (absorbs v1 `/normalize`) |

#### Structural

| Skill      | Recommended Libraries                                        | Notes                        |
| ---------- | ------------------------------------------------------------ | ---------------------------- |
| `/layout`  | CSS Grid, Flexbox (native)                                   | Use with Tailwind or vanilla |
| `/distill` | —                                                            | Analysis skill, no library   |
| `/impeccable extract` | [Style Dictionary](https://amzn.github.io/style-dictionary/) | Token extraction pipeline    |

#### Visual

| Skill       | Recommended Libraries                                                                          | Notes                                   |
| ----------- | ---------------------------------------------------------------------------------------------- | --------------------------------------- |
| `/typeset`  | [Fontsource](https://fontsource.org/), [@capsizecss/core](https://seek-oss.github.io/capsize/) | Font loading, optical sizing            |
| `/colorize` | [Culori](https://culorijs.org/), [Chroma.js](https://gka.github.io/chroma.js/)                 | Color manipulation, OKLCH               |
| `/bolder`   | —                                                                                              | Direction skill, apply to existing code |
| `/quieter`  | —                                                                                              | Direction skill, apply to existing code |

#### Experiential

| Skill      | Recommended Libraries                                                                                                        | Notes                            |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| `/animate` | [Motion](https://motion.dev/) (React), [GSAP](https://gsap.com/), [anime.js](https://animejs.com/)                           | React: Motion; Vanilla: anime.js |
| `/clarify` | —                                                                                                                            | Content skill, no library        |
| `/delight` | [Lottie](https://airbnb.io/lottie/), [Rive](https://rive.app/), [canvas-confetti](https://github.com/catdad/canvas-confetti) | Micro-animations, celebrations   |
| `/harden`  | [Shepherd.js](https://shepherdjs.dev/), [Driver.js](https://driverjs.com/)                                                   | Tours, onboarding (v2.1 absorbed v1 `/onboard`) |

#### Resilience

| Skill       | Recommended Libraries                                                                                                    | Notes                   |
| ----------- | ------------------------------------------------------------------------------------------------------------------------ | ----------------------- |
| `/optimize` | [Lighthouse CI](https://github.com/GoogleChrome/lighthouse-ci), [web-vitals](https://github.com/GoogleChrome/web-vitals) | Performance measurement |
| `/harden`   | [Zod](https://zod.dev/), [Valibot](https://valibot.dev/)                                                                 | Input validation        |

#### Production

| Skill        | Recommended Libraries                                                                                                                                           | Notes                        |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| `/adapt`     | Container queries (native), Tailwind                                                                                                                            | Responsive adaptation        |
| `/polish`    | —                                                                                                                                                               | Final pass skill, no library |
| `/overdrive` | [View Transitions API](https://developer.chrome.com/docs/web-platform/view-transitions/), [GSAP ScrollTrigger](https://gsap.com/docs/v3/Plugins/ScrollTrigger/) | Advanced effects             |

### Component Library Recommendations

| Project Type                  | Primary Library                     | Alternatives                |
| ----------------------------- | ----------------------------------- | --------------------------- |
| **React (general)**           | [shadcn/ui](https://ui.shadcn.com/) | Radix + Tailwind, Chakra UI |
| **React (enterprise)**        | [Ant Design](https://ant.design/)   | MUI, Mantine                |
| **Vue / Nuxt**                | [Nuxt UI](https://ui.nuxt.com/)     | PrimeVue, Naive UI          |
| **Vanilla / Multi-framework** | [Shoelace](https://shoelace.style/) | Open Props + CSS, Pico CSS  |

### Library Selection Criteria

When recommending libraries, prioritize:

1. **License**: Prefer MIT/Apache; flag GPL for commercial projects
2. **Bundle size**: Recommend tree-shakeable options; check bundlephobia
3. **Maintenance**: Check last commit date, issue response time
4. **Accessibility**: Prioritize libraries with built-in a11y (Radix, Chakra)
5. **Design system compatibility**: Match to detected tech stack

### Quick Reference by Tech Stack

| Detected Stack        | Component Style        | Animation      | Styling                  |
| --------------------- | ---------------------- | -------------- | ------------------------ |
| **Nuxt UI**           | `<UButton>`, `<UCard>` | Motion         | Tailwind + app.config.ts |
| **React + Tailwind**  | shadcn/ui or Radix     | Motion         | Tailwind CSS             |
| **React + CSS-in-JS** | Chakra UI              | Motion         | Emotion/Styled           |
| **Vue + Tailwind**    | Nuxt UI or Headless UI | @vueuse/motion | Tailwind CSS             |
| **Vanilla**           | Shoelace               | anime.js       | CSS variables            |
