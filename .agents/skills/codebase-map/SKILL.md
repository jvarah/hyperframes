---
name: codebase-map
description: Contributor map of the HyperFrames monorepo — what each package does, how they depend on each other, the data flow from authored HTML to rendered video and through Studio edits, where common change types land, which files must change together, and the PR checklist CI enforces. Load before scoping, exploring or touching code for an issue or PR, to decide which packages and tests are in play.
metadata:
  internal: true
---

# HyperFrames codebase map (for contributors)

Built at `main` 5bf361f (2026-11-12) from per-package surveys. Paths were spot-checked, but this is a map, not the
territory: confirm with `grep` before you rely on a line number. Package `AGENTS.md` files win where they disagree
(`packages/studio/AGENTS.md`, `packages/cli/AGENTS.md`, `docs/AGENTS.md`).

Issues and PRs live upstream at **heygen-com/hyperframes**, not in forks.

## 1. The big picture

```
authored index.html (+ sub-compositions, assets)
        │
        ▼
@hyperframes/parsers ── parseHtml, GSAP acorn parser/writer, composition contract, hf-ids   (no workspace deps)
        │                     ▲
        ├──► @hyperframes/lint ── static rules → findings, shouldBlockRender           (deps: parsers only; never core)
        ▼
@hyperframes/core ── compileHtml (timing, scoping, runtime injection), browser runtime, GSAP frame adapter,
        │            audio/colour/media helpers, studio-api, generators
        ▼
@hyperframes/engine ── Chrome via Puppeteer: seek frame N (BeginFrame) → capture → FFmpeg encode, audio mix
        ▼
@hyperframes/producer ── render orchestrator: compile → probe → extractVideos → audio → capture(plain|streaming|
        │                segmented|HDR) → encode → assemble; HTTP server; distributed plan/chunk/assemble API
        ├──► @hyperframes/aws-lambda    (Lambda handler, S3 transport, CDK stack)
        └──► @hyperframes/gcp-cloud-run (Cloud Run server dispatching on Action, GCS, Terraform)

hyperframes CLI (packages/cli) ── uses nearly everything: core, engine, producer, parsers, lint, share, studio,
        │                         studio-server, inspector, aws-lambda, gcp-cloud-run
        ├── `preview` serves Studio  ──►  @hyperframes/studio (React 19 + zustand UI)
        │                                   │ HTTP /api/projects/:id/...
        │                                   ▼
        │                               @hyperframes/studio-server (Hono API: files, mutations, preview, render, media)
        ├── `check`/inspect      ──►  @hyperframes/inspector (headless Chrome source lookup)
        └── `share`/`publish`    ──►  @hyperframes/share (review/upload protocol, plain .mjs)

Embedding:  @hyperframes/player (<hyperframes-player> web component, bundles core runtime)
            @hyperframes/sdk (headless editing engine: ops, history, persist queue, adapters) ── used by studio
            @hyperframes/shader-transitions (WebGL GSAP transitions)
Content:    registry/ (blocks, components, examples) · skills/ (published agent skills) · docs/ (Mintlify)
```

Import fan-in (files importing it), a rough blast radius: **core** (studio 345, cli 153, producer 58, engine 52,
studio-server 49, …); **parsers** (studio 55, core 46, cli 44, studio-server 30, lint 12, …); **engine** (producer 183,
cli 62); **producer** (cli 25, aws-lambda 14, gcp 12); **lint** (cli 16, core 6, producer 3).

**Build order matters.** Core consumes the built `dist/` of parsers and lint under Node; the producer and CLI bundle
the core runtime. After changing a dependency run `bun run build` at the root before testing a consumer. `Cannot find
module '../generated/runtime-inline'` → `bun run --cwd packages/core build:hyperframes-runtime`.

## 2. Packages

### parsers — `packages/parsers` (`@hyperframes/parsers`)

Pure, browser-safe parsers and contract helpers. No workspace deps, so lint can share them.

