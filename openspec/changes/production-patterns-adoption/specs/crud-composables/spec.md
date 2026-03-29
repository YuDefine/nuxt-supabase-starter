## ADDED Requirements

### Requirement: useListQueryState composable

The system SHALL provide a `useListQueryState<T>` composable that manages list page state (filters, search, pagination, sorting) with automatic URL query parameter synchronization.

#### Scenario: Initialize from URL query params

- **WHEN** `useListQueryState` is called with filter defaults `{ status: '' }`
- **AND** the URL contains `?status=active&q=test&page=2`
- **THEN** `filters.status` equals `'active'`
- **AND** `search` equals `'test'`
- **AND** `page` equals `2`

#### Scenario: Initialize with defaults when no URL params

- **WHEN** `useListQueryState` is called with filter defaults `{ status: '' }`
- **AND** the URL has no query parameters
- **THEN** `filters.status` equals `''`
- **AND** `search` equals `''`
- **AND** `page` equals `1`

#### Scenario: URL updates on state change with debounce

- **WHEN** the user changes `search` to `'hello'`
- **THEN** after a 300ms debounce, the URL updates to include `?q=hello`
- **AND** default/empty values are omitted from the URL

#### Scenario: Page resets to 1 on filter or search change

- **WHEN** the user is on page 3 and changes a filter value
- **THEN** `page` automatically resets to `1`

#### Scenario: hasActiveFilters detection

- **WHEN** any filter value differs from its default OR search is non-empty
- **THEN** `hasActiveFilters` returns `true`

#### Scenario: Reset restores all defaults

- **WHEN** `reset()` is called
- **THEN** all filters return to their default values
- **AND** search becomes empty
- **AND** page becomes 1
- **AND** sort returns to defaults

#### Scenario: Readonly params computed property

- **WHEN** any state changes
- **THEN** `params` computed property returns a readonly object combining all filters, search, page, pageSize, sortBy, and sortDir
- **AND** `params` is suitable for passing to API query functions

### Requirement: useModalForm composable

The system SHALL provide a `useModalForm<T>` composable that manages modal form state for create and edit operations.

#### Scenario: Open for create

- **WHEN** `openCreate()` is called
- **THEN** `open` becomes `true`
- **AND** `editing` is `null`
- **AND** `form` is reset to the default values
- **AND** `isEditing` returns `false`

#### Scenario: Open for edit

- **WHEN** `openEdit(item)` is called with an existing item
- **THEN** `open` becomes `true`
- **AND** `editing` contains the original item reference
- **AND** `form` is populated with the item's values
- **AND** `isEditing` returns `true`

#### Scenario: Close modal

- **WHEN** `close()` is called
- **THEN** `open` becomes `false`

#### Scenario: Form is reactive

- **WHEN** `openCreate()` is called and the user modifies `form.name`
- **THEN** the change is reactive and reflected in the template
- **AND** `editing` remains `null` (form changes do not affect the editing reference)
