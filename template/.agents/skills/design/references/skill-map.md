# Design Skill Map

Complete catalog of available design skills with routing guidance.

> **v3 呼叫形式**：本表全部用 v3 原生形式 `/impeccable <subcommand>`（例：`/impeccable colorize`、`/impeccable polish`），對齊 v3 作者「impeccable 是一個 skill、底下用 sub-command 組織」的設計理念。pin alias 機制（`/colorize` 等獨立 slash command）為 escape hatch，clade design 不依賴。

## Issue → Skill Mapping

Use this table during diagnostic scans to map problems to the right skill.

| Observed Problem                         | Skill               | Notes                                   |
| ---------------------------------------- | ------------------- | --------------------------------------- |
| No design context / brand unclear        | `/impeccable teach`   | Run once per project；建立 PRODUCT.md（必要）+ DESIGN.md（建議） |
| No DESIGN.md but code already exists     | `/impeccable document` | 從現有 code 反推 DESIGN.md，省去從零問起 |
| No design system (colors, fonts, tokens) | `/impeccable teach`   | Gather context and define design system    |
| Need requirements clarified before code  | `/impeccable shape`   | Shape phase before craft；強制使用者明確確認 brief 才能進 craft |
| Build a new feature / page               | `/impeccable craft`   | Main build flow                             |
| Deviates from design system              | `/impeccable polish`             | Aligns to design system, fixes drift       |
| Too many elements, overwhelming          | `/impeccable distill`            | Simplify before enhancing                  |
| Repeated patterns not extracted          | `/impeccable extract` | Pull into design system                    |
| Poor spacing, weak layout, bad grouping  | `/impeccable layout`             | Layout, spacing, visual rhythm             |
| Generic fonts, no type hierarchy         | `/impeccable typeset`            | Font choice, scale, weight                 |
| Monochromatic, all gray                  | `/impeccable colorize`           | Strategic color addition                   |
| Too safe, boring, generic                | `/impeccable bolder`             | Amplify visual impact                      |
| Too intense, aggressive, noisy           | `/impeccable quieter`            | Tone down, add sophistication              |
| No transitions, jarring state changes    | `/impeccable animate`            | Purposeful motion                          |
| Unclear labels, jargon, bad errors       | `/impeccable clarify`            | UX copy improvement                        |
| Functional but lifeless                  | `/impeccable delight`            | Joy, personality, surprise                 |
| Poor first-time experience               | `/impeccable onboard`            | First-run flows、empty states、activation |
| No error/loading/empty states            | `/impeccable harden`             | Edge cases, i18n, resilience              |
| Slow load, janky scroll, heavy bundle    | `/impeccable optimize`           | Performance improvement                    |
| Doesn't work on mobile/tablet            | `/impeccable adapt`              | Cross-device adaptation                    |
| Needs pixel-perfect final pass           | `/impeccable polish`             | Alignment, consistency, details            |
| Want "how did they do that?" moment      | `/impeccable overdrive`          | Technically ambitious；建議 brand register 才用 |
| 想視覺迭代但難以言述風格               | `/impeccable live`               | 在 dev server 瀏覽器即時挑元素生成變體     |

## Skill Categories

### Foundational (run first)

- **`/impeccable teach`** — Establishes persistent design context. 產出 **PRODUCT.md**（必要：使用者、品牌、語氣、anti-references、strategic principles、register）+ **DESIGN.md**（建議：色彩、字體、層次、元件）。Run once per project. All other design sub-commands read these files.
- **`/impeccable document`** — 從既有 code 反推 DESIGN.md。已經有 code 的專案用此入門比 `teach` 從零問更省力。
- **`/impeccable shape`** — Requirements gathering before code generation. 強制 user 明確確認 brief 才能進 craft，self-authored brief 不算。
- **`/impeccable craft`** — Main build flow. Produces distinctive, production-grade frontend code. 強制 mock fidelity inventory（如有），把缺 hero objects/imagery 列為 blocking defects。
- **`/nuxt-ui`** — Nuxt UI v4 component library reference (125+ components). Use when project has `@nuxt/ui`. Provides component APIs, theming via `app.config.ts`, and Tailwind Variants integration.

