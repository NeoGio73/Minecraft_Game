# Integration notes (collected from package reports)

Read by the integration package (WP-11) after every other package is in.
Each item names the package that raised it.

## From WP-10 (LMS adapter, persistence, packaging)

- `src/lms/types.ts`: add `readonly exhausted: bigint` to `ProgressState` and
  update the codec comment to the 8-field layout (08-deployment §1 U9). Until
  then `Progress.ts` exports `ProgressStateV2` (extends the contract with
  `exhausted`) and `exhaustedOf()` / `asV2()`; collapse V2 into the contract
  once the type is edited. `docs/design/00-contracts.md` §4 wording ("three
  bigint bitmasks", 7-field codec) needs the matching edit.
- `orgocraft.config.json` (WP-05) must exist with `version` (semver) and
  integer `passMark`; both packagers exit 1 with a clear message until it does.
- `Game.ts` / `State.ts`: use the return value of `adapter.milestone()`, apply
  `RESUME_ATTEMPT_FLOOR` and the exhausted lock per 08-deployment §3.8
  (`exhaustedOf(state)` is exported for this), and re-export `REVIEW_BADGE`,
  `DEGRADED_BADGE`, `ENDED_BADGE` from `ScormAdapter.ts` in `src/ui/strings.ts`
  (07-ui U4).
- `scripts/check-relative-paths.mjs` fails on a build whose index.html has no
  CSS link. This resolves once the app imports `src/ui/styles.css` so Vite
  emits `href="./assets/...css"`.
- `applyOutcome` on an exhausted unsolved challenge records a zero-credit
  solve rather than crediting points (keeps `summarize(s).earned === s.earned`).
- package.json scripts `check:paths` and `release` were added by the lead.
