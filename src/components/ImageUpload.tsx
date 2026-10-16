"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import type { ColorMask, ProjectImage } from "@/types/stamp";
import ColorPickerModal from "./ColorPickerModal";
import SliderInput from "./SliderInput";
import { More, ToggleRow } from "./ui";

interface Props {
  image: ProjectImage | null;
  onImageChange: (image: ProjectImage | null) => void;
  isProcessing?: boolean;
  progress?: number;
  progressStage?: string;
  threshold?: number;
  onThresholdChange?: (value: number) => void;
  brightness?: number;
  onBrightnessChange?: (value: number) => void;
  contrast?: number;
  onContrastChange?: (value: number) => void;
  colorMasks?: ColorMask[];
  onColorMasksChange?: (value: ColorMask[]) => void;
  invert?: boolean;
  onInvertChange?: (value: boolean) => void;
  /** Extra controls (dev-only tracer picker) shown under the image options. */
  extraOptions?: React.ReactNode;
}

interface LocalAdj {
  threshold: number;
  brightness: number;
  contrast: number;
  colorMasks: ColorMask[];
  invert: boolean;
}

function adjustPixel(value: number, brightness: number, contrastFactor: number, inv: boolean): number {
  if (inv) value = 255 - value;
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

export default function ImageUpload({
  image,
  onImageChange,
  isProcessing, progress = 0, progressStage = "",
  threshold = 128, onThresholdChange,
  brightness = 0, onBrightnessChange,
  contrast = 0, onContrastChange,
  colorMasks = [], onColorMasksChange,
  invert = false, onInvertChange,
  extraOptions,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pixelCacheRef = useRef<ImageData | null>(null);
  const propsRef = useRef<LocalAdj>({ threshold, brightness, contrast, colorMasks, invert });
  const [pickerOpen, setPickerOpen] = useState(false);
  const imageDataUrl = image?.kind === "raster" ? image.dataUrl : null;
  const svgText = image?.kind === "svg" ? image.svgText : null;
  const fileName = image?.fileName ?? null;

  useEffect(() => {
    propsRef.current = { threshold, brightness, contrast, colorMasks, invert };
  }, [threshold, brightness, contrast, colorMasks, invert]);

  function drawPreview(adj: LocalAdj) {
    const canvas = canvasRef.current;
    const srcData = pixelCacheRef.current;
    if (!canvas || !srcData) return;
    if (canvas.width !== srcData.width || canvas.height !== srcData.height) {
      canvas.width = srcData.width;
      canvas.height = srcData.height;
    }
    const ctx = canvas.getContext("2d")!;
    const out = ctx.createImageData(srcData.width, srcData.height);
    const src = srcData.data;
    const dst = out.data;
    const hasAdj = adj.brightness !== 0 || adj.contrast !== 0 || adj.invert;
    const cf = (259 * (adj.contrast + 255)) / (255 * (259 - adj.contrast));
    const hasMasks = adj.colorMasks.length > 0;
    for (let i = 0; i < src.length; i += 4) {
      const r0 = src[i], g0 = src[i + 1], b0 = src[i + 2];
      if (hasMasks && isColorMasked(r0, g0, b0, adj.colorMasks)) {
        dst[i] = dst[i + 1] = dst[i + 2] = 255;
        dst[i + 3] = 255;
        continue;
      }
      let r = r0, g = g0, b = b0;
      if (hasAdj) {
        r = adjustPixel(r, adj.brightness, cf, adj.invert);
        g = adjustPixel(g, adj.brightness, cf, adj.invert);
        b = adjustPixel(b, adj.brightness, cf, adj.invert);
      }
      const lum = 0.299 * r + 0.587 * g + 0.114 * b;
      const v = lum >= adj.threshold ? 255 : 0;
      dst[i] = dst[i + 1] = dst[i + 2] = v;
      dst[i + 3] = 255;
    }
    ctx.putImageData(out, 0, 0);
  }

  // Redraw the B/W preview on every slider movement, before the value is committed
  function preview(partial: Partial<LocalAdj>) {
    drawPreview({ ...propsRef.current, ...partial });
  }

  useEffect(() => {
    const src = imageDataUrl
      ?? (svgText ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgText)}` : null);
    if (!src) { pixelCacheRef.current = null; return; }
    const img = new window.Image();
    img.onload = () => {
      const maxDim = 400;
      const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
      const w = Math.round(img.width * scale);
      const h = Math.round(img.height * scale);
      const off = document.createElement("canvas");
      off.width = w;
      off.height = h;
      const ctx = off.getContext("2d")!;
      if (svgText) { ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, w, h); }
      ctx.drawImage(img, 0, 0, w, h);
      pixelCacheRef.current = ctx.getImageData(0, 0, w, h);
      drawPreview(propsRef.current);
    };
    img.src = src;
  }, [imageDataUrl, svgText]);

  useEffect(() => {
    drawPreview({ threshold, brightness, contrast, colorMasks, invert });
  }, [threshold, brightness, contrast, colorMasks, invert]);

  const handleFile = useCallback(
    (file: File) => {
      if (file.type === "image/svg+xml" || file.name.endsWith(".svg")) {
        const reader = new FileReader();
        reader.onload = () => onImageChange({ kind: "svg", svgText: reader.result as string, fileName: file.name });
        reader.readAsText(file);
      } else if (file.type.startsWith("image/")) {
        const reader = new FileReader();
        reader.onload = () => onImageChange({ kind: "raster", dataUrl: reader.result as string, fileName: file.name });
        reader.readAsDataURL(file);
      }
    },
    [onImageChange],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const file = e.dataTransfer.files[0];
      if (file) handleFile(file);
    },
    [handleFile],
  );

  function handleClear() {
    onImageChange(null);
  }

  const hasContent = !!(imageDataUrl || svgText);
  const showRasterControls = hasContent && onThresholdChange;
  const hasAdjustments = brightness !== 0 || contrast !== 0 || colorMasks.length > 0 || invert;

  const imageSource = imageDataUrl ?? (svgText ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgText)}` : null);

  return (
    <>
    <div className="space-y-3">
      <input
        ref={inputRef}
        type="file"
        accept="image/*,.svg"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleFile(file);
          e.target.value = "";
        }}
      />

      {hasContent ? (
        <div onDrop={handleDrop} onDragOver={(e) => e.preventDefault()} className="space-y-2">
          <div className="relative flex gap-2 rounded border border-stone-200 bg-stone-50 p-1.5">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={imageSource!} alt="Original" title="Original"
              className="h-24 min-w-0 flex-1 object-contain" />
            <canvas ref={canvasRef} title="What gets traced"
              className="h-24 min-w-0 flex-1 object-contain" />
            {isProcessing && (
              <div className="absolute inset-0 flex items-center justify-center bg-white/70">
                <div className="h-6 w-6 border-3 border-accent-500 border-t-transparent rounded-full animate-spin" />
              </div>
            )}
          </div>
          <div className="flex items-center gap-3 text-sm">
            <span className="flex-1 truncate text-stone-600" title={fileName ?? undefined}>
              {fileName ?? (svgText ? "SVG" : "Image")}
            </span>
            <button type="button" onClick={() => inputRef.current?.click()} disabled={isProcessing}
              className="text-accent-700 hover:text-accent-800 disabled:opacity-50">
              Replace
            </button>
            <button type="button" onClick={handleClear} disabled={isProcessing}
              className="text-red-600 hover:text-red-800 disabled:opacity-50">
              Remove
            </button>
          </div>
        </div>
      ) : (
        <div
          onDrop={handleDrop}
          onDragOver={(e) => e.preventDefault()}
          onClick={() => !isProcessing && inputRef.current?.click()}
          className={`rounded-lg border-2 border-dashed p-4 text-center ${
            isProcessing ? "border-accent-200 cursor-wait" : "border-stone-300 cursor-pointer hover:border-accent-500"
          }`}
        >
          {isProcessing ? (
            <div className="space-y-2">
              <p className="text-sm text-stone-600">{progressStage}</p>
              <div className="w-full bg-stone-200 rounded-full h-2">
                <div className="bg-accent-500 h-2 rounded-full" style={{ width: `${Math.round(progress * 100)}%` }} />
              </div>
            </div>
          ) : (
            <>
              <p className="text-sm text-stone-700">Drop an image or SVG here, or click to upload</p>
              <p className="mt-0.5 text-xs text-stone-400">Dark areas become the raised design</p>
            </>
          )}
        </div>
      )}

      {showRasterControls && (
        <>
          <SliderInput label="Threshold" value={threshold} min={1} max={255} step={1}
            onInput={(v) => preview({ threshold: v })}
            onChange={(v) => onThresholdChange!(v)} />

          <More label="More image options" dot={hasAdjustments}>
            <SliderInput label="Brightness" value={brightness} min={-100} max={100} step={1}
              onInput={(v) => preview({ brightness: v })}
              onChange={(v) => onBrightnessChange?.(v)} />
            <SliderInput label="Contrast" value={contrast} min={-100} max={100} step={1}
              onInput={(v) => preview({ contrast: v })}
              onChange={(v) => onContrastChange?.(v)} />
            <ToggleRow label="Invert (light areas become the design)" checked={invert}
              onChange={(v) => onInvertChange?.(v)} />
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => setPickerOpen(true)}
                className="text-sm text-accent-700 hover:text-accent-800">
                Pick colors to remove…
              </button>
              {colorMasks.map((mask, i) => (
                <span key={i} className="w-4 h-4 rounded-full border border-stone-300"
                  style={{ backgroundColor: `hsl(${mask.hue}, ${mask.saturation}%, ${mask.lightness}%)` }}
                  title={`${Math.round(mask.hue)}° ±${mask.tolerance}`} />
              ))}
            </div>
            {(hasAdjustments || threshold !== 128) && (
              <button
                type="button"
                onClick={() => {
                  onThresholdChange?.(128);
                  onBrightnessChange?.(0);
                  onContrastChange?.(0);
                  onColorMasksChange?.([]);
                  onInvertChange?.(false);
                }}
                className="text-xs text-stone-500 hover:text-stone-800 underline"
              >
                Reset image options
              </button>
            )}
            {extraOptions}
          </More>
        </>
      )}
    </div>
    {pickerOpen && imageSource && onColorMasksChange && (
      <ColorPickerModal
        imageSource={imageSource}
        colorMasks={colorMasks}
        onColorMasksChange={onColorMasksChange}
        onClose={() => setPickerOpen(false)}
        threshold={threshold}
        brightness={brightness}
        contrast={contrast}
        invert={invert}
      />
    )}
    </>
  );
}
