# PR9: Follow-ups (Optional)

## Summary
Small cohesion and consistency tweaks with zero behavior change.

## Ideas
- Unify resize handling patterns; centralize status error helpers.
- Ensure no duplicate subscriptions occur when re-initializing.
- Tighten types/guards around event data in wiring.

## Acceptance Criteria
- Build passes; no behavior changes; fewer ad-hoc patterns.

## Test Plan
- Quick smoke; verify no change in end-user interactions.

