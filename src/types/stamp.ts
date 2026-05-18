export interface ThreadConfig {
  outerDiameter: number;  // mm
  innerDiameter: number;  // mm
  pitch: number;          // mm per revolution
  height: number;         // mm — total thread depth in stamp
  tolerance: number;      // mm — shrinks male thread for clearance
  segments: number;       // segments per revolution
}

export const DEFAULT_THREAD_CONFIG: ThreadConfig = {
  outerDiameter: 12,
  innerDiameter: 8,
  pitch: 3,
  height: 8,
  tolerance: 0.5,
  segments: 32,
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
  threadEnabled: false,
  threadConfig: { ...DEFAULT_THREAD_CONFIG },
};

export interface StampText {
  content: string;
  fontSize: number; // mm
  fontFamily: string;
  letterSpacing: number; // mm — extra space between characters
  x: number; // offset from center, mm
  y: number; // offset from center, mm
  rotation: number; // degrees
}

export interface StampProject {
  settings: StampSettings;
  outlineImageDataUrl: string | null;
  texts: StampText[];
}
