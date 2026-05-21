/**
 * Stamp Pipeline
 *
 * Sources (parallel, each produces DesignData):
 *   1. Image/SVG  →  load pixels → trace contours → DesignData
 *   2. Text       →  font layout → DesignData
 *
 * Merge: combine all sources into a single DesignData
 *
 * Processing steps (sequential, DesignData → DesignData):
 *   3. Smooth (optional) — smooth contour curves
 *   4. Thicken (optional) — dilate thin features for nozzle width
 *   [Add new steps here]
 *
 * Output:
 *   4. DesignData → THREE.Shape[] → stamp/clay geometry → STL
 *
 * To add a new processing step:
 *   1. Create a PipelineStep (see types.ts for the interface)
 *   2. Add it to PROCESSING_STEPS below
 *   3. Add a usePipelineStep() call in useStampPipeline.ts
 */

export type { PipelineStep, SyncStep, WorkerStep, StepFlags, StepResult, StepSlot, StepVariant } from "./types";
export type { TracerDefinition } from "./tracer-types";
export { textToDesignData } from "./text";
export { mergeDesignData } from "./merge";
export { thickenStep } from "./thicken";
export { smoothStep } from "./smooth";
export { TRACERS, STEP_SLOTS, getTracer, getStepVariant } from "./registry";

import type { PipelineStep } from "./types";
import { thickenStep } from "./thicken";
import { smoothStep } from "./smooth";

export const PROCESSING_STEPS: PipelineStep[] = [
  smoothStep,
  thickenStep,
];
