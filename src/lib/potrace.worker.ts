import { traceGrid, type ShapeData, type ProgressFn } from "./potrace-trace";

export type TraceMessage =
  | { type: "progress"; progress: number; stage: string }
  | { type: "result"; shapes: ShapeData[]; imageWidth: number; imageHeight: number };

// ---------------------------------------------------------------------------
// Main worker
// ---------------------------------------------------------------------------

interface ColorMask { hue: number; saturation: number; lightness: number; tolerance: number }

interface TraceRequest {
  bitmap: ImageBitmap;
  threshold: number;
  brightness: number;
  contrast: number;
  colorMasks: ColorMask[];
  invert: boolean;
}

function adjustPixel(value: number, brightness: number, contrastFactor: number, invert: boolean): number {
  if (invert) value = 255 - value;
  value += brightness;
  value = (value - 128) * contrastFactor + 128;
  return value < 0 ? 0 : value > 255 ? 255 : value;
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const r1 = r / 255, g1 = g / 255, b1 = b / 255;
  const max = Math.max(r1, g1, b1), min = Math.min(r1, g1, b1);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l * 100];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === r1) h = ((g1 - b1) / d + (g1 < b1 ? 6 : 0)) * 60;
  else if (max === g1) h = ((b1 - r1) / d + 2) * 60;
  else h = ((r1 - g1) / d + 4) * 60;
  return [h, s * 100, l * 100];
}

function hslDist(h1: number, s1: number, l1: number, h2: number, s2: number, l2: number): number {
  const dh = Math.abs(h1 - h2);
  const hd = (dh > 180 ? 360 - dh : dh) * (100 / 180);
  return Math.sqrt(hd * hd + (s1 - s2) * (s1 - s2) + (l1 - l2) * (l1 - l2));
}

function isColorMasked(r: number, g: number, b: number, masks: ColorMask[]): boolean {
  if (masks.length === 0) return false;
  const [h, s, l] = rgbToHsl(r, g, b);
  for (let i = 0; i < masks.length; i++) {
    if (hslDist(h, s, l, masks[i].hue, masks[i].saturation, masks[i].lightness) <= masks[i].tolerance) return true;
  }
  return false;
}

self.onmessage = (e: MessageEvent<TraceRequest>) => {
  const { bitmap, threshold, brightness = 0, contrast = 0, colorMasks = [], invert = false } = e.data;

  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(bitmap, 0, 0);
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  bitmap.close();

  const width = imageData.width;
  const height = imageData.height;
  const data = imageData.data;

  const post = self.postMessage.bind(self);
  let lastReported = -1;
  const report: ProgressFn = (progress, stage) => {
    const rounded = Math.round(progress * 100);
    if (rounded === lastReported) return;
    lastReported = rounded;
    post({ type: "progress", progress, stage } as TraceMessage);
  };

  report(0, "Building pixel grid…");

  const contrastFactor = (259 * (contrast + 255)) / (255 * (259 - contrast));
  const hasAdjustments = brightness !== 0 || contrast !== 0 || invert;
  const hasMasks = colorMasks.length > 0;

  const total = width * height;
  const grid = new Uint8Array(total);
  for (let y = 0; y < height; y++) {
    const rowStart = y * width;
    const dataRowStart = rowStart * 4;
    for (let x = 0; x < width; x++) {
      const off = dataRowStart + x * 4;
      const r0 = data[off], g0 = data[off + 1], b0 = data[off + 2];
      if (data[off + 3] <= 128) { grid[rowStart + x] = 0; continue; }
      if (hasMasks && isColorMasked(r0, g0, b0, colorMasks)) {
        grid[rowStart + x] = 0;
        continue;
      }
      let r = r0, g = g0, b = b0;
      if (hasAdjustments) {
        r = adjustPixel(r, brightness, contrastFactor, invert);
        g = adjustPixel(g, brightness, contrastFactor, invert);
        b = adjustPixel(b, brightness, contrastFactor, invert);
      }
      const luminance = 0.299 * r + 0.587 * g + 0.114 * b;
      grid[rowStart + x] = luminance < threshold ? 1 : 0;
    }
    if (y % 50 === 0) report(0.15 * (y / height), "Building pixel grid…");
  }

  post({ type: "result", ...traceGrid(grid, width, height, report) } as TraceMessage);
};
