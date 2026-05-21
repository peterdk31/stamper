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
  colorMasks: number[]; // active hue centers in degrees (0-360) to remove
  colorMaskTolerance: number; // ± degrees from center hue (5-90)
  invert: boolean; // flip dark/light before threshold
  nozzleDiameter: number; // mm — highlights features thinner than this in the preview
  threadEnabled: boolean;
  threadConfig: ThreadConfig;
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
  colorMaskTolerance: 30,
  invert: false,
  nozzleDiameter: 0.4,
  threadEnabled: true,
  threadConfig: { ...DEFAULT_THREAD_CONFIG },
};

export const COLOR_PRESETS = [
  { label: "Red",    hue: 0,   chipColor: "#ef4444" },
  { label: "Orange", hue: 30,  chipColor: "#f97316" },
  { label: "Yellow", hue: 60,  chipColor: "#eab308" },
  { label: "Green",  hue: 120, chipColor: "#22c55e" },
  { label: "Cyan",   hue: 180, chipColor: "#06b6d4" },
  { label: "Blue",   hue: 240, chipColor: "#3b82f6" },
  { label: "Purple", hue: 280, chipColor: "#a855f7" },
] as const;

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
}
export interface DesignData {
  shapes: StampShapeData[];
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
  sourceAspectRatio: number | null;
  thinFeatureMap?: ThinFeatureMap;
}
