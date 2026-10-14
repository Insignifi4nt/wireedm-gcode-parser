# Inventory evidence

These files preserve the read-only CAD handoff inventory exactly as received. They are source-audit evidence, not replacement assets or instructions.

- Snapshot: 2026-10-14T13:07:23.675Z.
- Source revision: `c16a15eb9f9805622ccaeda5b39dc2698ddfda8c` with concurrent uncommitted CAD changes recorded in the audit.
- Audit SHA-256: `5f01e3e94f33f923096f24273a1e32ce33f9f456fde2b73aa342f953ed127469`.
- Source hashes, stable use IDs and expanded variant/route metadata remain in the original files.

The crosswalk supplies original icon IDs and exclusion reasons for each applicable usage. Source geometry, mathematical notation, native controls and browser cursor affordances retain their documented scope exclusions. Newer CAD code is planned for integration after its reviewed commit; this evidence does not transfer implementation ownership.

The local audit copy plus its Markdown can be supplied to `scripts/reconcile-icon-inventory.mjs` for a repeatable mapping audit. The Markdown is required because it records the expanded renderer variants and relations separately from the JSON source bindings.

The CAD task later published its recoverable implementation checkpoint at `09795ec`. This is the eventual integration baseline; the exact original snapshot above remains unchanged as evidence. That task continues hardening independently and retains ownership of all app servers.
