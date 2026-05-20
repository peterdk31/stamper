"use client";

import { useCallback, useRef } from "react";

interface Props {
  imageDataUrl: string | null;
  svgText: string | null;
  onImageChange: (dataUrl: string | null, fileName?: string) => void;
  onSvgChange: (svgText: string | null) => void;
  isProcessing?: boolean;
  progress?: number;
  progressStage?: string;
}

export default function ImageUpload({
  imageDataUrl, svgText,
  onImageChange, onSvgChange,
  isProcessing, progress = 0, progressStage = "",
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const isSvg = svgText !== null;

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
              // eslint-disable-next-line @next/next/no-img-element
              <img src={imageDataUrl} alt="Uploaded outline" className="mx-auto max-h-40 object-contain" />
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
    </div>
  );
}
