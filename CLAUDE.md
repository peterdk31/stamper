# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

Ceramic Stamps is a client-only Next.js web app that generates STL files for 3D-printable ceramic stamps. Users upload an outline image (raster or SVG) or create text-based designs (potter's marks, monograms), configure physical dimensions and print settings, preview the stamp in 3D alongside a simulated clay impression, and export STL files. There is no backend — all processing (image tracing, geometry generation, STL encoding) happens in the browser.

## Commands

- `npm run dev` — start dev server (Turbopack)
- `npm run build` — production build (also runs TypeScript type-checking)
- `npm run lint` — ESLint
- No test framework is configured yet

## Architecture

### Data flow

`page.tsx` owns all state (`StampSettings`, image/SVG data, `StampText[]`, derived `THREE.Shape[]`). The pipeline:

1. **Image input**: raster → `image-trace.ts` (contour trace with Douglas-Peucker simplification) → `THREE.Shape[]`; SVG → `svg-parse.ts` (Three.js `SVGLoader`) → `THREE.Shape[]`
2. **Text input**: `text-to-shapes.ts` uses `font-manager.ts` to load fonts, calls `font.generateShapes()`, applies position/rotation offsets → `THREE.Shape[]`
3. **Geometry**: `stamp-geometry.ts` takes settings + design shapes + text shapes → mirrors them → builds `THREE.Group` (rounded-rect base + extruded shapes). Adds female thread geometry when handle mount enabled.
4. **Clay preview**: `clay-geometry.ts` takes the same shapes *unmirrored* and builds an inverted impression (raised stamp → recessed clay).
5. **Export**: `stl-export.ts` walks the Three.js scene graph → binary STL blob → browser download.

### Key libraries

- **Three.js / React Three Fiber / Drei** — 3D rendering, geometry, orbit controls
- **three/examples/jsm/loaders/FontLoader** — `Font` class lives here, not in core Three.js
- **three/examples/jsm/loaders/SVGLoader** — parses SVG text → `ShapePath[]` → `Shape[]`
- **opentype.js** — parses .ttf/.otf files in-browser, converted to typeface.js JSON format for FontLoader

### Source layout

- `src/types/stamp.ts` — all domain types: `StampSettings`, `StampText`, `ThreadConfig`, `HandleStyle`, nozzle-preset constants
- `src/lib/` — pure logic, no React:
  - `image-trace.ts` — bitmap → contour shapes (marching-squares + Douglas-Peucker simplification)
  - `svg-parse.ts` — SVG text → shapes via Three.js SVGLoader
  - `stamp-geometry.ts` — builds stamp `THREE.Group` (rounded-rect base, design extrusion, female thread). Contains `mirrorShapes()` and `createRoundedRectShape()`.
  - `clay-geometry.ts` — builds clay impression preview (inverted stamp design, unmirrored)
  - `stl-export.ts` — binary STL writer + download helper
  - `font-manager.ts` — loads/caches bundled fonts, converts .ttf/.otf → typeface.js JSON via opentype.js
  - `text-to-shapes.ts` — converts `StampText[]` entries → `THREE.Shape[]` with position + rotation transforms
  - `text-layouts.ts` — preset layout generators (circular, stacked, monogram)
  - `thread-geometry.ts` — parametric helical thread geometry (female for stamp, male for handle)
  - `handle-geometry.ts` — handle body generators (knob, T-bar, mushroom) with male thread post
  - `simplify.ts` — Douglas-Peucker contour simplification
- `src/components/` — React UI panels:
  - `StampPreview.tsx` — side-by-side stamp + clay impression canvases, export buttons. Loaded with `next/dynamic` (SSR disabled).
  - `StampSettingsPanel.tsx` — stamp dimensions, nozzle preset, design mode, corner radius, handle mount toggle + thread settings
  - `ImageUpload.tsx` — drag/drop for raster + SVG, simplification slider
  - `TextEditor.tsx` — text entries with font selector, preset layouts, font upload
- `public/fonts/` — 5 bundled typeface.js JSON fonts (helvetiker, droid serif, optimer)

### Important constraints

- **All client-side.** No API routes, no server actions. Any new feature must run entirely in the browser.
- **Units are millimeters.** All geometry dimensions are in mm. STL output is in mm.
- **Mirroring happens once, in `stamp-geometry.ts`.** Source shapes are always stored unmirrored. The stamp preview shows the mirrored version; the clay impression preview uses the original unmirrored shapes.
- **Nozzle presets** overwrite `impressionDepth` and `baseThickness` when switched.
- **Stamp orientation** — impression face on +Z, prints face-up without supports.
- **Thread config** — all dimensions in `ThreadConfig` (single object in `stamp.ts`). Tolerance (default 0.5mm) shrinks the male thread. Designed for easy iteration after test prints.
- **Font conversion** — `font-manager.ts` converts opentype.js glyph paths to typeface.js JSON format (m/l/q/b path commands). The `loader.parse()` call uses an `any` cast because the generated JSON doesn't match Three.js's strict `FontData` type.
