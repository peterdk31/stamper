export interface ThreadConfig {
  majorDiameter: number;  // mm — nominal size (M10 = 10)
  pitch: number;          // mm per revolution (M10 coarse = 1.5)
  height: number;         // mm — threaded engagement length
  tolerance: number;      // mm — shrinks male thread for FDM clearance
  segments: number;       // circumferential mesh segments
}

export const DEFAULT_THREAD_CONFIG: ThreadConfig = {
  majorDiameter: 10,
  pitch: 1.5,
  height: 4,
  tolerance: 0.1,
  segments: 48,
};

// The cutter is a separate straight-walled ring that slides over the stamp base.
// When enabled, the base outline follows the design (see base-outline.ts).
export interface CutterConfig {
  fidelity: number;      // 0–100 — how closely the base outline follows the design (0 = rectangle)
  sharpCorners: boolean; // keep the design's sharp corners instead of rounding them by the margin
  clayThickness: number; // mm — the cutting edge reaches this far below the stamp face
  wallThickness: number; // mm — ring wall
  gripHeight: number;    // mm — how far the ring reaches up the side of the base
  clearance: number;     // mm — gap between base and ring
}

export const DEFAULT_CUTTER_CONFIG: CutterConfig = {
  fidelity: 75,
  sharpCorners: false,
  clayThickness: 6,
  wallThickness: 1.2,
  gripHeight: 4,
  clearance: 0.3,
};

export interface ColorMask { hue: number; saturation: number; lightness: number; tolerance: number }

export type FitDimension = "width" | "height" | "off";

export interface StampSettings {
  width: number; // mm
  height: number; // mm
  baseThickness: number; // mm — the flat backing
  impressionDepth: number; // mm — how deep/tall the design features are
  cornerRadius: number; // mm — rounded rectangle corners
  fitDimension: FitDimension;
  margin: number; // mm — extra base material around the design
  simplification: number; // 0–1, controls raster trace detail
  threshold: number; // 0–255, luminance cutoff for black/white conversion
  brightness: number; // -100..100, applied before threshold
  contrast: number; // -100..100, applied before threshold
  colorMasks: ColorMask[];
  invert: boolean; // flip dark/light before threshold
  nozzleDiameter: number; // mm — highlights features thinner than this in the preview
  minPerimeterWidthPct: number; // % of nozzle — slicer's "Minimum perimeter width" (Arachne); medial thickening target
  minFeatureSizePct: number; // % of nozzle — slicer's "Minimum feature size"; thinner features would not print
  threadEnabled: boolean;
  threadConfig: ThreadConfig;
  cutterEnabled: boolean;
  cutterConfig: CutterConfig;
}

export const DEFAULT_STAMP_SETTINGS: StampSettings = {
  width: 40,
  height: 40,
  baseThickness: 6.0,
  impressionDepth: 4.0,
  cornerRadius: 3,
  fitDimension: "width",
  margin: 3,
  simplification: 0.5,
  threshold: 128,
  brightness: 0,
  contrast: 0,
  colorMasks: [],
  invert: false,
  nozzleDiameter: 0.4,
  minPerimeterWidthPct: 85, // PrusaSlicer default
  minFeatureSizePct: 25, // PrusaSlicer default
  threadEnabled: true,
  threadConfig: { ...DEFAULT_THREAD_CONFIG },
  cutterEnabled: false,
  cutterConfig: { ...DEFAULT_CUTTER_CONFIG },
};

export type TextAlign = "top" | "bottom";

export interface StampText {
  content: string;
  fontSize: number; // mm — character height
  fontFamily: string;
  letterSpacing: number; // mm — extra space between characters
  align: TextAlign;
}

export interface StampProject {
  settings: StampSettings;
  outlineImageDataUrl: string | null;
  texts: StampText[];
}

export interface StampPoint { x: number; y: number }
export interface StampShapeData { outer: StampPoint[]; holes: StampPoint[][]; source?: "image" | "text" }
export interface ThinFeatureMap {
  hasThinFeatures: boolean;
  pixels: Uint8Array;
  gridW: number;
  gridH: number;
  /** Set by the medial-axis thickener: the overlay shows changes, not just thin features. */
  changes?: FeatureChanges;
}
export interface FeatureChanges {
  thickened: boolean; // false = thickening off, overlay shows what the slicer would do
  widened: boolean; // features between min feature size and target width
  rescued: boolean; // features below min feature size
  targetWidth: number; // mm
  minFeatureSize: number; // mm
}
export interface DesignData {
  shapes: StampShapeData[];
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
  sourceAspectRatio: number | null;
  thinFeatureMap?: ThinFeatureMap;
}
