## ADDED Requirements

### Requirement: AppPageShell component

The system SHALL provide an `AppPageShell` component that wraps page content with a consistent structure: optional breadcrumb, title, description, and named slots for actions, stats, subnav, toolbar, and default content.

#### Scenario: Render page with title and actions

- **WHEN** `AppPageShell` is rendered with `title="Users"` and content in the `actions` slot
- **THEN** the component displays the title as an h1 heading
- **AND** the actions slot content appears aligned to the right of the title
- **AND** the default slot content appears below the header

#### Scenario: Render page with breadcrumb

- **WHEN** `AppPageShell` is rendered with a `breadcrumb` array of `BreadcrumbItem[]`
- **THEN** a `UBreadcrumb` component renders above the title
- **AND** the breadcrumb is hidden on small screens (below `sm` breakpoint)

#### Scenario: Render page with all slots

- **WHEN** `AppPageShell` is rendered with content in stats, subnav, and toolbar slots
- **THEN** each slot renders in order: breadcrumb → header (title + actions) → stats → subnav → toolbar → default content
- **AND** empty slots do not render their wrapper elements

### Requirement: AppEmptyState component

The system SHALL provide an `AppEmptyState` component that displays a centered empty-state placeholder with icon, message, optional description, and optional action button.

#### Scenario: Render empty state with message

- **WHEN** `AppEmptyState` is rendered with `message="No items found"`
- **THEN** the component displays a circular icon container with the default inbox icon
- **AND** the message text appears below the icon

#### Scenario: Render empty state with action button

- **WHEN** `AppEmptyState` is rendered with `actionLabel="Create"` and `actionTo="/create"`
- **THEN** a `UButton` renders below the message with the label "Create"
- **AND** clicking the button navigates to `/create`

#### Scenario: Render empty state with custom icon

- **WHEN** `AppEmptyState` is rendered with `icon="i-lucide-search"`
- **THEN** the custom icon replaces the default inbox icon

#### Scenario: Action button emits event

- **WHEN** `AppEmptyState` is rendered with `actionLabel="Add"` and no `actionTo`
- **THEN** clicking the action button emits an `action` event
- **AND** no navigation occurs

### Requirement: AppFormLayout component

The system SHALL provide an `AppFormLayout` component that wraps form fields in a responsive two-column grid with optional header, sections, aside panel, and sticky action buttons.

#### Scenario: Render simple form

- **WHEN** `AppFormLayout` is rendered with default slot content
- **THEN** the form fields appear in a two-column grid (single column on mobile)
- **AND** submit and cancel buttons appear at the bottom

#### Scenario: Render sectioned form

- **WHEN** `AppFormLayout` is rendered with a `sections` array
- **THEN** each section renders with its title and optional description
- **AND** sections are separated by a border
- **AND** each section has a named slot (`section-0`, `section-1`, etc.) for its fields

#### Scenario: Form submission

- **WHEN** the user clicks the submit button
- **THEN** the component emits a `submit` event
- **AND** the form does not perform a native form submission (preventDefault)

#### Scenario: Loading state

- **WHEN** `AppFormLayout` is rendered with `loading=true`
- **THEN** the submit button shows a loading spinner
- **AND** the cancel button is disabled