- `src/htmlParser.ts` (linkedom parse/edit: `parseHtml`, `updateElementInHtml`, `addElementToHtml`, …)
- `src/gsapParserAcorn.ts`, `gsapWriterAcorn.ts`, `gsapUnroll.ts`: read/write GSAP scripts
- `src/compositionContract.ts`, `compositionDuration.ts`, `compositionVariables.ts`, `topLevelElements.ts`
- `src/hfIds.ts`, `hfIdAssignment.ts` (stable `data-hf-id`); `mediaDuration.ts`, `mediaStreams.ts`; `slideshow/`
- Node-only helpers go behind subpaths (`./asset-paths`), never the main entry.
- Tests: vitest, `bun run --cwd packages/parsers test <path>`. Goldens in `src/__goldens__/`, corpus test
  `gsapWriterParity.corpus.test.ts`.

### lint — `packages/lint` (`@hyperframes/lint`)

Static checker. `lintHyperframeHtml`, `lintProject`, `lintMediaUrls`, `shouldBlockRender`, `LINT_RULE_COUNT`;
`./browser` is the browser-safe subset (no Node imports).

- Flow: HTML → `buildLintContext` (`src/context.ts`) → each rule in `RULE_GROUPS` (`src/hyperframeLinter.ts:37`) →
  dedupe/sort → result. A rule is `(ctx) => findings`.
- Rule groups, one file each in `src/rules/`: adapters, audioAttributes, captions, composition, core, fonts, gsap,
  linkedClips, media, rootPaths, shaders, slideshow, structure, textures (test beside each: `<group>.test.ts`).
- **Never import `@hyperframes/core`** (cycle). `rules/audioAttributes.ts` restates a core contract instead.
- Recipes: new rule in an existing group → `src/rules/<group>.ts` + its test. New group → new file + register in
  `RULE_GROUPS`. Contract-driven rule → check `parsers/src/compositionContract.ts` first so lint matches the parser.
- Tests: vitest, `bun run --cwd packages/lint test <path>`.

### core — `packages/core` (`@hyperframes/core`)

Types, compiler, browser runtime, adapters, studio/editing APIs. ~70 subpath exports.

- `src/compiler/`: `htmlCompiler.ts` (`compileHtml`), `htmlBundler.ts`, `timingResolver.ts`, `timingCompiler.ts`,
  `compositionScoping.ts`, `htmlDocument.ts` (runtime injection). Goldens: `src/compiler/__goldens__/`.
- `src/runtime/` (`entry.ts`, see its README): drives the paused GSAP root timeline on `window.__timelines`.
- `src/inline-scripts/` + `src/generated/` (build output; git-ignored except a few committed inline files, e.g.
  `position-edits-render-inline.ts`, `svg-selector-aliases-inline.ts`; regenerate and commit them when they change).
- `src/studio-api/`, `src/editing/`, `src/generators/hyperframes.ts`, audio/media/colour, fonts (generated
  `fontData.generated.ts`), text, figma, slideshow, storyboard, registry, templates, vfx.
- `src/parsers/*`, `src/lint/index.ts`: **deprecated shims**; new code imports `@hyperframes/parsers` / `lint`.
- Tests: vitest + jsdom. `bun run --cwd packages/core test <path>`. The `test` script first runs
  `check:position-edits-render` and `check:svg-selector-aliases` (regenerate, fail on diff). Runtime contract suite:
  `bun run --filter @hyperframes/core test:hyperframe-runtime-ci`.

### engine — `packages/engine` (`@hyperframes/engine`)

Seekable page-to-video primitive. Deps: core, parsers.

- `src/services/`: `browserManager.ts` (`acquireBrowser`, `buildChromeArgs`, Chrome path resolution),
  `frameCapture.ts` (BeginFrame seek + capture), `chunkEncoder.ts` (+ `.types.ts`, `ENCODER_PRESETS`),
  `chunkStreamingEncoder.ts`, `streamingEncoder.ts`, `audioMixer.ts`, `aacEncode.ts`, `audioFxRender.ts`,
  `videoFrameExtractor.ts`, `parallelCoordinator.ts`, `motionBlur.ts`, `hdrCapture.ts`.
