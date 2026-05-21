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
  redWeight?: number;
  onRedWeightChange?: (value: number) => void;
  greenWeight?: number;
  onGreenWeightChange?: (value: number) => void;
  blueWeight?: number;
  onBlueWeightChange?: (value: number) => void;
  invert?: boolean;
  onInvertChange?: (value: boolean) => void;
}

interface LocalAdj {
  threshold: number;
  brightness: number;
  contrast: number;
  redWeight: number;
  greenWeight: number;
  blueWeight: number;
  invert: boolean;
}

function adjustPixel(value: number, brightness: number, contrastFactor: number, inv: boolean): number {
  if (inv) value = 255 - value;
  value += brightness;
  value = (value - 128) * contrastFactor + 128;
  return value < 0 ? 0 : value > 255 ? 255 : value;
}

export default function ImageUpload({
  imageDataUrl, svgText,
  onImageChange, onSvgChange,
  isProcessing, progress = 0, progressStage = "",
  threshold = 128, onThresholdChange,
  brightness = 0, onBrightnessChange,
  contrast = 0, onContrastChange,
  redWeight = 30, onRedWeightChange,
  greenWeight = 59, onGreenWeightChange,
  blueWeight = 11, onBlueWeightChange,
  invert = false, onInvertChange,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pixelCacheRef = useRef<ImageData | null>(null);
  const isDraggingRef = useRef(false);
  const localRef = useRef<LocalAdj>({ threshold, brightness, contrast, redWeight, greenWeight, blueWeight, invert });
  const propsRef = useRef<LocalAdj>({ threshold, brightness, contrast, redWeight, greenWeight, blueWeight, invert });

  useEffect(() => {
    propsRef.current = { threshold, brightness, contrast, redWeight, greenWeight, blueWeight, invert };
  }, [threshold, brightness, contrast, redWeight, greenWeight, blueWeight, invert]);

  const thresholdLabelRef = useRef<HTMLSpanElement>(null);
  const thresholdSliderRef = useRef<HTMLInputElement>(null);
  const brightnessLabelRef = useRef<HTMLSpanElement>(null);
  const brightnessSliderRef = useRef<HTMLInputElement>(null);
  const contrastLabelRef = useRef<HTMLSpanElement>(null);
  const contrastSliderRef = useRef<HTMLInputElement>(null);
  const redLabelRef = useRef<HTMLSpanElement>(null);
  const redSliderRef = useRef<HTMLInputElement>(null);
  const greenLabelRef = useRef<HTMLSpanElement>(null);
  const greenSliderRef = useRef<HTMLInputElement>(null);
  const blueLabelRef = useRef<HTMLSpanElement>(null);
  const blueSliderRef = useRef<HTMLInputElement>(null);

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
    const wSum = adj.redWeight + adj.greenWeight + adj.blueWeight;
    const wr = wSum > 0 ? adj.redWeight / wSum : 1/3;
    const wg = wSum > 0 ? adj.greenWeight / wSum : 1/3;
    const wb = wSum > 0 ? adj.blueWeight / wSum : 1/3;
    for (let i = 0; i < src.length; i += 4) {
      let r = src[i], g = src[i + 1], b = src[i + 2];
      if (hasAdj) {
        r = adjustPixel(r, adj.brightness, cf, adj.invert);
        g = adjustPixel(g, adj.brightness, cf, adj.invert);
        b = adjustPixel(b, adj.brightness, cf, adj.invert);
      }
      const lum = wr * r + wg * g + wb * b;
      const v = lum >= adj.threshold ? 255 : 0;
      dst[i] = dst[i + 1] = dst[i + 2] = v;
      dst[i + 3] = 255;
    }
    ctx.putImageData(out, 0, 0);
    if (thresholdLabelRef.current) thresholdLabelRef.current.textContent = String(adj.threshold);
    if (brightnessLabelRef.current) brightnessLabelRef.current.textContent = String(adj.brightness);
    if (contrastLabelRef.current) contrastLabelRef.current.textContent = String(adj.contrast);
    if (redLabelRef.current) redLabelRef.current.textContent = String(adj.redWeight);
    if (greenLabelRef.current) greenLabelRef.current.textContent = String(adj.greenWeight);
    if (blueLabelRef.current) blueLabelRef.current.textContent = String(adj.blueWeight);
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
      const adj = { threshold, brightness, contrast, redWeight, greenWeight, blueWeight, invert };
      drawPreview(adj);
      if (thresholdSliderRef.current) thresholdSliderRef.current.value = String(threshold);
      if (brightnessSliderRef.current) brightnessSliderRef.current.value = String(brightness);
      if (contrastSliderRef.current) contrastSliderRef.current.value = String(contrast);
      if (redSliderRef.current) redSliderRef.current.value = String(redWeight);
      if (greenSliderRef.current) greenSliderRef.current.value = String(greenWeight);
      if (blueSliderRef.current) blueSliderRef.current.value = String(blueWeight);
    }
  }, [threshold, brightness, contrast, redWeight, greenWeight, blueWeight, invert]);

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

  const hasContent = imageDataUrl || svgText;
  const showRasterControls = hasContent && onThresholdChange;
  const hasAdjustments = threshold !== 128 || brightness !== 0 || contrast !== 0 || redWeight !== 30 || greenWeight !== 59 || blueWeight !== 11 || invert;

  return (
    <div className="p-4 bg-white rounded-lg shadow space-y-3">
      <h2 className="text-lg font-semibold">Outline Image</h2>

      <div
        onDrop={handleDrop}
        onDragOver={(e) => e.preventDefault()}
        onClick={() => !isProcessing && inputRef.current?.click()}
        className={`relative border-2 border-dashed rounded-lg p-4 sm:p-6 text-center transition-colors ${
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
                className="max-h-32 max-w-[48%] object-contain"
              />
              <canvas ref={canvasRef} className="max-h-32 max-w-[48%]" />
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
                    onRedWeightChange?.(30);
                    onGreenWeightChange?.(59);
                    onBlueWeightChange?.(11);
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
                <p className="text-xs text-gray-500 mb-2">Channel mix — increase a color to filter it out</p>
                <div className="space-y-1">
                  <div className="flex justify-between text-sm text-gray-600">
                    <span>Red</span>
                    <span ref={redLabelRef}>{redWeight}</span>
                  </div>
                  <input
                    ref={redSliderRef}
                    type="range"
                    min={0}
                    max={100}
                    defaultValue={redWeight}
                    onPointerDown={startDrag}
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      localRef.current.redWeight = v;
                      redrawLocal();
                      if (!isDraggingRef.current) onRedWeightChange?.(v);
                    }}
                    onPointerUp={() => {
                      isDraggingRef.current = false;
                      onRedWeightChange?.(localRef.current.redWeight);
                    }}
                    className="w-full accent-red-500"
                  />
                </div>
                <div className="space-y-1">
                  <div className="flex justify-between text-sm text-gray-600">
                    <span>Green</span>
                    <span ref={greenLabelRef}>{greenWeight}</span>
                  </div>
                  <input
                    ref={greenSliderRef}
                    type="range"
                    min={0}
                    max={100}
                    defaultValue={greenWeight}
                    onPointerDown={startDrag}
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      localRef.current.greenWeight = v;
                      redrawLocal();
                      if (!isDraggingRef.current) onGreenWeightChange?.(v);
                    }}
                    onPointerUp={() => {
                      isDraggingRef.current = false;
                      onGreenWeightChange?.(localRef.current.greenWeight);
                    }}
                    className="w-full accent-green-500"
                  />
                </div>
                <div className="space-y-1">
                  <div className="flex justify-between text-sm text-gray-600">
                    <span>Blue</span>
                    <span ref={blueLabelRef}>{blueWeight}</span>
                  </div>
                  <input
                    ref={blueSliderRef}
                    type="range"
                    min={0}
                    max={100}
                    defaultValue={blueWeight}
                    onPointerDown={startDrag}
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      localRef.current.blueWeight = v;
                      redrawLocal();
                      if (!isDraggingRef.current) onBlueWeightChange?.(v);
                    }}
                    onPointerUp={() => {
                      isDraggingRef.current = false;
                      onBlueWeightChange?.(localRef.current.blueWeight);
                    }}
                    className="w-full accent-blue-500"
                  />
                </div>
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
