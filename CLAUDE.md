# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

Ceramic Stamps is a client-only Next.js web app that generates STL files for 3D-printable ceramic stamps. Users upload an outline image (raster or SVG) or create text-based designs (potter's marks, monograms), configure physical dimensions and print settings, preview the stamp in 3D alongside a simulated clay impression, and export STL files. There is no backend — all processing (image tracing, geometry generation, STL encoding) happens in the browser.

## Commands

- `npm run dev` — start dev server (Turbopack)
- `npm run build` — production build (also runs TypeScript type-checking)
- `npm run lint` — ESLint
- `npm test` — Vitest (tests in `src/lib/__tests__/`)

## Architecture

### Pipeline

`DesignData` is the universal intermediate format. All inputs produce `DesignData`, all processing steps transform `DesignData → DesignData`, and a single conversion to `THREE.Shape[]` happens at the end. See `src/lib/pipeline/index.ts` for the pipeline overview.

```
Sources (parallel):                Processing (sequential):           Output:
┌──────────────────┐               ┌─────────────────────┐
│ Image/SVG        │──┐            │ thicken (optional)  │
│ → trace → data   │  ├─ merge ──→│ [new steps here]    │──→ toShapes ──→ geometry
├──────────────────┤  │            └─────────────────────┘
│ Text → data      │──┘
└──────────────────┘
```

**Adding a new processing step:**
1. Create a `PipelineStep` (see `src/lib/pipeline/types.ts` for the interface — supports sync and worker variants)
2. Add it to `PROCESSING_STEPS` in `src/lib/pipeline/index.ts`
3. Add a `usePipelineStep()` call in `src/hooks/useStampPipeline.ts`

**Key files:**
- `src/lib/pipeline/index.ts` — pipeline definition and step registry
- `src/hooks/useStampPipeline.ts` — React hook that composes the full pipeline
- `src/hooks/usePipelineStep.ts` — generic hook that runs any `PipelineStep`

**Geometry output:**
- `stamp-geometry.worker.ts` takes settings + unified `shapes` → mirrors them → builds serialized meshes (assembled into a `THREE.Group` in `StampPreview.tsx`). In cutter mode it also computes the shaped base outline and returns the cutter ring as separate `cutterMeshes`
- `clay-geometry.ts` takes the same shapes *unmirrored* → builds inverted impression
- `stl-export.ts` walks the Three.js scene graph → binary STL blob → browser download

### Key libraries

- **Three.js / React Three Fiber / Drei** — 3D rendering, geometry, orbit controls
- **three/examples/jsm/loaders/FontLoader** — `Font` class lives here, not in core Three.js
- **three/examples/jsm/loaders/SVGLoader** — parses SVG text → `ShapePath[]` → `Shape[]`
- **opentype.js** — parses .ttf/.otf files in-browser, converted to typeface.js JSON format for FontLoader

### Source layout

- `src/types/stamp.ts` — all domain types: `StampSettings`, `StampText`, `ThreadConfig`, `HandleStyle`, nozzle-preset constants
- `src/lib/pipeline/` — pipeline definition and steps:
  - `index.ts` — pipeline overview, `PROCESSING_STEPS` registry
  - `types.ts` — `PipelineStep` interface (sync and worker variants), `StepFlags`
  - `text.ts` — `textToDesignData()` — wraps text-to-shapes to produce `DesignData`
  - `merge.ts` — `mergeDesignData()` — combines multiple `DesignData` sources
  - `thicken.ts` — thicken step definition (wraps `thicken.worker.ts`)
  - `thicken-medial.ts` — default thicken variant (wraps `medial-thicken.worker.ts`); `registry.ts` lists all variants
- `src/hooks/` — React pipeline orchestration:
  - `useStampPipeline.ts` — full pipeline composition hook (sources → merge → steps → shapes)
  - `usePipelineStep.ts` — generic hook that runs any `PipelineStep`
- `src/lib/` — pure logic, no React:
  - `image-trace.worker.ts` — bitmap → contour shapes (marching-squares + Douglas-Peucker simplification)
  - `design-data.ts` — `rasterToDesignData()`, `designDataToShapes()` (untangles shapes whose rings cross with a Clipper even-odd union — never drop a ring, a dropped hole prints filled), contour nesting
  - `stamp-geometry.worker.ts` — builds the stamp meshes (rounded-rect base, design extrusion, female thread) off the main thread. Contains `mirrorShapes()`; imports the female thread from `thread-geometry.ts`.
  - `stamp-geometry.ts` — `createRoundedRectShape()`, shared with `clay-geometry.ts`
  - `base-outline.ts` — cutter mode: stamp base outline = design silhouette grown by `cutterConfig.offset` (miter joins, so corners stay sharp — there is no separate corner logic) and smoothed by `fidelity` (100→50 closing applied after the offset, 50→0 Minkowski blend hull→design-area rectangle), always one ring, always containing the thread disc. Tested in `__tests__/base-outline.test.ts`
  - `cutter-geometry.ts` — cutter ring (base outline + clearance, one wall thick) and its Z range
  - `clay-geometry.ts` — builds clay impression preview (inverted stamp design, unmirrored)
  - `stl-export.ts` — binary STL writer + download helper
  - `font-manager.ts` — loads/caches bundled fonts, converts .ttf/.otf → typeface.js JSON via opentype.js
  - `text-to-shapes.ts` — converts `StampText[]` entries → `THREE.Shape[]` with position + rotation transforms
  - `text-layouts.ts` — preset layout generators (circular, stacked, monogram)
  - `thread-geometry.ts` — parametric helical thread geometry (female for stamp, male for handle)
  - `handle-geometry.ts` — handle body generators (knob, T-bar, mushroom) with male thread post
  - `simplify.ts` — Douglas-Peucker contour simplification; `simplifyShape()` (used by the stamp worker) simplifies a shape's outer + holes and backs off the tolerance if any edges would cross, since a crossing hole gets filled by triangulation
  - `potrace-trace.ts` — Potrace-style tracer core (optimal polygon + vertex adjustment), used by `potrace.worker.ts`
  - `curve-fit.ts` — Potrace curve fitting: polygon → Bézier curves that keep sharp corners and don't shrink the shape. Applied by both tracers; there is no separate smoothing step.
  - `medial-thicken.ts` — default thickener: widens every stroke thinner than the slicer's min perimeter width (`minPerimeterWidthPct` of nozzle) by pushing its outline edges straight outward (straight sides stay straight, square ends stay square), fills junction notches from a disc-grown fallback, rounds sharp tips, and builds the widened/rescued overlay. Pure functions, tested in `__tests__/medial-thicken.test.ts`.
- `src/components/` — React UI. The sidebar is collapsible sections in workflow order (Design, Size, Base, Handle, Clay cutter, Printer); each shows its common controls and hides the rest behind a "More" disclosure, and shows a one-line summary while closed:
  - `ui.tsx` — shared `Toggle`, `ToggleRow`, `Section` (collapsible, header summary + optional header toggle), `More`, `Hint`. Use these instead of hand-rolling switches/disclosures
  - `SliderInput.tsx` — slider with a typeable value field; `onInput` fires during drag for cheap live previews, `onChange` on commit
  - `StampPreview.tsx` — 3D stamp preview, thin-feature warnings with fix buttons, export bar below the canvas. Loaded with `next/dynamic` (SSR disabled).
  - `StampSettingsPanel.tsx` — renders the Size … Printer sections. "Keep proportions" lock = `fitDimension !== "off"`; editing W or H while locked sets `fitDimension` to that dimension
  - `ImageUpload.tsx` — drop zone, compact original + B/W thumbnails, threshold; brightness/contrast/invert/color removal under "More image options"
  - `TextEditor.tsx` — text entries (font, size; letter spacing + position under "More"). Font upload lives at the bottom of `FontPicker`'s list
- **`?dev` URL flag** — shows the tracer and thicken-variant pickers and developer-facing warnings. Keep algorithm choices out of the normal UI.
- `public/fonts/` — 20 bundled static TTFs from Google Fonts (licences in `licenses/`), listed with categories in `BUNDLED_FONTS` (`font-manager.ts`). Loaded via opentype.js like uploaded fonts, and registered as `FontFace`s so `FontPicker.tsx` can preview each font in its own face

### Important constraints

- **All client-side.** No API routes, no server actions. Any new feature must run entirely in the browser.
- **Units are millimeters.** All geometry dimensions are in mm. STL output is in mm.
- **Mirroring happens once, in `stamp-geometry.worker.ts`.** Source shapes are always stored unmirrored. The stamp preview shows the mirrored version; the clay impression preview uses the original unmirrored shapes.
- **Nozzle presets** overwrite `impressionDepth` and `baseThickness` when switched.
- **Stamp orientation** — impression face on +Z, prints face-up without supports.
- **Clay cutter is a separate tool, never fused to the stamp** — clay gets trapped between a fused cutting wall and the relief. Opt-in via `cutterEnabled`; when off, the stamp is unchanged (rounded-rect base). In cutter mode the margin is 0 (`plateMargin()`), replaced by the cutter offset. The ring is straight-walled and nothing on it is narrower than the base, so stamp and cutter slide past each other in either order. Cutting edge reaches `clayThickness` below the stamp face; exports cutting-edge up.
- **Thread config** — all dimensions in `ThreadConfig` (single object in `stamp.ts`). Tolerance (default 0.5mm) shrinks the male thread. Designed for easy iteration after test prints.
- **Font conversion** — `font-manager.ts` converts opentype.js glyph paths to typeface.js JSON format (m/l/q/b path commands). The `loader.parse()` call uses an `any` cast because the generated JSON doesn't match Three.js's strict `FontData` type.