- `src/utils/`: `ffprobe.ts`, `networkPolicy.ts`, `psnr.ts`, `layerCompositor.ts`, `processTracker.ts`.
- `src/config.ts`: `HF_*` env knobs (`HF_FORCE_DRAWELEMENT`, `HF_DE_VERIFY`, `HF_DEBUG_RENDER`, …).
- Tests: vitest with `unit` (`*.test.ts`) and `browser` (`*.browser.test.ts`, serial) projects;
  `bun run --cwd packages/engine test`. Browser tests need Chrome; many need FFmpeg.

### producer — `packages/producer` (`@hyperframes/producer`)

Orchestrator. Deps: engine, core, lint, parsers, studio-server.

- `src/services/renderOrchestrator.ts`; stages in `src/services/render/stages/` (`compileStage`, `probeStage`,
  `extractVideosStage`, `audioStage`, `captureStage`, `captureStreamingStage`, `captureSegmentedStage`,
  `captureHdrStage`, `encodeStage`, `assembleStage`). A new stage also needs a `planHash.ts` entry.
- `src/server.ts` (`createProducerApp`, `parseRenderOptions`), `src/distributed.ts` + `services/distributed/`
  (`planV2.ts`, `planV2Execution.ts`, `renderChunk.ts`, `assemble.ts`, `mp4Stitch.ts`).
- `src/generated/hf-early-stub-inline.ts`: regenerate (`build:hf-early-stub`) after runtime changes.
- Tests are split into lanes (`scripts/run-test-lane.mjs`, classified by `scripts/test-classification.mjs`; a new test
  file must be classified): `bun run --cwd packages/producer test:unit` / `test:integration` / `test:regression`
  (goldens are pixel-sensitive; regression image `Dockerfile.test`). Integration and regression need Chrome + FFmpeg.
- `packages/producer/tests/*/output/` holds regression outputs. Don't commit incidental regenerations of them.

### aws-lambda / gcp-cloud-run

Distributed-render adapters over the producer's distributed API.

- Lambda: `src/handler.ts`, `src/events.ts`, `src/sdk/` (`renderToLambda`, `deploySite`), `src/cdk/`
  (`HyperframesRenderStack.ts` + snapshot test), `s3Transport.ts`, `s3Stitch.ts`. Zip-size budget
  (`scripts/verify-zip-size.ts`); Chromium from `@sparticuz/chromium`. Tests: `bun test`.
- Cloud Run: `src/server.ts` dispatches on `Action` (`plan`, `renderChunk`, `assemble`). A new Action touches the
  `CloudRunAction` type, the exhaustive switch and `terraform/workflow.yaml`. Its Dockerfile copies sibling
  workspaces, so it builds only from the monorepo root. Tests: `bun test`.

### cli — `packages/cli` (`hyperframes` bin)

Read `packages/cli/AGENTS.md` (agent-mode rules) first.

- Dispatch: `src/cli.ts` → `const commandLoaders = { … }` (line ~139) lazy-imports `src/commands/<name>.ts`
  (~88 command files: init, add, catalog, preview, present, play, share, publish, render, lint, check, snapshot,
  inspect, layout, beats, audio, transcribe, tts, browser, doctor, docs, compare, usage, auth, cloud, figma, skills,
  feedback, telemetry…). Commands use `defineCommand` (`src/utils/defineCommand.ts`, wraps citty).
- `--json`: a command opts in by declaring a `json` arg; results go to stdout as an envelope; failures through
  `jsonFailure()` (`src/utils/jsonError.ts`). Stdout is data, stderr is messages.
- Prompts only from `src/ui/prompts.ts` (lint-enforced; no direct `@clack/prompts`).
- Other dirs: `server/` (`studioServer.ts`, `fileWatcher.ts`, share routes), `share/`, `templates/` (`blank/`,
  `from-file/`, `_shared/`, `generators.ts`), `utils/`, `ui/`, `telemetry/`, `registry/` (remote fetch, resolver,
  installer for `hyperframes add`), `docs/`, `audio/`, `tts/`, `whisper/`, `timeline/`.
