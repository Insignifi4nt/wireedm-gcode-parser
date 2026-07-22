# Onboarding Popup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a first-visit, persistently dismissible onboarding modal with cinematic Wire EDM poster artwork and a real **Go Build!** action.

**Architecture:** A focused preference module safely reads and writes one local-storage key. A standalone accessible dialog owns focus, keyboard, backdrop, and presentation behavior; `App` owns its open state and renders it after the workbench is ready. The generated bitmap contains only the product name and industrial ensemble artwork.

**Tech Stack:** React, TypeScript, Tailwind CSS, lucide-react, Vitest, React DOM test utilities, built-in image generation.

## Global Constraints

- The artwork contains **Wire EDM Workbench** but no modal chrome, onboarding copy, buttons, close icons, comic characters, third-party branding, fake project data, or watermarks.
- The real primary button label is exactly **Go Build!**.
- Every dismissal path stores the dismissed preference when possible and closes for the current session even when storage writes fail.
- Do not add navigation or a fake destination.
- Use one amended commit for the design, plan, asset, implementation, and tests.

---

### Task 1: Poster Artwork

**Files:**
- Create: `src/assets/wire-edm-onboarding-poster.png`
- Delete: `src/assets/wire-edm-onboarding-popup.png`

**Interfaces:**
- Produces: a project-local raster asset importable by `OnboardingDialog`.

- [ ] **Step 1: Generate the artwork**

Use the supplied poster as composition reference only. Generate a landscape cinematic industrial ensemble with the product name centered and intricate finished Wire EDM parts crowding and overlapping inward from every edge.

- [ ] **Step 2: Inspect and validate the artwork**

Confirm the name is legible, the composition is dense, and no forbidden modal elements, characters, or watermark appear.

- [ ] **Step 3: Save the selected image**

Copy the built-in output into `src/assets/wire-edm-onboarding-poster.png` and remove the rejected full-modal mock asset.

### Task 2: Safe Onboarding Preference

**Files:**
- Create: `src/features/onboarding/onboardingPreference.ts`
- Test: `src/features/onboarding/onboardingPreference.test.ts`

**Interfaces:**
- Produces: `ONBOARDING_DISMISSED_STORAGE_KEY`, `hasDismissedOnboarding(storage?: Pick<Storage, 'getItem'>): boolean`, and `rememberOnboardingDismissal(storage?: Pick<Storage, 'setItem'>): void`.

- [ ] **Step 1: Write failing preference tests**

Test absent/present values plus throwing `getItem` and `setItem` implementations. A read failure returns `false`; a write failure does not escape.

- [ ] **Step 2: Run the focused test and observe RED**

Run: `npm test -- --run src/features/onboarding/onboardingPreference.test.ts`

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement the minimal safe preference functions**

Use the stable key `wireedm.onboarding.dismissed` and the stored string `true`, with `try/catch` around storage access.

- [ ] **Step 4: Run the focused test and observe GREEN**

Run: `npm test -- --run src/features/onboarding/onboardingPreference.test.ts`

Expected: all preference tests pass.

### Task 3: Accessible Onboarding Dialog

**Files:**
- Create: `src/features/onboarding/OnboardingDialog.tsx`
- Test: `src/features/onboarding/OnboardingDialog.test.tsx`

**Interfaces:**
- Consumes: `src/assets/wire-edm-onboarding-poster.png`.
- Produces: `OnboardingDialog({ open, onDismiss }: { open: boolean; onDismiss: () => void })`.

- [ ] **Step 1: Write failing dialog behavior tests**

Render the open dialog and assert `role="dialog"`, `aria-modal="true"`, the exact **Go Build!** button, poster alt text, initial close-button focus, focus trapping, Escape dismissal, backdrop dismissal, and focus restoration. Assert a closed dialog renders nothing.

- [ ] **Step 2: Run the focused test and observe RED**

Run: `npm test -- --run src/features/onboarding/OnboardingDialog.test.tsx`

Expected: FAIL because `OnboardingDialog` does not exist.

- [ ] **Step 3: Implement the dialog**

Use a fixed backdrop and centered responsive panel; render the poster as an image, a visible lucide `X` close button, concise real onboarding copy, and the real bottom CTA. Capture the previously focused element, focus close on mount, trap Tab/Shift+Tab, dismiss on Escape/backdrop/click/CTA, and restore focus on cleanup.

- [ ] **Step 4: Run the focused test and observe GREEN**

Run: `npm test -- --run src/features/onboarding/OnboardingDialog.test.tsx`

Expected: all dialog tests pass.

### Task 4: App Integration and Persistence

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/__tests__/appWorkbenchDashboard.test.tsx`

**Interfaces:**
- Consumes: `OnboardingDialog`, `hasDismissedOnboarding`, and `rememberOnboardingDismissal`.

- [ ] **Step 1: Write failing app integration tests**

Assert the dialog appears on a fresh browser-storage visit, dismissing **Go Build!** writes `wireedm.onboarding.dismissed=true`, and a remount with that preference does not show the dialog.

- [ ] **Step 2: Run the focused integration test and observe RED**

Run: `npm test -- --run src/__tests__/appWorkbenchDashboard.test.tsx`

Expected: FAIL because the app does not render onboarding.

- [ ] **Step 3: Integrate first-visit state in `App`**

Initialize state from `hasDismissedOnboarding()`, render `OnboardingDialog`, and use one dismissal handler that closes locally before calling `rememberOnboardingDismissal()`.

- [ ] **Step 4: Run focused tests and observe GREEN**

Run: `npm test -- --run src/features/onboarding/onboardingPreference.test.ts src/features/onboarding/OnboardingDialog.test.tsx src/__tests__/appWorkbenchDashboard.test.tsx`

Expected: all onboarding and dashboard tests pass.

### Task 5: Full Verification and Single Commit

**Files:**
- Modify: `docs/superpowers/plans/2026-07-23-onboarding-popup.md` only to mark completed checkboxes if useful.

- [ ] **Step 1: Run the full test suite**

Run: `npm test -- --run`

Expected: zero failed tests.

- [ ] **Step 2: Run the production build**

Run: `npm run build`

Expected: TypeScript and Vite build exit successfully.

- [ ] **Step 3: Review the final diff**

Run: `git diff --check && git status --short && git diff --stat HEAD^`

Expected: no whitespace errors; only onboarding design, plan, asset, implementation, tests, and removal of the rejected image are present.

- [ ] **Step 4: Amend the existing commit**

Run: `git add docs/superpowers src/assets src/features/onboarding src/App.tsx src/__tests__/appWorkbenchDashboard.test.tsx && git commit --amend --no-edit`

Expected: the existing onboarding design commit becomes the single commit containing all work.
