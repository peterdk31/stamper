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

export interface StampSettings {
  width: number; // mm
  height: number; // mm
  baseThickness: number; // mm — the flat backing
  impressionDepth: number; // mm — how deep/tall the design features are
  cornerRadius: number; // mm — rounded rectangle corners
  autoSize: boolean;
  padding: number; // mm — spacing around content when auto-sizing
  designMode: DesignMode;
  simplification: number; // 0–1, controls raster trace detail
  nozzleDiameter: number; // mm — highlights features thinner than this in the preview
  threadEnabled: boolean;
  threadConfig: ThreadConfig;
}

export type DesignMode = "raised" | "recessed";

export const DEFAULT_STAMP_SETTINGS: StampSettings = {
  width: 40,
  height: 40,
  baseThickness: 10.0,
  impressionDepth: 5,
  cornerRadius: 3,
  autoSize: true,
  padding: 4,
  designMode: "raised",
  simplification: 0.5,
  nozzleDiameter: 0.4,
  threadEnabled: true,
  threadConfig: { ...DEFAULT_THREAD_CONFIG },
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
export interface StampShapeData { outer: StampPoint[]; holes: StampPoint[][] }
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