- Generated, don't hand-edit: `src/utils/agentDirs.generated.ts` (`gen:agent-dirs`), root `skills-manifest.json`
  (`gen:skills-manifest`).
- Tests: vitest, co-located `*.test.ts`. `bun run --cwd packages/cli test src/commands/lint.test.ts`. Contract tests
  that parse `commandLoaders`: `src/cli.agentMode.test.ts`, `src/cli.commands.test.ts`.
- Recipes: **flag** → args block in `src/commands/<name>.ts` + its test + docs page. **Command** → new file +
  `commandLoaders` entry + "Find your command" in `docs/packages/cli.mdx` (`scripts/check-docs-cli-commands.mjs`
  fails CI otherwise). **Template** → `src/templates/...`; `_shared/CLAUDE.md` and `_shared/AGENTS.md` must stay
  byte-identical. **Error message** → grep the string in `src/commands/`/`src/utils/`, update the matching test.
  **Render option reaching the producer** → the CLI command file, then the producer's options (`parseRenderOptions`
  / orchestrator config); check both the local and the cloud/distributed paths.

### studio — `packages/studio` (`@hyperframes/studio`)

React 19 + zustand editor UI. **Read `packages/studio/AGENTS.md` first.**

- `src/components/editor/` (DOM-edit overlay, selection chrome, `PropertyPanel*`, `domEditOverlayGeometry.ts`),
  `components/nle/` (`NLEPreview.tsx`, `PreviewPane.tsx`, `TimelinePane.tsx`), `components/{panels,sidebar,dock,
renders,share,storyboard,feedback,ui}/`.
- `src/player/`: timeline player (`store/playerStore.ts`, `hooks/useTimelinePlayer.ts`, `components/Timeline*`).
- `src/hooks/` (~340): commit writers (`useDomEditPersist.ts`, `useGsapScriptCommits.ts`, `gsapMutationClient.ts`),
  undo (`usePersistentEditHistory.ts`), `useProjectFileWriter.ts`. `src/contexts/`, `src/captions/`, `src/webmcp/`.
- Data flow: preview iframe loads `/api/projects/:id/preview`; a canvas edit goes gesture → writer → save via
  `file-mutations/patch-element` or `gsap-mutations` on studio-server. Change detection uses project signature and
  ETags (no WebSocket). Studio's own writes carry an own-write token or the preview reloads.
- Rules (from AGENTS.md): reach preview elements via `iframe.contentDocument`; overlay bugs are usually measurement;
  `rotate` is not in computed `transform`; batch patches before a seek; 600-line file limit; vitest (not `bun test`),
  happy-dom has no `DOMMatrix`; PRs need **Before/After captures**.
- Tests: `bun run --cwd packages/studio test [dir]`; e2e scripts `tests/e2e/*.mjs`.
- Recipes: timeline UI → `components/nle/TimelinePane.tsx`, `src/player/components/Timeline*.tsx`. Drag/resize →
  `components/editor/useDomEditOverlayGestures.ts`, `hooks/useDomGeometryCommits.ts`. Panel →
  `components/editor/propertyPanel*.tsx`. New server call → `hooks/useProjectFileWriter.ts`, `utils/projectRouting.ts`.

### studio-server — `packages/studio-server` (`@hyperframes/studio-server`)

Hono API the host (CLI or `packages/studio/vite.adapter.ts`) mounts under `/api` through a `StudioApiAdapter`
(`src/types.ts`).

- `src/createStudioApi.ts` wires `src/routes/` (`projects`, `files` (~3.8k lines: CRUD, `file-mutations/*`,
  `gsap-mutations*`), `preview`, `render`, `lint`, `thumbnail`, `media`, `waveform`, `peaks`, `history`, `selection`,
  `fonts`, `globalAssets`).
