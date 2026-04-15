# Design Skill Map

Complete catalog of available design skills with routing guidance.

## Issue → Skill Mapping

Use this table during diagnostic scans to map problems to the right skill.

| Observed Problem | Skill | Notes |
|---|---|---|
| No design context / brand unclear | `/teach-impeccable` | Run once per project |
| No design system (colors, fonts, tokens) | `/teach-impeccable` | Gather context and define design system |
| Deviates from design system | `/normalize` | Align back to system |
| Too many elements, overwhelming | `/distill` | Simplify before enhancing |
| Repeated patterns not extracted | `/extract` | Pull into design system |
| Poor spacing, weak layout, bad grouping | `/arrange` | Structure & visual rhythm |
| Generic fonts, no type hierarchy | `/typeset` | Font choice, scale, weight |
| Monochromatic, all gray | `/colorize` | Strategic color addition |
| Too safe, boring, generic | `/bolder` | Amplify visual impact |
| Too intense, aggressive, noisy | `/quieter` | Tone down, add sophistication |
| No transitions, jarring state changes | `/animate` | Purposeful motion |
| Unclear labels, jargon, bad errors | `/clarify` | UX copy improvement |
| Functional but lifeless | `/delight` | Joy, personality, surprise |
| Poor first-time experience | `/onboard` | Empty states, guided flows |
| No error/loading/empty states | `/harden` | Edge cases, i18n, resilience |
| Slow load, janky scroll, heavy bundle | `/optimize` | Performance improvement |
| Doesn't work on mobile/tablet | `/adapt` | Cross-device adaptation |
| Needs pixel-perfect final pass | `/polish` | Alignment, consistency, details |
| Want "how did they do that?" moment | `/overdrive` | Technically ambitious |

## Skill Categories

### Foundational (run first)
- **`/teach-impeccable`** — Establishes persistent design context (`.impeccable.md`). Run once per project. All other design skills read this file.
- **`frontend-design`** — Reference skill providing design principles, anti-patterns, and the "AI Slop Test". Auto-loaded by other skills. Not directly invoked.
- **`/nuxt-ui`** — Nuxt UI v4 component library reference (125+ components). Use when project has `@nuxt/ui`. Provides component APIs, theming via `app.config.ts`, and Tailwind Variants integration.

### Diagnostic (assess without changing)
- **`/audit`** — Systematic scan: accessibility, performance, theming, responsive. Outputs severity-rated report. Best for: comprehensive quality assessment.
- **`/critique`** — Holistic design evaluation: visual hierarchy, information architecture, emotional resonance. Includes AI slop detection. Best for: design direction assessment.

### Structural (reshape)
- **`/arrange`** — Layout, spacing, visual rhythm, hierarchy. Fixes monotonous grids and weak grouping.
- **`/distill`** — Removes unnecessary complexity. 80/20 analysis, progressive disclosure.
- **`/extract`** — Identifies and consolidates reusable components and design tokens.
- **`/normalize`** — Aligns feature with existing design system. Fixes drift and inconsistencies.

### Visual (refine aesthetics)
- **`/typeset`** — Font selection, hierarchy, scale, weight consistency, readability.
- **`/colorize`** — Adds strategic color: semantic meaning, hierarchy, categorization.
- **`/bolder`** — Amplifies safe designs: extreme scale, bold palette, distinctive fonts.
- **`/quieter`** — Tones down intensity: reduces saturation, simplifies, adds sophistication.

### Experiential (enhance feel)
- **`/animate`** — Motion: entrance sequences, micro-interactions, state transitions. Includes performance guidance (60fps, GPU, reduced-motion).
- **`/clarify`** — UX copy: error messages, form labels, CTAs, help text, empty states.
- **`/delight`** — Personality: micro-interactions with joy, playful copy, easter eggs, celebrations.
- **`/onboard`** — First-time UX: welcome flows, tooltips, empty states, progressive disclosure.

