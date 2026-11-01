# CAD feature kinds

Every CAD feature kind is declared once, in `src/domain/cad/features/kinds/`, and registered in `cadFeatureRegistry.ts`. Consumers read
features through the definition rather than switching on kinds. What a kind shows people and agents is kept apart, in
`cadFeaturePresentation.ts`, so the kernel worker never loads its text. The definition owns:

| Declaration | Read by |
| --- | --- |
| `schema`, `fields` | The document schema (`cadFeatureSchemaUnion`), agent schemas and this page. |
| Slots (`cadFeatureReference`, `cadFeatureOptionalReference`) | Reference checks while parsing, and dependencies (`cadFeatureInputs`, `cadFeatureDependencies`). |
| Scalars (`cadFeatureScalarField`, `cadFeatureVectorField`) | Range checks while parsing, parameter traversals (`mapCadFeatureScalars`) and kernel limits (`cadFeatureScalar`). |
| `quantities` of a field holding nested values | What each number inside it measures, by path (`cadFeatureQuantityAt`). |
| `choices`, `condition` | Choice values in forms, and conditional fields such as a target that only exists for join and cut. |
| `outputs`, `body`, `suppression` | Which features may feed a slot, which bodies a feature replaces (`cadConsumedBodyIds`) and what an inactive feature leaves. |
| `evaluator` | Where the feature is evaluated and the version of that evaluation, for the rebuild cache. |
| `diagnostics` | Every code the kind's own checks and evaluation raise, apart from the steps all kinds share (`CAD_FEATURE_SHARED_DIAGNOSTICS`). |
| `check`, `instances` | Checks beyond the schema while parsing, and the solid count a feature makes. |

Its presentation, one entry per kind in `CAD_FEATURE_PRESENTATION`, owns:

| Declaration | Read by |
| --- | --- |
| `form` | The feature editor: a generic form from its controls, or the kind's own editor. |
| `agent` | Whether agent tools may name the kind, its description and its authoring schema. |

## Adding a kind

1. Add the stored type to the `CadFeature` union in `src/domain/cad/cadDocument.ts`.
2. Declare it in its family's module under `src/domain/cad/features/kinds/`. Build the shape with `cadFeatureShape` and the field helpers in
   `cadFeatureFields.ts`, and end the object with `satisfies CadFeatureDefinition<'your-kind'>`. Give every id-holding field a slot and
   every dimension a scalar; declare a field only when something reads it. A field holding nested numbers declares what each measures in
   `quantities`.
3. Register it in `catalog()` in `cadFeatureRegistry.ts`. The type check fails until every kind is registered with a matching shape. Add
   its schema to the end of `cadFeatureSchemaUnion`: the union order fixes the published document and edit schema hashes.
4. Evaluate it in the kernel (`src/features/cad/kernel/cadKernelModel.ts`), or in the domain for a reference kind.
5. Give it a form in `CAD_FEATURE_PRESENTATION` (`cadFeaturePresentation.ts`); the type check fails until every kind has an entry. A
   list of `controls` is drawn by the shared editor; a kind that needs more declares `editor: 'bespoke'` and adds its case to
   `CadFeatureEditor.tsx`.
6. Decide its agent exposure, in the same entry. Initial agent discovery must stay within 51,200 UTF-8 bytes (`cadAgentJourney.test.tsx`), so keep the
   description short. Update `docs/site/agents.md` if agents gain the kind.
7. List its `diagnostics`. `cadFeatureDiagnostics.test.ts` reads the kind's definition and its kernel case, follows the calls they
   make, and fails unless the list holds exactly the refusal codes found, less the shared ones. A code returned by a call is traced
   through the function's returns. The test also fails on a code it cannot trace to where it was written, and on a new site where it
   takes a caught error's code on trust, until that site is read and listed in the test. `cadFeatureQuantities.test.ts` fails until
   every number its schema accepts has exactly one declared quantity.
8. Regenerate the table below with `UPDATE_CAD_FEATURE_TABLE=1 npm test -- --run src/domain/cad/__tests__/cadFeatureTable.test.ts`.
   Without the variable the test fails while the table differs from the definitions.