- `src/helpers/`: `sourceMutation.ts` (parse → patch by hf-id → serialize), `previewAdapter.ts`,
  `projectSignature.ts`, `safePath.ts`, `hfIdPersist.ts`. `src/history/` (undo store).
- Paths go through `safePath.ts`; writes are atomic and no-follow; origin guard tests in
  `createStudioApi.originGuard.test.ts`. New code goes in helpers, not `files.ts`.
- Tests: `bun run --cwd packages/studio-server test`.

### inspector — `packages/inspector`

Headless-Chrome service that returns the authored HTML/CSS/GSAP source for an element (selector, hf-id or ref), capped
JSON; `POST /inspect`, `POST /timeline`, `GET /info`. Used by `cli` `check`. Needs Chrome (`HF_INSPECT_CHROME`) and the
core runtime built. Tests: `bun run --cwd packages/inspector test`.

### sdk / sdk-playground

- `packages/sdk`: `openComposition` → document → `EditOp`s applied by `src/engine/mutate.ts`, patches from
  `apply-patches.ts`, `history.ts`, `persist-queue.ts`, adapters (`memory`, `fs`, `headless`, `iframe`). New op →
  `src/types.ts` + `engine/mutate.ts` + `apply-patches.ts` + `session.dispatch.test.ts`. Used by studio panels.
- `packages/sdk-playground`: private Vite app for exercising the SDK (`src/main.ts`, `src/fileAdapter.ts`).

### share — `packages/share`

Plain `.mjs` with hand-written types in `src/types/*.d.ts` (add one or `dist` types go missing). Review sharing
(`review*.mjs`), source capture/upload (`src/sources/`, policy must match `contract/path-policy.json`). Tests: `node
--test` (`tests/*.test.mjs`) via `bun run --cwd packages/share test`.

### player / shader-transitions

- `packages/player`: `src/hyperframes-player.ts` (attributes, events), `controls*.ts`, `runtime-message-handler.ts`
  (postMessage protocol), `slideshow/`. Bundles core; runtime CDN URL pinned in `tsup.config.ts`
  (`scripts/verify-runtime-pin.mjs`). Playback rate clamp 0.1–5 must match core. Tests: vitest + browser suites.
- `packages/shader-transitions`: `init()` in `src/hyper-shader.ts`; shaders in `src/shaders/registry.ts` (add to
  `SHADER_NAMES`); capture in `src/capture.ts`.

## 3. Content and tooling

