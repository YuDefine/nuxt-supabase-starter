# Design Systems Industry Reference

Industry-categorized design system index for contextual recommendations during `/design` workflow.

## How to Use This Reference

- **`/design new`**: Recommend systems from matching industry as inspiration
- **`/design improve`**: Reference mature systems as benchmarks
- **`/design iterate`**: Track toward industry-standard maturity levels

---

## By Industry

### Technology (51 systems)

**Tier 1 — Industry Leaders** (V&T + Open Source + Comprehensive)

| System | Company | V&T | OSS | Key Strength |
|--------|---------|:---:|:---:|--------------|
| [Material Design](https://m3.material.io/) | Google | Yes | Yes | Component completeness, motion system |
| [Fluent UI](https://fluent2.microsoft.design/) | Microsoft | Yes | Yes | Cross-platform, enterprise scale |
| [Carbon](https://carbondesignsystem.com/) | IBM | Yes | Yes | Enterprise patterns, accessibility |
| [Primer](https://primer.style/) | GitHub | Yes | Yes | Developer-focused, clean |
| [Spectrum](https://spectrum.adobe.com/) | Adobe | Yes | Yes | Creative tooling, detailed docs |
| [Polaris](https://polaris.shopify.com/) | Shopify | Yes | Yes | Merchant tools, content guidelines |

**Tier 2 — Specialized Excellence**

| System | Company | V&T | OSS | Best For |
|--------|---------|:---:|:---:|----------|
| [Lightning](https://www.lightningdesignsystem.com/) | Salesforce | Yes | Yes | CRM, data-heavy apps |
| [Atlassian Design](https://atlassian.design/) | Atlassian | Yes | Yes | Collaboration tools |
| [Base Web](https://baseweb.design/) | Uber | No | Yes | Data dashboards |
| [Ant Design](https://ant.design/) | Alibaba | Yes | Yes | Enterprise React |
| [Chakra UI](https://chakra-ui.com/) | Community | No | Yes | Accessible React |

---

### Finance & Banking (15 systems)

**Characteristics**: Conservative, trust-building, data-dense, security-conscious

| System | Company | V&T | OSS | Key Pattern |
|--------|---------|:---:|:---:|-------------|
| [Fish Tank](https://fishtank.bna.com/) | Bloomberg | Yes | Yes | Financial data viz |
| [Finastra](https://design.fusionfabric.cloud/) | Finastra | No | Yes | Banking UI |
| [Morningstar](https://designsystem.morningstar.com/) | Morningstar | Yes | No | Investment data |
| N26 Design | N26 | Yes | No | Modern fintech |

**Design Principles for Finance**:
- High contrast for readability
- Clear data hierarchy
- Trust indicators (locks, shields)
- Conservative color palette (blues, greens)

---

### Government & Public Sector (13 systems)

**Characteristics**: Accessibility-first, plain language, high contrast, WCAG AAA

| System | Country | V&T | OSS | WCAG Level |
|--------|---------|:---:|:---:|------------|
| [USWDS](https://designsystem.digital.gov/) | USA | Yes | Yes | AAA |
| [GOV.UK](https://design-system.service.gov.uk/) | UK | Yes | Yes | AAA |
| [Canada.ca Aurora](https://design.canada.ca/) | Canada | Yes | Yes | AAA |
| [DSFR](https://www.systeme-de-design.gouv.fr/) | France | Yes | Yes | AAA |
| [SGDS](https://www.designsystem.tech.gov.sg/) | Singapore | Yes | Yes | AA |

**Design Principles for Government**:
- Plain language mandatory
- Maximum accessibility
- No decorative elements
- Clear call-to-action hierarchy

---

### E-Commerce & Retail (12 systems)

**Characteristics**: Conversion-focused, product presentation, trust signals, urgency

| System | Company | V&T | OSS | Key Pattern |
|--------|---------|:---:|:---:|-------------|
| [Polaris](https://polaris.shopify.com/) | Shopify | Yes | Yes | Merchant admin |
| [Backpack](https://backpack.github.io/) | Skyscanner | Yes | Yes | Travel booking |
| [Orbit](https://orbit.kiwi/) | Kiwi.com | No | Yes | Travel UI |
| [PIE](https://pie.design/) | Just Eat | No | Yes | Food ordering |

**Design Principles for E-Commerce**:
- Clear pricing hierarchy
- Trust badges prominent
- Urgency without anxiety
- Easy comparison layouts

---

### SaaS & Developer Tools (22 systems)

**Characteristics**: Onboarding flows, empty states, upgrade paths, keyboard shortcuts

| System | Company | V&T | OSS | Key Pattern |
|--------|---------|:---:|:---:|-------------|
| [Paste](https://paste.twilio.design/) | Twilio | Yes | Yes | API-focused |
| [Evergreen](https://evergreen.segment.com/) | Segment | Yes | Yes | Clean SaaS |
| [Ring UI](https://jetbrains.github.io/ring-ui/) | JetBrains | No | Yes | Developer IDE |
| [Canvas](https://canvas.workday.com/) | Workday | Yes | Yes | HR software |
| [Forma 36](https://f36.contentful.com/) | Contentful | Yes | Yes | CMS tools |

**Design Principles for SaaS**:
- Progressive disclosure
- Contextual help
- Keyboard-first navigation
- Clear upgrade paths

---

### Media & Entertainment (10 systems)

| System | Company | V&T | OSS | Key Pattern |
|--------|---------|:---:|:---:|-------------|
| [Stacks](https://stackoverflow.design/) | Stack Overflow | Yes | Yes | Q&A, community |
| [Solid](https://solid.buzzfeed.com/) | BuzzFeed | No | Yes | Content cards |
| [Origami](https://origami.ft.com/) | Financial Times | No | Yes | Publishing |

---

### Automotive & Manufacturing (7 systems)

| System | Company | V&T | OSS | Key Pattern |
|--------|---------|:---:|:---:|-------------|
| [Porsche DS](https://designsystem.porsche.com/) | Porsche | No | Yes | Luxury automotive |
| [Siemens iX](https://ix.siemens.io/) | Siemens | Yes | Yes | Industrial IoT |
| [Scania SDDS](https://digitaldesign.scania.com/) | Scania | No | Yes | Fleet management |

---

## Voice & Tone Leaders

These systems have **comprehensive V&T documentation** — reference for `/clarify` and `/teach-impeccable`:

### Tier 1: Dedicated V&T Guides

| System | V&T Resource | Key Insight |
|--------|--------------|-------------|
| [Shopify Polaris](https://polaris.shopify.com/content/voice-and-tone) | Full content guidelines | "Merchant-first, encouraging" |
| [Mailchimp](https://styleguide.mailchimp.com/) | The original V&T guide | "Fun but not silly" |
| [IBM Carbon](https://carbondesignsystem.com/guidelines/content/overview/) | Writing style guide | "Clear, concise, human" |
| [Atlassian](https://atlassian.design/content) | Brand voice handbook | "Bold, optimistic, practical" |

### Tier 2: Integrated V&T

| System | Approach |
|--------|----------|
| Material Design | Contextual writing in component docs |
| Microsoft Fluent | Inclusive writing guidelines embedded |
| GOV.UK | Plain language patterns throughout |

---

## Open Source Quick Reference

### Production-Ready (MIT/Apache) — Use Directly

| Library | Framework | Stars | Best For |
|---------|-----------|-------|----------|
| [shadcn/ui](https://ui.shadcn.com/) | React | 50k+ | Customizable, copy-paste |
| [Radix](https://radix-ui.com/) | React | 12k+ | Headless, accessible |
| [Chakra UI](https://chakra-ui.com/) | React | 35k+ | Styled, themeable |
| [Mantine](https://mantine.dev/) | React | 22k+ | Feature-rich |
| [Ant Design](https://ant.design/) | React | 88k+ | Enterprise |
| [Nuxt UI](https://ui.nuxt.com/) | Vue/Nuxt | 3k+ | Nuxt-native |
| [Shoelace](https://shoelace.style/) | Web Components | 10k+ | Framework-agnostic |

### Reference-Only (Study, Don't Copy)

| System | Why Reference |
|--------|---------------|
| Apple HIG | Motion principles, platform conventions |
| Spotify Encore | Music/media patterns |
| Airbnb | Trust-building patterns |

---

## Maturity Benchmark by Company Stage

| Stage | Target Level | Reference Systems |
|-------|--------------|-------------------|
| **MVP/Startup** | Level 1-2 | Use Chakra/shadcn as foundation |
| **Growth** | Level 2-3 | Reference Polaris, Evergreen for patterns |
| **Enterprise** | Level 3-4 | Reference Carbon, Spectrum for governance |
| **Platform** | Level 4-5 | Reference Material, Fluent for ecosystem |

---

## Quick Lookup by Need

| I need... | Recommended Reference |
|-----------|----------------------|
| Enterprise dashboard patterns | IBM Carbon, Salesforce Lightning |
| E-commerce checkout flow | Shopify Polaris |
| Developer documentation UI | GitHub Primer, Stripe |
| Government accessibility | USWDS, GOV.UK |
| Mobile-first consumer app | Material Design |
| Data visualization | Ant Design, Base Web |
| Content-heavy publishing | Financial Times Origami |
| Voice & Tone guidelines | Shopify Polaris, Mailchimp |
