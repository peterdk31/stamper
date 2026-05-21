"use client";

import { useCallback, useRef, useEffect } from "react";
import { TRACERS } from "@/lib/pipeline/registry";

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
  tracerAlgorithm?: string;
  onTracerChange?: (id: string) => void;
}

export default function ImageUpload({
  imageDataUrl, svgText,
  onImageChange, onSvgChange,
  isProcessing, progress = 0, progressStage = "",
  threshold = 128, onThresholdChange,
  tracerAlgorithm, onTracerChange,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pixelCacheRef = useRef<ImageData | null>(null);
  const isDraggingRef = useRef(false);
  const localThresholdRef = useRef(threshold);
  const thresholdRef = useRef(threshold);
  thresholdRef.current = threshold;
  const labelRef = useRef<HTMLSpanElement>(null);
  const sliderRef = useRef<HTMLInputElement>(null);

  function drawThreshold(t: number) {
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
    for (let i = 0; i < src.length; i += 4) {
      const lum = 0.299 * src[i] + 0.587 * src[i + 1] + 0.114 * src[i + 2];
      const v = lum >= t ? 255 : 0;
      dst[i] = dst[i + 1] = dst[i + 2] = v;
      dst[i + 3] = 255;
    }
    ctx.putImageData(out, 0, 0);
    if (labelRef.current) labelRef.current.textContent = String(t);
  }

  useEffect(() => {
    if (!imageDataUrl) { pixelCacheRef.current = null; return; }
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
      ctx.drawImage(img, 0, 0, w, h);
      pixelCacheRef.current = ctx.getImageData(0, 0, w, h);
      drawThreshold(thresholdRef.current);
    };
    img.src = imageDataUrl;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imageDataUrl]);

  useEffect(() => {
    if (!isDraggingRef.current) {
      drawThreshold(threshold);
      if (sliderRef.current) sliderRef.current.value = String(threshold);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threshold]);

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

  const hasContent = imageDataUrl || svgText;

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
            {imageDataUrl ? (
              <div className="flex gap-2 justify-center items-center">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={imageDataUrl} alt="Original" className="max-h-32 max-w-[48%] object-contain" />
                <canvas ref={canvasRef} className="max-h-32 max-w-[48%]" />
              </div>
            ) : (
              <div
                className="mx-auto max-h-40 overflow-hidden [&>svg]:max-h-40 [&>svg]:mx-auto [&>svg]:block"
                dangerouslySetInnerHTML={{ __html: svgText! }}
              />
            )}
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

      {imageDataUrl && !svgText && onThresholdChange && (
        <div className="space-y-1">
          <div className="flex justify-between text-sm text-gray-600">
            <span>Threshold</span>
            <span ref={labelRef}>{threshold}</span>
          </div>
          <input
            ref={sliderRef}
            type="range"
            min={1}
            max={255}
            defaultValue={threshold}
            onPointerDown={() => {
              isDraggingRef.current = true;
              localThresholdRef.current = threshold;
            }}
            onChange={(e) => {
              const v = Number(e.target.value);
              localThresholdRef.current = v;
              drawThreshold(v);
              if (!isDraggingRef.current) onThresholdChange(v);
            }}
            onPointerUp={() => {
              isDraggingRef.current = false;
              onThresholdChange(localThresholdRef.current);
            }}
            className="w-full accent-amber-500"
          />
        </div>
      )}

      {(imageDataUrl || svgText) && TRACERS.length > 1 && onTracerChange && (
        <div className="flex items-center gap-1">
          <span className="text-sm font-medium text-gray-700 mr-2">Tracer</span>
          {TRACERS.map((t) => (
            <button
              key={t.id}
              onClick={() => onTracerChange(t.id)}
              title={t.description}
              className={`px-2 py-0.5 rounded text-xs font-medium ${
                tracerAlgorithm === t.id
                  ? "bg-amber-700 text-white"
                  : "bg-gray-100 text-gray-600 hover:bg-gray-200"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
