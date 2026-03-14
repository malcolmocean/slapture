# Route Detail Page Redesign + Integrations Rename

## Summary

Redesign the route detail page from flat tables to a pipeline-hero layout that visualizes the flow: triggers → transform → destination. Rename "Auth Status" to "Integrations" throughout the dashboard.

## Changes

### 1. Rename "Auth Status" → "Integrations"

- Nav link text: "Auth Status" → "Integrations"
- Page title: "Auth Status" → "Integrations"
- The existing `<h3>Integrations</h3>` sub-heading inside the page becomes redundant after rename — remove it or change to something like "Connected Services"
- No URL change needed (keep `/dashboard/auth` for now)

### 2. Route Detail Page: Pipeline Hero

A visual flow diagram at the top of the route detail page, showing three boxes connected by arrows:

**Triggers box** (blue, solid border)
- Lists all triggers with live/draft status indicators
- Green dot (●) for live triggers, yellow dot (○) for draft triggers
- Shows pattern in monospace

**Transform box** (orange, dashed border)
- Only shown if `transformScript` is non-null
- Shows a truncated preview of the script, or "Custom transform" if too long

**Destination box** (green, solid border)
- Integration type badge (e.g., "google-sheets", "roam")
- Specific target details from `destinationConfig`:
  - fs: `filePath`
  - sheets: `spreadsheetId` (raw ID — no API call to resolve name), `sheetName`
  - roam: graph name, daily_tagged/page_child mode
  - intend: `baseUrl`
  - notes: target type and ID
- Connection status from integration registry

**Arrows**
- Horizontal (`→`) by default
- Switch to vertical (`↓`) below 700px viewport width via CSS media query

### 3. Meta Line

Centered text below the pipeline hero:
- Created by badge: "user" or "mastermind"
- Total capture count
- Success rate: `captures with executionResult === 'success'` / `total captures` (all statuses in denominator)
- Last used (relative time)

### 4. Accordion Sections

Use `<details>/<summary>` elements (already used elsewhere in the dashboard for LLM raw prompt/response sections).

**Recent Captures** (open by default — use `<details open>`)
- Columns: Time | Input → Output | Matched | Status
- Each row shows the raw input, then on a second line `↳` the transformed output (from `capture.transformedPayload`)
- If transform didn't change the input (or `transformedPayload` is null/same as raw), show "(unchanged)" label
- "Matched" column shows which trigger pattern matched (from `capture.matchedTrigger`), with draft highlight. For captures that predate this field (no `matchedTrigger` stored), show "—"
- Verified captures get a "verified" badge
- "View all N captures →" links to `/dashboard/captures?route={routeId}` (requires adding route filter support to the captures list page)
- Cap at 10 rows in the accordion

**Version History** (collapsed by default)
- Columns: Version | Time | Reason | Changes
- Changes column shows a compact delta: "+1 trigger", "~transform", "created"
- Current version labeled "(current)"

**Origin** (collapsed by default, only for `route.createdBy === 'mastermind'`)
- Query: earliest capture for this route (captures filtered by routeFinal, sorted by timestamp asc, limit 1)
- Shows the first capture's raw input (linked to its capture detail page)
- Mastermind reasoning: extracted from `capture.executionTrace` — find the step with `step === 'mastermind'` and show `output.reason`
- Creation date

### 5. What's NOT Changing

- Route, destinationConfig, and trigger types: unchanged
- URL structure: route detail stays at `/dashboard/routes/:routeId`
- Other dashboard pages: unchanged (except captures list getting route filter param)
- No multi-destination support (future work)

## Schema Additions to Capture

Two new optional fields on the `Capture` interface in `src/types.ts`:

```typescript
/** The payload after transform script ran (null if no transform or unchanged) */
transformedPayload?: string | null;

/** The trigger pattern that matched this capture in the dispatcher */
matchedTrigger?: string | null;
```

**Where to set them:**
- `transformedPayload`: set in the execute step of `src/pipeline/index.ts`, after the transform script runs but before writing to the destination
- `matchedTrigger`: set in the dispatch step, from `DispatchResult.matchedTrigger`

These are additive, optional fields — existing captures without them degrade gracefully (show "—" for matched trigger, omit transform output line).

## Visual Reference

Mockups are in `.superpowers/brainstorm/30046-1773519935/route-page-transform.html` — open with the brainstorm companion server or directly in a browser.
