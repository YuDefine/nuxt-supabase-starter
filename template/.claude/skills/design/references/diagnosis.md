# Diagnostic Scan Rubric

Use this rubric when assessing UI code in `improve` and `iterate` modes. Read the actual source code before scoring.

## Scan Dimensions

### 1. Visual Quality

**What to check:**

- Color usage: Is it monochromatic/all gray? Are colors meaningful or decorative?
- Typography: System fonts only? No hierarchy? Inconsistent sizing/weight?
- Visual hierarchy: Can you identify primary action in 2 seconds? Does eye flow make sense?
- Spacing: Consistent rhythm? Or random pixel values everywhere?
- Polish: Pixel-aligned? Consistent border-radius? Consistent shadow system?

**Signals of problems:**

- All text is same size/weight
- No color beyond gray/black/white
- Spacing values are arbitrary (13px, 17px, 22px instead of a scale)
- Mix of border-radius values with no pattern
- Hard-coded colors instead of tokens/variables

**Maps to:** `/typeset`, `/colorize`, `/bolder`, `/quieter`, `/arrange`

---

### 2. Interaction Quality

**What to check:**

- Hover states: Do interactive elements respond to hover?
- Focus states: Visible focus indicators for keyboard navigation?
- Active/pressed states: Feedback when clicking?
- Disabled states: Clear visual distinction?
- Loading states: Feedback during async operations?
- Error states: Clear, helpful error presentation?
- Transitions: Smooth state changes or jarring jumps?

**Signals of problems:**

- No `:hover` styles on buttons/links
- No `transition` properties on interactive elements
- cursor: pointer missing on clickable non-button elements
- States handled with display:none/block (no animation)
- Loading just shows a spinner with no context

**Maps to:** `/animate`, `/harden`, `/clarify`

---

### 3. Structural Quality

**What to check:**

- Layout system: CSS Grid/Flexbox used intentionally? Or position:absolute chaos?
- Grouping: Related items visually grouped? Sections clearly separated?
- Information density: Too sparse? Too cluttered?
- Content hierarchy: Most important content prominent?
- Responsive structure: Flex/grid that adapts? Or fixed widths?

**Signals of problems:**

- Deeply nested divs with manual positioning
- Equal visual weight on all elements (flat hierarchy)
- Identical card grid with no variation
- Fixed pixel widths that break on different screens
- No visual separation between distinct content sections

**Maps to:** `/arrange`, `/distill`, `/adapt`

---

### 4. Copy & Messaging

**What to check:**

- Button labels: Descriptive or generic ("Submit", "Click here")?
- Error messages: Helpful or cryptic ("Error occurred")?
- Empty states: Guided or blank?
- Help text: Present where needed? Concise?
- Tone: Consistent with product personality?

**Signals of problems:**

- Generic labels ("OK", "Cancel", "Submit")
- Technical error messages shown to users
- Empty containers with no guidance
- Missing placeholder/help text on form fields
- Inconsistent tone (formal in one place, casual in another)

**Maps to:** `/clarify`, `/onboard`, `/delight`

---

### 5. Resilience

**What to check:**

- Error handling: What happens when API calls fail?
- Loading states: Skeleton screens? Spinners? Nothing?
- Empty states: First-time experience when no data exists?
- Edge cases: Very long text? Very short text? Zero items? 1000 items?
- Validation: Client-side validation before server round-trip?
- Offline: Any graceful degradation?

**Signals of problems:**

- try/catch blocks that swallow errors silently
- No loading indicators during data fetches
- Blank screens when data is empty
- Text overflow: hidden without ellipsis or wrapping strategy
- No input validation (rely entirely on server)

**Maps to:** `/harden`, `/clarify`, `/onboard`

---

### 6. Performance

**What to check:**

- Images: Optimized? Lazy loaded? Correct format (WebP/AVIF)?
- Bundle: Code-split? Dynamic imports for heavy components?
- Rendering: Unnecessary re-renders? Layout thrashing?
- Animations: GPU-accelerated (transform/opacity)? Or animating width/height/top/left?
- Fonts: Subset? Font-display: swap? Preloaded?

**Signals of problems:**

- Large PNG/JPG images without optimization
- Single bundle with everything imported at top level
- useEffect with missing/wrong dependency arrays
- CSS animations on `width`, `height`, `margin`, `padding`
- Multiple font files loaded synchronously

**Maps to:** `/optimize`

---

### 7. Accessibility

**What to check:**

- Color contrast: 4.5:1 for normal text, 3:1 for large text (WCAG AA)
- Semantic HTML: Proper heading hierarchy? Button vs div?
- ARIA: Labels on icon buttons? Roles on custom components?
- Keyboard: All functionality reachable? Tab order logical?
- Screen reader: Alt text? Live regions for dynamic content?
- Motion: `prefers-reduced-motion` respected?

**Signals of problems:**

- Light gray text on white background
- `<div onClick>` instead of `<button>`
- Icon-only buttons without aria-label
- Custom dropdowns/modals with no keyboard support
- Images without alt attributes
- Animations without reduced-motion media query

**Maps to:** `/harden`, `/adapt`

---

### 8. Design System Consistency

**What to check:**

- Token usage: Colors from variables/tokens or hard-coded hex?
- Component reuse: Using shared components or one-off implementations?
- Pattern consistency: Same interaction pattern for same action across app?
- Naming: Consistent CSS class/variable naming conventions?
- Spacing scale: Using defined scale or arbitrary values?

**Signals of problems:**

- Hard-coded color values (#3b82f6) instead of var(--primary)
- Similar but slightly different button implementations
- Modal close behavior differs across the app
- Mix of naming conventions (camelCase + kebab-case + BEM)
- No shared spacing scale (random margin/padding values)

**Maps to:** `/normalize`, `/extract`

---

## Severity Classification

| Severity     | Definition                                                                       | Action                                    |
| ------------ | -------------------------------------------------------------------------------- | ----------------------------------------- |
| **Critical** | Prevents use for some users (a11y violations, broken states, unusable on mobile) | Must fix. Recommend immediately.          |
| **High**     | Significantly hurts UX (no feedback, confusing flow, poor hierarchy)             | Should fix. High-priority recommendation. |
| **Medium**   | Noticeable quality gap (generic type, missing animations, inconsistent spacing)  | Recommend if time allows.                 |
| **Low**      | Refinement opportunity (could be more delightful, slightly better copy)          | Mention as nice-to-have.                  |

## Quick Assessment Template

After scanning, summarize:

```
Visual:       [★☆☆☆☆ to ★★★★★] — [one-line finding]
Interaction:  [★☆☆☆☆ to ★★★★★] — [one-line finding]
Structure:    [★☆☆☆☆ to ★★★★★] — [one-line finding]
Copy:         [★☆☆☆☆ to ★★★★★] — [one-line finding]
Resilience:   [★☆☆☆☆ to ★★★★★] — [one-line finding]
Performance:  [★☆☆☆☆ to ★★★★★] — [one-line finding]
Accessibility:[★☆☆☆☆ to ★★★★★] — [one-line finding]
Consistency:  [★☆☆☆☆ to ★★★★★] — [one-line finding]
```

Focus recommendations on dimensions scoring ★★★ or below.
