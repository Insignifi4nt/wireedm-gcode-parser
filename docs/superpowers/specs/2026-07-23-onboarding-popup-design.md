# Onboarding Popup Design

## Goal

Add a first-visit onboarding popup to Wire EDM Workbench. The popup thanks the user for trying the app and offers a single primary action, **Go Build!**. It must be easy to dismiss and must use real UI controls around a generated poster-style artwork.

## Artwork

The artwork is a cinematic industrial ensemble poster, using the supplied comic poster only as a composition reference. **Wire EDM Workbench** is the central hero. Numerous intricate finished Wire EDM parts crowd in from every edge, overlap one another, and vary in scale and foreshortening. Electric-blue wire paths, restrained warm sparks, graphite metal, and a dark background create depth and motion.

The artwork contains only the product name and industrial imagery. It must not contain modal chrome, onboarding copy, buttons, close icons, comic characters, third-party branding, fake project data, or watermarks.

## Modal UI

The app renders a real accessible modal over the workbench after the initial app view is ready. The generated artwork occupies the visual portion of the modal. Separate HTML elements provide:

- a concise thank-you message for trying Wire EDM Workbench;
- a visible close button in the top-right corner;
- one bottom primary button labeled **Go Build!**.

The technical workbench style remains compact and restrained: thin border, dark graphite surface, small typography, and a cyan-accented primary action. The modal adapts to narrow screens without hiding its close control or action.

## Behavior and Persistence

The popup appears only when the onboarding-dismissed preference is absent. Closing it with the close button, pressing Escape, clicking outside the dialog, or selecting **Go Build!** dismisses it and records the preference in browser local storage. **Go Build!** does not navigate to a fake destination; it dismisses the popup and leaves the user on the functional dashboard.

The dialog receives focus when opened, traps keyboard focus, has accessible modal labeling, and restores focus when closed. The underlying application is not interactive while the modal is open.

If local storage cannot be read, the popup appears. If the dismissal preference cannot be written, dismissal still succeeds for the current page session.

## Component Boundaries

- `OnboardingDialog` owns the modal presentation, keyboard behavior, and dismissal events.
- A small onboarding preference module owns the stable storage key and safe read/write functions.
- `App` decides when to display the dialog and supplies the dismissal handler.
- The generated raster asset lives under `src/assets/` and is imported by the dialog.

The previously generated full-modal mock image is removed because it is not a valid supporting asset.

## Testing

Tests cover first-visit display, all dismissal paths, persistence across remounts, safe behavior when storage fails, accessible dialog semantics, focus entry/trapping/restoration, and the exact **Go Build!** label. Tests are written before production code and observed failing before implementation.

Verification includes focused tests, the full Vitest suite, and the production build.