- **registry/**: ~210 blocks, ~238 components, 9 examples. Item = dir with `registry-item.json` (schema
  `packages/core/schemas/registry-item.json`) + HTML (components also need `demo.html`). `hyperframes add` fetches
  `registry/registry.json` from `main` on GitHub. Commit source only; CI generates catalog pages/vectors. Deleting an
  item removes its `registry/registry.json` entry in the same PR. Checks: `node scripts/lint-registry-items.mjs`,
  `bun run check:catalog-drift`.
- **skills/**: 9 published skills; `skills-manifest.json` hashes (`bun packages/cli/scripts/gen-skills-manifest.ts`);
  reworded `description:` must propagate to README, AGENTS.md, CLAUDE.md, `docs/guides/skills.mdx`,
  `docs/prompting/overview.mdx`, `docs/quickstart.mdx`, and both CLI `_shared` templates. `.claude/skills/` and
  `.agents/skills/` (repo-native, like this file) must be byte-identical (`node scripts/check-skill-mirror.mjs`).
- **docs/**: Mintlify; nav in `docs/docs.json` (new page must be added); rules in `docs/AGENTS.md` and root
  `DOCS_GUIDELINES.md`. CLI behaviour changes ship docs in the same PR.
- **scripts/**: generators (`generate-catalog.ts`, `sync-schemas.ts`), checks (`check-*.mjs`,
  `check-comment-citations.mjs`, `comment-ratchet.mjs`), release. Root-script tests run via `bun run test:scripts`
  (an explicit list in root `package.json`; add new test files there and keep `scripts/check-test-reachability.mjs`
  happy).
- **CI** (`.github/workflows/`): `ci.yml` is the gate (build, lint, format, typecheck, tests, skills, catalog,
  fallow); `comments.yml` (comment citation + ratchet); `docs.yml` (docs PRs); `regression.yml`; path-filtered
  player/studio/windows/lambda jobs. Fork PRs wait for a maintainer to approve workflow runs.

## 4. Files that must change together

| If you change…                                 | …also change                                                                                            |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| a package's public subpath export              | `package.json` `exports` **and** `package-subpaths.json` (sdk: also `publishConfig`)                    |
| a CLI command / flag / visible behaviour       | the matching `docs/` page; new command → "Find your command" in `docs/packages/cli.mdx`                 |
| `packages/cli/src/templates/_shared/CLAUDE.md` | `_shared/AGENTS.md` (byte-identical)                                                                    |
| anything under `.claude/skills/`               | the same file under `.agents/skills/`                                                                   |
| a skill's `SKILL.md`                           | `skills-manifest.json` (regenerate) and, for `description:`, every catalog surface (see root CLAUDE.md) |
| core runtime                                   | rebuild runtime; regenerate producer `hf-early-stub`; run runtime contract tests                        |
| a lint rule mirroring a parser contract        | keep it consistent with `parsers/src/compositionContract.ts`                                            |
| a registry manifest schema                     | `packages/core/schemas/registry-item.json` + `npx tsx scripts/sync-schemas.ts`                          |

## 5. PR checklist (CI + PR template + CONTRIBUTING)

1. `bun install` (never pnpm/npm for the workspace); `bun run build` before tests/typecheck.
2. Conventional commits (commitlint hook), **every commit signed** (`git commit -S`, GitHub shows Verified),
   semantic PR title.
3. `node_modules/.bin/oxlint <files>`, `node_modules/.bin/oxfmt <files>` (lefthook does this on commit).
4. `bun run --filter '*' typecheck` (+ `bun run typecheck:scripts` if you touched `scripts/`).
5. Tests for each touched package (commands above); `bun run test:scripts` for root scripts.
6. Comments: `node scripts/check-comment-citations.mjs` and `node scripts/comment-ratchet.mjs` (not run by hooks).
   Comments say _why_, no history ("used to", "PR #123"), citations must resolve, TODOs name an owner or issue, a
   changed `packages/*/src` file's comment share may not rise.
7. Types: no `any`, no bare `as T` (use guards; `as unknown as T` only with a justification comment), no `!`.
8. Docs/registry/skills/composition checks as relevant (sections 3–4); `npx hyperframes lint` + `check` on any
   composition HTML touched.
9. PR body follows `.github/pull_request_template.md` (What / Why / Related work with `Fixes #` or `Refs #` / How /
   Test plan checkboxes). Studio UI changes attach Before/After captures.

## 6. Picking and scoping an issue

- Read `CONTRIBUTING.md` "Choosing work" and `TRIAGE.md`. Prefer `triage/ready` + `help wanted`/`good first issue`,
  unassigned. **Search open PRs for the issue number before starting**: on this repo most easy issues collect a PR
  within a day, often several, and an open PR means someone's work is in flight. Comment with your approach and
  coordinate the claim with a maintainer.
- Check who filed the issue: a reporter who opened their own PR the same day owns it; it won't free up.
- Claim on the **issue**, not the competing PR: commenting on the PR resets its stale clock. Draft PRs never go stale.
  When an idle PR closes, build on it and credit its author.
- Issue texts drift: re-check cited files/lines on `main` before planning (e.g. code moves between files).
- Avoid as a first PR: render timing/seek, FFmpeg/GPU capture, Windows-only bugs, security boundaries, anything
  `triage/needs-design` or `needs-info`.
- Scoping heuristic: lint, parsers, CLI argument validation and `scripts/` are the most self-contained areas (fast
  vitest suites, no Chrome). Studio needs captures and AGENTS.md rules. Producer/engine need Chrome and FFmpeg and
  slow lanes.
