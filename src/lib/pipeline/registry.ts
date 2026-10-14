import type { TracerDefinition } from "./tracer-types";
import type { StepSlot, PipelineStep } from "./types";
import { marchingSquaresTracer } from "./tracers/marching-squares";
import { potraceTracer } from "./tracers/potrace";
import { thickenStep } from "./thicken";
import { clipperThickenStep } from "./thicken-clipper";
import { medialThickenStep } from "./thicken-medial";

export const TRACERS: TracerDefinition[] = [
  potraceTracer,
  marchingSquaresTracer,
];

export const STEP_SLOTS: StepSlot[] = [
  {
    id: "thicken",
    label: "Thickening",
    defaultId: "medial",
    variants: [
      { id: "medial", label: "Medial axis", description: "Grows every thin stroke to the slicer's minimum perimeter width", step: medialThickenStep },
      { id: "clipper", label: "Clipper", description: "Vector polygon offset thickening", step: clipperThickenStep },
      { id: "edt", label: "EDT", description: "Distance-transform raster thickening", step: thickenStep },
    ],
  },
];

export function getTracer(id: string): TracerDefinition {
  return TRACERS.find((t) => t.id === id) ?? TRACERS[0];
}

export function getStepVariant(slotId: string, variantId: string): PipelineStep {
  const slot = STEP_SLOTS.find((s) => s.id === slotId);
  if (!slot) throw new Error(`Unknown step slot: ${slotId}`);
  return slot.variants.find((v) => v.id === variantId)?.step ?? slot.variants[0].step;
}
