"use client";

import { useState, useCallback, useRef, useEffect } from "react";

interface Props {
  imageDataUrl: string | null;
  svgText: string | null;
  onImageChange: (dataUrl: string | null, fileName?: string) => void;
  onSvgChange: (svgText: string | null) => void;
  isProcessing?: boolean;
  progress?: number;
  progressStage?: string;
  threshold?: number;
  onThresholdChange?: (value: number) => void;
  brightness?: number;
  onBrightnessChange?: (value: number) => void;
  contrast?: number;
  onContrastChange?: (value: number) => void;
  colorMasks?: number[];
  onColorMasksChange?: (value: number[]) => void;
  colorMaskTolerance?: number;
  onColorMaskToleranceChange?: (value: number) => void;
  invert?: boolean;
  onInvertChange?: (value: boolean) => void;
}

interface LocalAdj {
  threshold: number;
  brightness: number;
  contrast: number;
  colorMasks: number[];
  colorMaskTolerance: number;
  invert: boolean;
}

function adjustPixel(value: number, brightness: number, contrastFactor: number, inv: boolean): number {
  if (inv) value = 255 - value;
  value += brightness;
  value = (value - 128) * contrastFactor + 128;
  return value < 0 ? 0 : value > 255 ? 255 : value;
}

function rgbHue(r: number, g: number, b: number): number {
  const max = r > g ? (r > b ? r : b) : (g > b ? g : b);
  const min = r < g ? (r < b ? r : b) : (g < b ? g : b);
  const delta = max - min;
  if (delta === 0) return 0;
  let h: number;
  if (max === r) h = ((g - b) / delta) % 6;
  else if (max === g) h = (b - r) / delta + 2;
  else h = (r - g) / delta + 4;
  h *= 60;
  if (h < 0) h += 360;
  return h;
}

function isColorMasked(r: number, g: number, b: number, masks: number[], tolerance: number): boolean {
  if (masks.length === 0) return false;
  const h = rgbHue(r, g, b);
  for (let i = 0; i < masks.length; i++) {
    const d = Math.abs(h - masks[i]);
    if ((d > 180 ? 360 - d : d) <= tolerance) return true;
  }
  return false;
}

