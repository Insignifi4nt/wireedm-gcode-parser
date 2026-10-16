# Replace topology selections in existing solid features

Read-only plan against `dc10fffc`, after the current sketch checkpoints. Section defaults and title casing are being completed separately. No tests, native probes, builds or browser actions were run for this plan.

## Confirmed need and existing contracts

Reopen an existing selected-edge Fillet or Chamfer. The form can change its radius and choose all-body scope, but `capturedEdges` remains the accepted feature's original selector. There is no replacement-edge action. Shell has a thickness field and a read-only opening summary. These are existing-tool editing gaps, not a proposed new operation. See [CadFeatureEditor](../../src/features/cad/CadFeatureEditor.tsx), lines135 and273–293.

The input cannot be picked correctly from the final result. [cadKernelModel](../../src/features/cad/kernel/cadKernelModel.ts), line295, deletes consumed bodies and disposes their topology. Relaxing the visible-body checks would not recover them. The accepted [topology actions](../../src/features/cad/cadTopologyActions.ts) correctly require a visible body, current document version and exact build ID. Keep that route unchanged.

There is no need for a new native command or worker protocol. [CadKernelClient](../../src/features/cad/kernel/cadKernelClient.ts) already supports build, inspect and resolve, and [cadKernelRuntime](../../src/features/cad/kernel/cadKernelRuntime.ts), lines31–39, requires the complete document key and build ID to match its cached model. Prefer a small owned-input coordinator using this client and the existing topology-actions validators. Enlarging [candidate preview](../../src/features/cad/cadFeaturePreview.ts) would mix input snapshots with its debounce, last-valid retention and Apply readiness. Clear its client before borrowing input geometry; no new general preview framework is needed.

## Bounded human behavior

Add **Choose edges** beside selected-edge scope and **Choose opening** beside Shell's opening. This also lets an all-edge Fillet/Chamfer deliberately switch to selected edges. It works for an existing feature even when its current edited candidate fails to build.

1. Capture the form owner, accepted document identity/version/storage, edited feature ID, current draft target body and complete local numeric parameter edits. Synchronously clear candidate geometry/readiness before displaying or enabling input picks.
2. Prepare and build the strict history prefix preceding the edited feature. Preserve document metadata and every preceding feature; apply local parameter edits through the existing preparation path so solved graphs and linked references are current. Do not first reduce the edited feature or downstream suffix against its old selector. A prefix diagnostic disables selection; retained partial geometry cannot authorize it.
3. Display the requested input body from that exact prefix build. Reuse `CadViewport` edge/face ray picking, `mergeTopologySelection`, highlights and `CadTopologyInspector`'s keyboard-accessible exact list. Edge selection keeps current limits/additive behavior; Shell chooses one planar face. This is an operation-local selection, separate from accepted workbench selection. Background or wrong-body picks are consumed without changing the feature or global selection.
4. Start with no replacement picks. The existing persisted query is retained in the draft until **Use selection**. Avoid inventing a reverse query-to-key binding. Convert current picks with the same client's `resolveTopologyPicks(prefixDocument, request)` and existing typed result validation. Publish only its ordinary `selection` or `opening` to the draft.
5. Clear the input stage, restore normal candidate preview and require a valid complete-part preview before Apply. Apply remains one ordinary `update-feature` plus the existing correlated parameter batch, one history step. Feature ID, body, radius/thickness strings, tangent flag and unrelated fields remain exact unless explicitly edited.

Cancel selection restores the entire pre-pick local draft, including previous body, selector and scalar edits, without accepting anything. It need not cancel the feature edit. Cancel feature restores accepted state as today. Scope toggling after a successful repick must restore the latest local selected-edge selector, not the original `capturedEdges`; this is a necessary small form-state correction.

## Input snapshot interface and guards

Suggested shared request data, with schema-derived readonly types:

```ts
type CadFeatureInputRequest = {
  readonly featureId: string;
  readonly bodyId: string;
  readonly parameterValues?: Readonly<Record<string, number>>;
};
```

`featureId` must name an existing Fillet, Chamfer or Shell. The prefix ends immediately before it. `bodyId` may be any body actually visible in that prefix, matching the existing Body field's options. Keep new-feature creation on its current accepted-build route. Values use the existing finite numeric parameter contract; callers cannot supply an arbitrary feature proposal or prefix document.

Concrete coordinator methods:

- `build(request, expectedVersion, signal?, scope?: 'editor')` returns `{inputToken, documentId, version, featureId, bodyId, parameterValues, document, result}`. `document` is the immutable prepared prefix; `result` is its `CadBuildResult`.
- `inspect({inputToken, ...CadTopologyInspectRequest}, expectedVersion, signal?, scope?)` and `resolve({inputToken, ...CadTopologyResolvePicksRequest}, ...)` reuse `createCadTopologyActions` against the captured prefix/client.
- `clear(inputToken?)`, `invalidate()` and `dispose()` release the current snapshot/client. An old token's cleanup cannot clear a newer picker. Only one current token/snapshot exists, not a registry.

Add one `pick-topology` arm to [CadFeatureReferencePickCommand](../../src/features/cad/cadFeatureReferencePicking.ts). Its local selection and snapshot never become ordinary workbench topology selection or candidate Apply readiness. One isolated client serves the stage, not one worker per click.