### Resilience (strengthen)
- **`/optimize`** — Performance: Core Web Vitals, bundle size, rendering, animations.
- **`/harden`** — Edge cases: text overflow, i18n, error handling, input validation, a11y resilience.

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
/critique → /arrange → /typeset → /colorize → /animate → /polish
```

### Production Hardening
```
/audit → /harden → /optimize → /adapt → /polish
```

### Design System Bootstrap
```
/teach-impeccable → /normalize → /extract
```

### Nuxt UI Project (auto-detected)
```
/teach-impeccable → /nuxt-ui (component reference) → build with <UComponent> markup → /normalize → /polish
```

---

## Open Source Library Recommendations

When recommending skills, also suggest compatible open-source libraries for faster implementation.

### By Skill Category

#### Foundational
| Skill | Recommended Libraries | Notes |
|-------|----------------------|-------|
| `/teach-impeccable` | — | Outputs `.impeccable.md`, no library needed |
| `/normalize` | [Style Dictionary](https://amzn.github.io/style-dictionary/), [Tokens Studio](https://tokens.studio/) | Token management & sync |

#### Structural
| Skill | Recommended Libraries | Notes |
|-------|----------------------|-------|
| `/arrange` | CSS Grid, Flexbox (native) | Use with Tailwind or vanilla |
| `/distill` | — | Analysis skill, no library |
| `/extract` | [Style Dictionary](https://amzn.github.io/style-dictionary/) | Token extraction pipeline |

#### Visual
| Skill | Recommended Libraries | Notes |
|-------|----------------------|-------|
| `/typeset` | [Fontsource](https://fontsource.org/), [@capsizecss/core](https://seek-oss.github.io/capsize/) | Font loading, optical sizing |
| `/colorize` | [Culori](https://culorijs.org/), [Chroma.js](https://gka.github.io/chroma.js/) | Color manipulation, OKLCH |
| `/bolder` | — | Direction skill, apply to existing code |
| `/quieter` | — | Direction skill, apply to existing code |

#### Experiential
| Skill | Recommended Libraries | Notes |
|-------|----------------------|-------|
| `/animate` | [Motion](https://motion.dev/) (React), [GSAP](https://gsap.com/), [anime.js](https://animejs.com/) | React: Motion; Vanilla: anime.js |
| `/clarify` | — | Content skill, no library |
| `/delight` | [Lottie](https://airbnb.io/lottie/), [Rive](https://rive.app/), [canvas-confetti](https://github.com/catdad/canvas-confetti) | Micro-animations, celebrations |
| `/onboard` | [Shepherd.js](https://shepherdjs.dev/), [Driver.js](https://driverjs.com/) | Tours, onboarding |

#### Resilience
| Skill | Recommended Libraries | Notes |
|-------|----------------------|-------|
| `/optimize` | [Lighthouse CI](https://github.com/GoogleChrome/lighthouse-ci), [web-vitals](https://github.com/GoogleChrome/web-vitals) | Performance measurement |
| `/harden` | [Zod](https://zod.dev/), [Valibot](https://valibot.dev/) | Input validation |

#### Production
| Skill | Recommended Libraries | Notes |
|-------|----------------------|-------|
| `/adapt` | Container queries (native), Tailwind | Responsive adaptation |
| `/polish` | — | Final pass skill, no library |
| `/overdrive` | [View Transitions API](https://developer.chrome.com/docs/web-platform/view-transitions/), [GSAP ScrollTrigger](https://gsap.com/docs/v3/Plugins/ScrollTrigger/) | Advanced effects |

### Component Library Recommendations

| Project Type | Primary Library | Alternatives |
|--------------|----------------|--------------|
| **React (general)** | [shadcn/ui](https://ui.shadcn.com/) | Radix + Tailwind, Chakra UI |
| **React (enterprise)** | [Ant Design](https://ant.design/) | MUI, Mantine |
| **Vue / Nuxt** | [Nuxt UI](https://ui.nuxt.com/) | PrimeVue, Naive UI |
| **Vanilla / Multi-framework** | [Shoelace](https://shoelace.style/) | Open Props + CSS, Pico CSS |

### Library Selection Criteria

When recommending libraries, prioritize:

1. **License**: Prefer MIT/Apache; flag GPL for commercial projects
2. **Bundle size**: Recommend tree-shakeable options; check bundlephobia
3. **Maintenance**: Check last commit date, issue response time
4. **Accessibility**: Prioritize libraries with built-in a11y (Radix, Chakra)
5. **Design system compatibility**: Match to detected tech stack

### Quick Reference by Tech Stack

| Detected Stack | Component Style | Animation | Styling |
|----------------|-----------------|-----------|---------|
| **Nuxt UI** | `<UButton>`, `<UCard>` | Motion | Tailwind + app.config.ts |
| **React + Tailwind** | shadcn/ui or Radix | Motion | Tailwind CSS |
| **React + CSS-in-JS** | Chakra UI | Motion | Emotion/Styled |
| **Vue + Tailwind** | Nuxt UI or Headless UI | @vueuse/motion | Tailwind CSS |
| **Vanilla** | Shoelace | anime.js | CSS variables |
