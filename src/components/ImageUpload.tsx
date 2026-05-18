"use client";

import { useCallback, useRef } from "react";

interface Props {
  imageDataUrl: string | null;
  svgText: string | null;
  simplification: number;
  onImageChange: (dataUrl: string | null) => void;
  onSvgChange: (svgText: string | null) => void;
  onSimplificationChange: (value: number) => void;
}

export default function ImageUpload({
  imageDataUrl, svgText, simplification,
  onImageChange, onSvgChange, onSimplificationChange,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const isSvg = svgText !== null;

  const handleFile = useCallback(
    (file: File) => {
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
          onImageChange(reader.result as string);
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
        onClick={() => inputRef.current?.click()}
        className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center cursor-pointer hover:border-amber-500 transition-colors"
      >
        {imageDataUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={imageDataUrl} alt="Uploaded outline" className="mx-auto max-h-40 object-contain" />
        ) : isSvg ? (
          <p className="text-sm text-gray-700">SVG loaded</p>
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

      {imageDataUrl && !isSvg && (
        <div>
          <label className="block text-sm font-medium text-gray-700">
            Simplification: {simplification.toFixed(2)}
          </label>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={simplification}
            onChange={(e) => onSimplificationChange(Number(e.target.value))}
            className="mt-1 w-full"
          />
          <div className="flex justify-between text-xs text-gray-400">
            <span>Detailed</span>
            <span>Simplified</span>
          </div>
        </div>
      )}

      {hasContent && (
        <button
          onClick={handleClear}
          className="text-sm text-red-600 hover:text-red-800"
        >
          Remove image
        </button>
      )}
    </div>
  );
}