Check token, accepted document reference, version/storage, captured parameter proposal, target body, prefix/build and purpose before and after awaits. Inspection uses the stored prefix and same client. A missing/restarted snapshot requires an explicit rebuild. Source/storage changes, editor/workspace closure, foreign workflow, cancellation or replacement invalidate late replies. Preserve existing kernel-client cancellation/disposal. UI may use trusted `editor` workflow scope; public tools cannot request that privilege.

## Shared agent route

Expose one narrow `cad_build_feature_input` with this request and `expectedVersion`, returning the token, captured request and bounded body/build summary. Existing `cad_inspect_topology` and `cad_resolve_topology` gain optional `inputToken`; omission preserves accepted-cache behavior. Route tokened calls through the same coordinator as UI, strip the token before existing worker requests, and never publish input builds as accepted `liveBuild`. Build ID binds the exact parameter proposal; tools cannot silently switch or reconstruct it.

The result is the existing geometric query, used by the existing `cad_edit_document` feature update. If `parameterValues` were proposed, the accepted edit batch includes those same numeric parameter values. Numeric selector fragility under later upstream changes remains the existing documented policy; this slice does not introduce persistent topology naming or automatically rewrite selectors.

An agent can already author a known geometric query directly with `update-feature`, so no new edit kind is needed. That route alone does not expose an arbitrary imported/consumed input's exact selectable geometry. Suppress/delete/recreate workarounds also change history and can invalidate downstream dependencies; they are not an acceptable replacement for owned repicking.

## Implementation and meaningful acceptance

Suggested ownership: one owner implements the small input coordinator/prefix helper, controller/tool routing and focused guard tests; root owns editor/reference-command, Workbench/viewport/inspector wiring and production proof. Reuse existing validators/renderers. Roughly150–220 non-UI lines and100–160 UI lines seems plausible. No saved schema migration, geometric algorithm or native binding change is expected.

Two functional groups are enough before full production proof:

- **Replace edges:** mounted existing Fillet or Chamfer with a consumed target and downstream feature. Choose a different edge on the preceding body, retain radius/tangent/source fields, preview then Cancel with unchanged accepted history. Reopen, select through the exact list, Apply once, Undo/Redo/save. Include Scope all → selected after repicking so the old selector cannot reappear.
- **Replace opening and guard ownership:** Shell chooses another planar input face. A deferred prefix build or resolve completed after Escape/source change cannot update draft, selection, preview or history. Wrong worker/build/body/scope rejects. One proposed shared-parameter edit must affect the prefix before resolving, then the same final feature/parameter batch is previewed and accepted. Assert agent input-build → inspect → resolve → ordinary update yields the same geometric query and final part as human picking.

Root should verify one actual consumed-edge edit and one Shell opening change in the production app, with full-part native preview, Cancel, one Undo and storage reload. The preceding sections record the pre-implementation plan; the receipt below supersedes its evidence limits.

## Accepted implementation and evidence

Implemented with one small `cadFeatureInput` coordinator and one local picker hook, reusing the kernel client, topology actions, viewport, inspector, original feature form and submission path. Request capture and prefix preparation precede any old-selector or downstream evaluation. One disposable token binds the source, parameter proposal, storage, version, workflow scope, body, build and purpose. Accepted-build routing is unchanged without the token; public tools cannot claim editor scope. Cancelling an inspector read discards that reply without destroying the stage; cancelling/replacing the stage releases its worker. Unsupported selectors can be corrected in place. No geometry-wide freezing, additional worker protocol or global cache service was introduced.

Meaningful RED cases reproduce the absent route and cancellation/cache recovery. Final service/controller/tool checks pass178; editor/hook/existing picker checks18; Workbench/preview checks107. Groups overlap. Full production build/types, final scoped types, shared controls and final packaging/docs/source checks pass. Independent UI and coordinator/controller/tool/docs reviews close without open implementation findings.

`e2e/cad-topology-repick.spec.ts` supplies three complete existing Fillet/Chamfer/Shell journeys. Final Chromium3/3(21.2s) and Firefox3/3(31.3s) cover Cancel/focus, exact agent selector parity, accepted-cache isolation, Apply, independent native volume, exact history and portable save/reload. Expected box volumes are995.7079632679488,990 and424mm³. The final run exposed an ancestor-hide focus regression; hiding only the unrelated Suppress action repairs it without remounting the owned form. Logs: tmp/cad-topology-repick-{chromium,firefox}-final.log.

Actual production pointer proof replaces a20mm fillet edge, with995.7079632679488mm³ final volume, and a Shell side opening while proposing wall1→2/stock height5→10. Shell volume1231.9999999999998 agrees with independent1232mm³. Source expressions and atomic parameter/feature Undo/Redo remain exact. Native drafts were restored empty and closed without Save; isolated browser journeys verify persistence. Final Cancel-focus proof is the browser journey after the cosmetic repair. Receipts: tmp/cad-topology-native-{edge,shell}-{pick.png,solid.png,proof.json}.

Public agent/CAD guides describe the delivered route. Saved schemas, geometry/native algorithms and tolerances, app version and remote state are unchanged. Numeric geometric-query fragility under unrelated later dimensional edits remains explicit; persistent topology naming was not added.
