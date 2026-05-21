"use client";

import { useRef, useEffect, useCallback } from "react";
import type { ColorMask } from "@/types/stamp";

interface Props {
  imageSource: string;
  colorMasks: ColorMask[];
  onColorMasksChange: (masks: ColorMask[]) => void;
  onClose: () => void;
  threshold: number;
  brightness: number;
  contrast: number;
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

export default function ColorPickerModal({
  imageSource, colorMasks, onColorMasksChange, onClose,
  threshold, brightness, contrast, invert,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pixelCacheRef = useRef<ImageData | null>(null);
  const masksRef = useRef(colorMasks);
  masksRef.current = colorMasks;

  const drawPreview = useCallback(() => {
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
    const hasAdj = brightness !== 0 || contrast !== 0 || invert;
    const cf = (259 * (contrast + 255)) / (255 * (259 - contrast));
    const masks = masksRef.current;
    const hasMasks = masks.length > 0;
    for (let i = 0; i < src.length; i += 4) {
      const r0 = src[i], g0 = src[i + 1], b0 = src[i + 2];
      if (hasMasks && isColorMasked(r0, g0, b0, masks)) {
        dst[i] = dst[i + 1] = dst[i + 2] = 255;
        dst[i + 3] = 255;
        continue;
      }
      let r = r0, g = g0, b = b0;
      if (hasAdj) {
        r = adjustPixel(r, brightness, cf, invert);
        g = adjustPixel(g, brightness, cf, invert);
        b = adjustPixel(b, brightness, cf, invert);
      }
      const lum = 0.299 * r + 0.587 * g + 0.114 * b;
      const v = lum >= threshold ? 255 : 0;
      dst[i] = dst[i + 1] = dst[i + 2] = v;
      dst[i + 3] = 255;
    }
    ctx.putImageData(out, 0, 0);
  }, [threshold, brightness, contrast, invert]);

  useEffect(() => {
    const img = new window.Image();
    img.onload = () => {
      const maxDim = 1200;
      const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
      const w = Math.round(img.width * scale);
      const h = Math.round(img.height * scale);
      const off = document.createElement("canvas");
      off.width = w;
      off.height = h;
      const ctx = off.getContext("2d")!;
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(img, 0, 0, w, h);
      pixelCacheRef.current = ctx.getImageData(0, 0, w, h);
      drawPreview();
    };
    img.src = imageSource;
  }, [imageSource, drawPreview]);

  useEffect(() => {
    drawPreview();
  }, [colorMasks, drawPreview]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

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
    const [hue, sat, lit] = rgbToHsl(r, g, b);

    const current = masksRef.current;
    const alreadyCovered = current.some((m) =>
      hslDist(m.hue, m.saturation, m.lightness, hue, sat, lit) <= m.tolerance
    );
    if (!alreadyCovered) {
      onColorMasksChange([...current, { hue, saturation: sat, lightness: lit, tolerance: 30 }]);
    }
  }

  function removeMask(index: number) {
    onColorMasksChange(colorMasks.filter((_, i) => i !== index));
  }

  function updateTolerance(index: number, tolerance: number) {
    onColorMasksChange(colorMasks.map((m, i) => i === index ? { ...m, tolerance } : m));
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-white rounded-lg max-w-5xl w-full max-h-[90vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
          <h2 className="text-lg font-semibold">Color Picker</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-2xl leading-none">&times;</button>
        </div>

        <div className="flex-1 overflow-auto p-4 space-y-4">
          <p className="text-sm text-gray-500">Click the original image to sample a color to remove</p>
          <div className="flex gap-4 justify-center items-start">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={imageSource}
              alt="Original"
              className="max-h-[60vh] max-w-[48%] object-contain cursor-crosshair rounded"
              onClick={samplePixel}
            />
            <canvas ref={canvasRef} className="max-h-[60vh] max-w-[48%] rounded" />
          </div>

          {colorMasks.length > 0 && (
            <div className="space-y-2">
              {colorMasks.map((mask, i) => (
                <div key={i} className="flex items-center gap-3">
                  <div
                    className="w-6 h-6 rounded-full border border-gray-300 shrink-0"
                    style={{ backgroundColor: `hsl(${mask.hue}, ${mask.saturation}%, ${mask.lightness}%)` }}
                  />
                  <input
                    type="range"
                    min={5}
                    max={90}
                    value={mask.tolerance}
                    onChange={(e) => updateTolerance(i, Number(e.target.value))}
                    className="flex-1 accent-amber-500"
                  />
                  <span className="text-sm text-gray-600 w-10 text-right">{mask.tolerance}&deg;</span>
                  <button
                    onClick={() => removeMask(i)}
                    className="text-gray-400 hover:text-red-500 text-lg leading-none"
                    title="Remove"
                  >&times;</button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