Raise `evaluator.version` whenever the same stored feature would evaluate differently.

The kinds modules and the resolvers they call import each other, so none of them may read another while modules load: read schemas and
definitions inside functions, and build the catalog on first use. `cadFeatureModuleOrder.test.ts` loads each module of the cycle first and
fails if any of them does.

## Activity

Read whether a feature takes part in a rebuild with `cadFeatureActive(feature, scope)`. `npm run lint` refuses any other read of the stored
`suppressed` flag that names it: member and element access, destructuring by any literal key, including computed keys and destructuring
assignment, `'suppressed' in` and reflective reads. Code that means the stored value itself, such as the suppression toggle or a check
on an import result, reads it with `cadFeatureSuppressionFlag`. The check cannot see reads that never name the flag (key enumeration,
spreads, serialization) or keys built at run time; `scripts/check-feature-activity.ts` lists what it covers.

## Not yet slots

Revolve, circular pattern and mirror store their axis or plane as a choice of world axes and planes. K4 turns these into slots that
reference datum axes and planes. Pattern counts are scalars with `literal: true` until a format change lets them hold expressions.

## Kinds

<!-- cad-feature-table:start -->
| Kind | Family | Inputs | Dimensions | Gives | Bodies | When inactive | Evaluator | Form | Agents |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `datum-plane` | reference | – | – | plane | none | no-output | domain 1 | bespoke | yes |
| `curve` | reference | `plane` support plane, optional | `offset` length | curve | none | no-output | domain 1 | bespoke | yes |
| `sketch` | reference | `plane` support plane, optional; `graph` linked sketches | `offset` length | sketch | none | no-output | domain 1 | bespoke | yes |
| `imported` | solid | – | – | body | new | no-output | kernel 1 | bespoke | yes |
| `extrude` | solid | `sketchId` profile sketch; `targetId` target body, optional | `distance` length > 1e-7, ≤ 1000000 | body | new-or-modify | pass-through | kernel 1 | bespoke | yes |
| `pocket` | solid | `sketchId` profile sketch; `targetId` target body | – | body | modify-target | pass-through | kernel 1 | bespoke | yes |
| `revolve` | solid | `sketchId` profile sketch; `targetId` target body, optional | `angle` angle > 1e-7, ≤ 360 | body | new-or-modify | pass-through | kernel 1 | fields | yes |
| `loft` | solid | `sketchIds` sections sketches, ordered; `targetId` target body, optional | – | body | new-or-modify | pass-through | kernel 1 | fields | yes |
| `sweep` | solid | `sketchId` profile sketch; `curveId` path curve; `targetId` target body, optional | – | body | new-or-modify | pass-through | kernel 1 | fields | yes |
| `fillet` | dress-up | `targetId` target body | `radius` length > 1e-7, ≤ 1000000 | body | modify-target | pass-through | kernel 1 | fields | yes |
| `chamfer` | dress-up | `targetId` target body | `radius` length > 1e-7, ≤ 1000000 | body | modify-target | pass-through | kernel 1 | fields | yes |
| `shell` | dress-up | `targetId` target body | `thickness` length > 1e-7, ≤ 1000000 | body | modify-target | pass-through | kernel 1 | fields | yes |
| `boolean` | body | `targetId` target body; `toolId` tool body | – | body | consume-tools | pass-through | kernel 1 | fields | yes |
| `transform` | body | `sourceId` source body | `translation` length ×3; `rotation` angle ×3 | body | modify-target | pass-through | kernel 1 | fields | yes |
| `linear-pattern` | body | `sourceId` source body | `count` count ≥ 2, ≤ 100, literal; `spacing` length ×3 | body | modify-target | pass-through | kernel 1 | fields | yes |
| `circular-pattern` | body | `sourceId` source body | `count` count ≥ 2, ≤ 100, literal; `center` length ×3; `angle` angle | body | modify-target | pass-through | kernel 1 | fields | yes |
| `mirror` | body | `sourceId` source body | – | body | new | no-output | kernel 1 | fields | yes |
<!-- cad-feature-table:end -->
