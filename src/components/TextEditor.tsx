"use client";

import { useRef } from "react";
import type { StampText, TextAlign } from "@/types/stamp";
import { loadCustomFont, type FontEntry } from "@/lib/font-manager";
import SliderInput from "./SliderInput";

interface Props {
  texts: StampText[];
  availableFonts: string[];
  hasImage: boolean;
  onChange: (texts: StampText[]) => void;
  onFontLoaded: (entry: FontEntry) => void;
}

export default function TextEditor({
  texts, availableFonts, hasImage, onChange, onFontLoaded,
}: Props) {
  const fontInputRef = useRef<HTMLInputElement>(null);
  const defaultFont = availableFonts[0] || "Nunito";

  function addText() {
    onChange([...texts, {
      content: "",
      fontSize: 5,
      fontFamily: defaultFont,
      letterSpacing: 0,
      align: texts.length === 0 ? "top" : "bottom",
    }]);
  }

  function updateText(index: number, partial: Partial<StampText>) {
    const updated = texts.map((t, i) => (i === index ? { ...t, ...partial } : t));
    onChange(updated);
  }

  function removeText(index: number) {
    onChange(texts.filter((_, i) => i !== index));
  }

  async function handleFontUpload(file: File) {
    try {
      const entry = await loadCustomFont(file);
      onFontLoaded(entry);
    } catch (e) {
      console.error("Failed to load font:", e);
    }
  }

  return (
    <div className="p-4 bg-white rounded-lg shadow space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h2 className="text-lg font-semibold">Text</h2>
        <div className="flex gap-2">
          <button
            onClick={() => fontInputRef.current?.click()}
            className="text-sm px-2 py-1.5 bg-gray-100 rounded hover:bg-gray-200"
          >
            Upload Font
          </button>
          <button
            onClick={addText}
            className="text-sm px-2 py-1.5 bg-gray-100 rounded hover:bg-gray-200"
          >
            + Add Text
          </button>
        </div>
      </div>

      <input
        ref={fontInputRef}
        type="file"
        accept=".ttf,.otf,.woff"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleFontUpload(file);
        }}
      />

      {texts.map((text, i) => (
        <div key={i} className="space-y-2 border-t pt-3">
          <div className="flex items-start gap-2">
            <textarea
              value={text.content}
              placeholder="Enter text..."
              rows={Math.max(2, text.content.split("\n").length)}
              onChange={(e) => updateText(i, { content: e.target.value })}
              className="flex-1 rounded border-gray-300 shadow-sm text-sm px-2 py-1.5 border resize-y"
            />
            <button
              onClick={() => removeText(i)}
              className="text-red-500 hover:text-red-700 text-sm mt-1"
            >
              Remove
            </button>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-xs text-gray-500">Font</label>
              <select
                value={text.fontFamily}
                onChange={(e) => updateText(i, { fontFamily: e.target.value })}
                className="w-full rounded border-gray-300 shadow-sm text-sm px-2 py-1 border"
              >
                {availableFonts.map((f) => (
                  <option key={f} value={f}>{f}</option>
                ))}
              </select>
            </div>

            {hasImage && (
              <div>
                <label className="block text-xs text-gray-500">Position</label>
                <select
                  value={text.align}
                  onChange={(e) => updateText(i, { align: e.target.value as TextAlign })}
                  className="w-full rounded border-gray-300 shadow-sm text-sm px-2 py-1 border"
                >
                  <option value="top">Above image</option>
                  <option value="bottom">Below image</option>
                </select>
              </div>
            )}
          </div>

          <SliderInput label="Size" unit="mm" value={text.fontSize} min={1} max={15} step={0.5}
            onChange={(v) => updateText(i, { fontSize: v })} />
          <SliderInput label="Letter Spacing" value={text.letterSpacing} min={0} max={5} step={0.1}
            onChange={(v) => updateText(i, { letterSpacing: v })} />
        </div>
      ))}

      {texts.length === 0 && (
        <p className="text-sm text-gray-400">No text added yet.</p>
      )}
    </div>
  );
}