export default function ImageUpload({
  imageDataUrl, svgText,
  onImageChange, onSvgChange,
  isProcessing, progress = 0, progressStage = "",
  threshold = 128, onThresholdChange,
  brightness = 0, onBrightnessChange,
  contrast = 0, onContrastChange,
  colorMasks = [], onColorMasksChange,
  colorMaskTolerance = 30, onColorMaskToleranceChange,
  invert = false, onInvertChange,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pixelCacheRef = useRef<ImageData | null>(null);
  const isDraggingRef = useRef(false);
  const localRef = useRef<LocalAdj>({ threshold, brightness, contrast, colorMasks, colorMaskTolerance, invert });
  const propsRef = useRef<LocalAdj>({ threshold, brightness, contrast, colorMasks, colorMaskTolerance, invert });

  useEffect(() => {
    propsRef.current = { threshold, brightness, contrast, colorMasks, colorMaskTolerance, invert };
  }, [threshold, brightness, contrast, colorMasks, colorMaskTolerance, invert]);

  const thresholdLabelRef = useRef<HTMLSpanElement>(null);
  const thresholdSliderRef = useRef<HTMLInputElement>(null);
  const brightnessLabelRef = useRef<HTMLSpanElement>(null);
  const brightnessSliderRef = useRef<HTMLInputElement>(null);
  const contrastLabelRef = useRef<HTMLSpanElement>(null);
  const contrastSliderRef = useRef<HTMLInputElement>(null);
  const toleranceLabelRef = useRef<HTMLSpanElement>(null);
  const toleranceSliderRef = useRef<HTMLInputElement>(null);

  const [adjustOpen, setAdjustOpen] = useState(false);

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
      if (hasMasks && isColorMasked(r0, g0, b0, adj.colorMasks, adj.colorMaskTolerance)) {
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
    if (thresholdLabelRef.current) thresholdLabelRef.current.textContent = String(adj.threshold);
    if (brightnessLabelRef.current) brightnessLabelRef.current.textContent = String(adj.brightness);
    if (contrastLabelRef.current) contrastLabelRef.current.textContent = String(adj.contrast);
    if (toleranceLabelRef.current) toleranceLabelRef.current.textContent = adj.colorMaskTolerance + "°";
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
    if (!isDraggingRef.current) {
      const adj = { threshold, brightness, contrast, colorMasks, colorMaskTolerance, invert };
      drawPreview(adj);
      if (thresholdSliderRef.current) thresholdSliderRef.current.value = String(threshold);
      if (brightnessSliderRef.current) brightnessSliderRef.current.value = String(brightness);
      if (contrastSliderRef.current) contrastSliderRef.current.value = String(contrast);
      if (toleranceSliderRef.current) toleranceSliderRef.current.value = String(colorMaskTolerance);
    }
  }, [threshold, brightness, contrast, colorMasks, colorMaskTolerance, invert]);

  const handleFile = useCallback(
    (file: File) => {
      const baseName = file.name.replace(/\.[^.]+$/, "");
      if (file.type === "image/svg+xml" || file.name.endsWith(".svg")) {
        const reader = new FileReader();
        reader.onload = () => {
          onSvgChange(reader.result as string);
          onImageChange(null);
        };
        reader.readAsText(file);
      } else if (file.type.startsWith("image/")) {
        const reader = new FileReader();
        reader.onload = () => {
          onImageChange(reader.result as string, baseName);
          onSvgChange(null);
        };
        reader.readAsDataURL(file);
      }
    },
    [onImageChange, onSvgChange],
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
    onSvgChange(null);
  }

  function startDrag() {
    isDraggingRef.current = true;
    localRef.current = { ...propsRef.current };
  }

  function redrawLocal() {
    drawPreview(localRef.current);
  }

  function samplePixel(e: React.MouseEvent<HTMLImageElement>) {
    e.stopPropagation();
    const img = e.currentTarget;
    const rect = img.getBoundingClientRect();
    const srcData = pixelCacheRef.current;
    if (!srcData) return;

    const elemAspect = rect.width / rect.height;
    const imgAspect = srcData.width / srcData.height;
    let renderW: number, renderH: number, offsetX: number, offsetY: number;
    if (imgAspect > elemAspect) {
      renderW = rect.width;
      renderH = rect.width / imgAspect;
      offsetX = 0;
      offsetY = (rect.height - renderH) / 2;
    } else {
      renderH = rect.height;
      renderW = rect.height * imgAspect;
      offsetX = (rect.width - renderW) / 2;
      offsetY = 0;
    }

    const clickX = e.clientX - rect.left - offsetX;
    const clickY = e.clientY - rect.top - offsetY;
    if (clickX < 0 || clickY < 0 || clickX >= renderW || clickY >= renderH) return;

    const pixelX = Math.floor((clickX / renderW) * srcData.width);
    const pixelY = Math.floor((clickY / renderH) * srcData.height);
    const idx = (pixelY * srcData.width + pixelX) * 4;
    const r = srcData.data[idx], g = srcData.data[idx + 1], b = srcData.data[idx + 2];

    const hue = rgbHue(r, g, b);

    const current = propsRef.current.colorMasks;
    const tol = propsRef.current.colorMaskTolerance;
    const alreadyCovered = current.some((h) => {
      const d = Math.abs(h - hue);
      return (d > 180 ? 360 - d : d) <= tol;
    });
    if (!alreadyCovered) onColorMasksChange?.([...current, hue]);
  }

  const hasContent = imageDataUrl || svgText;
  const showRasterControls = hasContent && onThresholdChange;
  const hasAdjustments = threshold !== 128 || brightness !== 0 || contrast !== 0 || colorMasks.length > 0 || invert;

  return (
    <div className="p-4 bg-white rounded-lg shadow space-y-3">
      <h2 className="text-lg font-semibold">Outline Image</h2>

      <div
        onDrop={handleDrop}
        onDragOver={(e) => e.preventDefault()}
        onClick={() => !isProcessing && inputRef.current?.click()}
        className={`relative border-2 border-dashed rounded-lg p-2 text-center transition-colors ${
          isProcessing
            ? "border-amber-400 cursor-wait"
            : "border-gray-300 cursor-pointer hover:border-amber-500"
        }`}
      >
        {imageDataUrl || svgText ? (
          <div className="relative">
            <div className="flex gap-2 justify-center items-center">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={imageDataUrl ?? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgText!)}`}
                alt="Original"
                className="max-h-64 max-w-[48%] object-contain cursor-crosshair"
                onClick={samplePixel}
              />
              <canvas ref={canvasRef} className="max-h-64 max-w-[48%]" />
            </div>
            {isProcessing && (
              <div className="absolute inset-0 flex items-center justify-center bg-white/70">
                <div className="h-6 w-6 border-3 border-amber-500 border-t-transparent rounded-full animate-spin" />
              </div>
            )}
          </div>
        ) : isProcessing ? (
          <div className="space-y-3">
            <div className="flex justify-center">
              <div className="h-8 w-8 border-3 border-amber-500 border-t-transparent rounded-full animate-spin" />
            </div>
            <p className="text-sm text-gray-600">{progressStage}</p>
            <div className="w-full bg-gray-200 rounded-full h-2">
              <div
                className="bg-amber-500 h-2 rounded-full transition-all duration-300"
                style={{ width: `${Math.round(progress * 100)}%` }}
              />
            </div>
            <p className="text-xs text-gray-400">{Math.round(progress * 100)}%</p>
          </div>
        ) : (
          <p className="text-gray-500 text-sm">
            Drop an image or SVG here, or click to upload
          </p>
        )}
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="image/*,.svg"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleFile(file);
        }}
      />

      <div className="h-6">
        {hasContent && !isProcessing && (
          <button
            onClick={handleClear}
            className="text-sm text-red-600 hover:text-red-800"
          >
            Remove image
          </button>
        )}
      </div>

      {showRasterControls && (
        <div>
          <button
            type="button"
            onClick={() => setAdjustOpen((v) => !v)}
            className="flex items-center gap-1 text-sm text-gray-600 hover:text-gray-800"
          >
            <span className={`inline-block transition-transform ${adjustOpen ? "rotate-90" : ""}`}>&#9654;</span>
            <span>Image Adjustments</span>
            {hasAdjustments && <span className="ml-1 w-1.5 h-1.5 rounded-full bg-amber-500 inline-block" />}
          </button>

          {adjustOpen && (
            <div className="mt-2 space-y-3 pl-1">
              {hasAdjustments && (
                <button
                  type="button"
                  onClick={() => {
                    onThresholdChange?.(128);
                    onBrightnessChange?.(0);
                    onContrastChange?.(0);
                    onColorMasksChange?.([]);
                    onColorMaskToleranceChange?.(30);
                    onInvertChange?.(false);
                  }}
                  className="text-xs text-amber-600 hover:text-amber-800"
                >
                  Reset all
                </button>
              )}
              <div className="space-y-1">
                <div className="flex justify-between text-sm text-gray-600">
                  <span>Threshold</span>
                  <span ref={thresholdLabelRef}>{threshold}</span>
                </div>
                <input
                  ref={thresholdSliderRef}
                  type="range"
                  min={1}
                  max={255}
                  defaultValue={threshold}
                  onPointerDown={startDrag}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    localRef.current.threshold = v;
                    redrawLocal();
                    if (!isDraggingRef.current) onThresholdChange!(v);
                  }}
                  onPointerUp={() => {
                    isDraggingRef.current = false;
                    onThresholdChange!(localRef.current.threshold);
                  }}
                  className="w-full accent-amber-500"
                />
              </div>
              <div className="space-y-1">
                <div className="flex justify-between text-sm text-gray-600">
                  <span>Brightness</span>
                  <span ref={brightnessLabelRef}>{brightness}</span>
                </div>
                <input
                  ref={brightnessSliderRef}
                  type="range"
                  min={-100}
                  max={100}
                  defaultValue={brightness}
                  onPointerDown={startDrag}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    localRef.current.brightness = v;
                    redrawLocal();
                    if (!isDraggingRef.current) onBrightnessChange?.(v);
                  }}
                  onPointerUp={() => {
                    isDraggingRef.current = false;
                    onBrightnessChange?.(localRef.current.brightness);
                  }}
                  className="w-full accent-amber-500"
                />
              </div>
              <div className="space-y-1">
                <div className="flex justify-between text-sm text-gray-600">
                  <span>Contrast</span>
                  <span ref={contrastLabelRef}>{contrast}</span>
                </div>
                <input
                  ref={contrastSliderRef}
                  type="range"
                  min={-100}
                  max={100}
                  defaultValue={contrast}
                  onPointerDown={startDrag}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    localRef.current.contrast = v;
                    redrawLocal();
                    if (!isDraggingRef.current) onContrastChange?.(v);
                  }}
                  onPointerUp={() => {
                    isDraggingRef.current = false;
                    onContrastChange?.(localRef.current.contrast);
                  }}
                  className="w-full accent-amber-500"
                />
              </div>
              <div className="pt-1 border-t border-gray-200">
                <p className="text-xs text-gray-500 mb-1">Click the original image to sample a color to remove</p>
                {colorMasks.length > 0 && (
                  <>
                    <div className="flex flex-wrap gap-1.5 mt-1">
                      {colorMasks.map((hue, i) => (
                        <button
                          key={i}
                          type="button"
                          onClick={() => onColorMasksChange?.(colorMasks.filter((_, j) => j !== i))}
                          title="Click to remove"
                          className="w-6 h-6 rounded-full border border-gray-300 hover:border-red-400 hover:scale-110 transition-all"
                          style={{ backgroundColor: `hsl(${hue}, 70%, 50%)` }}
                        />
                      ))}
                    </div>
                    <div className="mt-2 space-y-1">
                      <div className="flex justify-between text-sm text-gray-600">
                        <span>Tolerance</span>
                        <span ref={toleranceLabelRef}>{colorMaskTolerance}&deg;</span>
                      </div>
                      <input
                        ref={toleranceSliderRef}
                        type="range"
                        min={5}
                        max={90}
                        defaultValue={colorMaskTolerance}
                        onPointerDown={startDrag}
                        onChange={(e) => {
                          const v = Number(e.target.value);
                          localRef.current.colorMaskTolerance = v;
                          redrawLocal();
                          if (!isDraggingRef.current) onColorMaskToleranceChange?.(v);
                        }}
                        onPointerUp={() => {
                          isDraggingRef.current = false;
                          onColorMaskToleranceChange?.(localRef.current.colorMaskTolerance);
                        }}
                        className="w-full accent-amber-500"
                      />
                    </div>
                  </>
                )}
              </div>
              <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
                <input
                  type="checkbox"
                  checked={invert}
                  onChange={(e) => onInvertChange?.(e.target.checked)}
                  className="accent-amber-500"
                />
                Invert
              </label>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