### Diagnostic / Iteration (assess or explore without committing)

- **`/impeccable audit`** — Systematic scan: accessibility, performance, theming, responsive. Outputs severity-rated report. Best for: comprehensive quality assessment.
- **`/impeccable critique`** — Holistic design evaluation: visual hierarchy, information architecture, emotional resonance. Includes AI slop detection. Best for: design direction assessment.
- **`/impeccable live`** — 在 dev server 瀏覽器中互動式挑元素並生成多個視覺變體。wrap → preview → accept → carbonize loop，最後寫回原始碼。Vite/Next React/TSX、Nuxt、純 HTML 都支援。

### Structural (reshape)

- **`/impeccable layout`** — Layout, spacing, visual rhythm, hierarchy. Fixes monotonous grids and weak grouping.
- **`/impeccable distill`** — Removes unnecessary complexity. 80/20 analysis, progressive disclosure.
- **`/impeccable extract`** — Identifies and consolidates reusable components and design tokens.
- **`/impeccable polish`** — Aligns feature with existing design system, fixes drift + final pass.

### Visual (refine aesthetics)

- **`/impeccable typeset`** — Font selection, hierarchy, scale, weight consistency, readability.
- **`/impeccable colorize`** — Adds strategic color: semantic meaning, hierarchy, categorization.
- **`/impeccable bolder`** — Amplifies safe designs: extreme scale, bold palette, distinctive fonts.
- **`/impeccable quieter`** — Tones down intensity: reduces saturation, simplifies, adds sophistication.

### Experiential (enhance feel)

- **`/impeccable animate`** — Motion: entrance sequences, micro-interactions, state transitions. Includes performance guidance (60fps, GPU, reduced-motion).
- **`/impeccable clarify`** — UX copy: error messages, form labels, CTAs, help text, empty states.
- **`/impeccable delight`** — Personality: micro-interactions with joy, playful copy, easter eggs, celebrations.

### Resilience (strengthen)

- **`/impeccable harden`** — Edge cases, text overflow, i18n, error handling, input validation, a11y resilience.
- **`/impeccable onboard`** — First-run flows, welcome screens, empty states, activation hints, progressive disclosure, tooltips。
- **`/impeccable optimize`** — Performance: Core Web Vitals, bundle size, rendering, animations.
- **`/impeccable audit`** — Diagnostic verification: accessibility, performance, theming, responsive. Run before `/impeccable polish` to catch Critical issues.

### Production (ship)

- **`/impeccable polish`** — Final pass: alignment, spacing tokens, typography details, interaction states, micro-interactions, content, icons, forms, edge cases, responsive, performance, code quality. 16-dimension checklist.
- **`/impeccable adapt`** — Cross-platform: mobile, tablet, desktop, print. Touch targets, navigation patterns, responsive layouts.
- **`/impeccable overdrive`** — Technically ambitious: View Transitions, scroll-driven animations, WebGL, spring physics. MUST propose 2-3 directions first.

## Mutual Exclusivity

Some skills are alternatives, not complements:

- `/impeccable bolder` vs `/impeccable quieter` — opposite directions. Pick one based on whether design is too safe or too aggressive.
- `/impeccable distill` before `/impeccable bolder` — simplify complexity, THEN amplify if needed. Never both on the same target simultaneously.
- `/impeccable colorize` vs `/impeccable quieter` — if the goal is to tone down, don't also add color. Choose the dominant direction.

## Common Workflows

### Quick Fix (1-2 issues)

```
/impeccable audit or /impeccable critique → identify the 1-2 biggest issues → targeted skill → /impeccable polish
```

### Visual Refresh

```
/impeccable critique → /impeccable layout → /impeccable typeset → /impeccable colorize → /impeccable animate → /impeccable polish
```

### Production Hardening

```
/impeccable audit → /impeccable harden → /impeccable optimize → /impeccable adapt → /impeccable polish
```

