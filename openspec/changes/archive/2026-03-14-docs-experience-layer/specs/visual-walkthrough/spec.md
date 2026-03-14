## ADDED Requirements

### Requirement: In-app walkthrough page

The project SHALL provide an `app/pages/walkthrough.vue` page that visually guides newcomers through the app's key features.

#### Scenario: Walkthrough page content

- **WHEN** a user navigates to `/walkthrough`
- **THEN** the page SHALL display step-by-step cards showing:
  1. Home page and navigation
  2. Authentication flow (login/register)
  3. Creating and viewing data (CRUD)
  4. Profile management
  5. Admin features
- **AND** each step SHALL include a title, description, and link to the actual page

#### Scenario: Walkthrough uses live components

- **WHEN** the walkthrough page is rendered
- **THEN** it SHALL use actual Nuxt UI components (UCard, UButton, UBadge)
- **AND** it SHALL NOT use static screenshots

### Requirement: Visual guide document

The project SHALL provide a `docs/VISUAL_GUIDE.md` document that explains the walkthrough page and the app's user journey.

#### Scenario: Document links to walkthrough

- **WHEN** a newcomer reads `docs/VISUAL_GUIDE.md`
- **THEN** it SHALL explain the app's user journey
- **AND** link to `/walkthrough` as the live demo
- **AND** link to `FIRST_CRUD.md` as the hands-on next step