### Design System Bootstrap

```
/impeccable teach → /impeccable polish → /impeccable extract
```

### Visual Iteration on Existing Code

```
/impeccable document（如缺 DESIGN.md） → /impeccable live（瀏覽器即時挑元素 → 生成變體 → accept）→ /impeccable polish
```

### Nuxt UI Project (auto-detected)

```
/impeccable teach → /nuxt-ui (component reference) → build with <UComponent> markup → /impeccable polish
```

---

## Open Source Library Recommendations

When recommending skills, also suggest compatible open-source libraries for faster implementation.

### By Skill Category

#### Foundational

| Skill               | Recommended Libraries                                                                                 | Notes                                       |
| ------------------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| `/impeccable teach` | —                                                                                                     | Outputs `PRODUCT.md` + `DESIGN.md`，no library needed |
| `/impeccable polish`           | [Style Dictionary](https://amzn.github.io/style-dictionary/), [Tokens Studio](https://tokens.studio/) | Token management & sync                            |

#### Structural

| Skill      | Recommended Libraries                                        | Notes                        |
| ---------- | ------------------------------------------------------------ | ---------------------------- |
| `/impeccable layout`  | CSS Grid, Flexbox (native)                                   | Use with Tailwind or vanilla |
| `/impeccable distill` | —                                                            | Analysis skill, no library   |
| `/impeccable extract` | [Style Dictionary](https://amzn.github.io/style-dictionary/) | Token extraction pipeline    |

#### Visual

| Skill       | Recommended Libraries                                                                          | Notes                                   |
| ----------- | ---------------------------------------------------------------------------------------------- | --------------------------------------- |
| `/impeccable typeset`  | [Fontsource](https://fontsource.org/), [@capsizecss/core](https://seek-oss.github.io/capsize/) | Font loading, optical sizing            |
| `/impeccable colorize` | [Culori](https://culorijs.org/), [Chroma.js](https://gka.github.io/chroma.js/)                 | Color manipulation, OKLCH               |
| `/impeccable bolder`   | —                                                                                              | Direction skill, apply to existing code |
| `/impeccable quieter`  | —                                                                                              | Direction skill, apply to existing code |

#### Experiential

| Skill      | Recommended Libraries                                                                                                        | Notes                            |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| `/impeccable animate` | [Motion](https://motion.dev/) (React), [GSAP](https://gsap.com/), [anime.js](https://animejs.com/)                           | React: Motion; Vanilla: anime.js |
| `/impeccable clarify` | —                                                                                                                            | Content skill, no library        |
| `/impeccable delight` | [Lottie](https://airbnb.io/lottie/), [Rive](https://rive.app/), [canvas-confetti](https://github.com/catdad/canvas-confetti) | Micro-animations, celebrations   |
| `/impeccable onboard` | [Shepherd.js](https://shepherdjs.dev/), [Driver.js](https://driverjs.com/)                                                   | Tours, onboarding |

#### Resilience

| Skill       | Recommended Libraries                                                                                                    | Notes                   |
| ----------- | ------------------------------------------------------------------------------------------------------------------------ | ----------------------- |
| `/impeccable optimize` | [Lighthouse CI](https://github.com/GoogleChrome/lighthouse-ci), [web-vitals](https://github.com/GoogleChrome/web-vitals) | Performance measurement |
| `/impeccable harden`   | [Zod](https://zod.dev/), [Valibot](https://valibot.dev/)                                                                 | Input validation        |

#### Production

| Skill        | Recommended Libraries                                                                                                                                           | Notes                        |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| `/impeccable adapt`     | Container queries (native), Tailwind                                                                                                                            | Responsive adaptation        |
| `/impeccable polish`    | —                                                                                                                                                               | Final pass skill, no library |
| `/impeccable overdrive` | [View Transitions API](https://developer.chrome.com/docs/web-platform/view-transitions/), [GSAP ScrollTrigger](https://gsap.com/docs/v3/Plugins/ScrollTrigger/) | Advanced effects             |

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
