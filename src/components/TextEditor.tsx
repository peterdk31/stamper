"use client";

import { useRef, useState } from "react";
import type { StampText } from "@/types/stamp";
import { loadCustomFont, type FontEntry } from "@/lib/font-manager";
import {
  applyCircularLayout,
  applyStackedLayout,
  applyMonogramLayout,
  type LayoutPreset,
} from "@/lib/text-layouts";
import SliderInput from "./SliderInput";

interface Props {
  texts: StampText[];
  availableFonts: string[];
  stampWidth: number;
  stampHeight: number;
  onChange: (texts: StampText[]) => void;
  onFontLoaded: (entry: FontEntry) => void;
}

export default function TextEditor({
  texts, availableFonts, stampWidth, stampHeight, onChange, onFontLoaded,
}: Props) {
  const fontInputRef = useRef<HTMLInputElement>(null);
  const defaultFont = availableFonts[0] || "Helvetiker";
  const [presetInput, setPresetInput] = useState<{ type: LayoutPreset; value: string } | null>(null);

  function addText() {
    onChange([...texts, {
      content: "",
      fontSize: 5,
      fontFamily: defaultFont,
      letterSpacing: 0,
      x: 0,
      y: 0,
      rotation: 0,
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

  function applyPreset() {
    if (!presetInput || !presetInput.value.trim()) return;
    const text = presetInput.value.trim();
    const fontSize = 5;
    let result: StampText[];

    switch (presetInput.type) {
      case "circular":
        result = applyCircularLayout(text, fontSize, stampWidth, stampHeight, defaultFont);
        break;
      case "stacked":
        result = applyStackedLayout(text.replace(/\\n/g, "\n"), fontSize, stampWidth, stampHeight, defaultFont);
        break;
      case "monogram":
        result = applyMonogramLayout(text, fontSize, stampWidth, stampHeight, defaultFont);
        break;
    }

    onChange(result);
    setPresetInput(null);
  }

  return (
    <div className="p-4 bg-white rounded-lg shadow space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Text</h2>
        <div className="flex gap-2">
          <button
            onClick={() => fontInputRef.current?.click()}
            className="text-sm px-2 py-1 bg-gray-100 rounded hover:bg-gray-200"
          >
            Upload Font
          </button>
          <button
            onClick={addText}
            className="text-sm px-2 py-1 bg-gray-100 rounded hover:bg-gray-200"
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

      <div>
        <label className="block text-xs text-gray-500 mb-1">Presets</label>
        <div className="flex gap-1">
          {(["circular", "stacked", "monogram"] as LayoutPreset[]).map((type) => (
            <button
              key={type}
              onClick={() => setPresetInput({ type, value: "" })}
              className={`px-2 py-1 rounded text-xs font-medium capitalize ${
                presetInput?.type === type
                  ? "bg-amber-700 text-white"
                  : "bg-gray-100 text-gray-700 hover:bg-gray-200"
              }`}
            >
              {type}
            </button>
          ))}
        </div>
      </div>

      {presetInput && (
        <div className="border rounded p-2 space-y-2 bg-gray-50">
          <input
            type="text"
            value={presetInput.value}
            placeholder={
              presetInput.type === "stacked"
                ? "Line 1\\nLine 2 (use \\n for newlines)"
                : presetInput.type === "monogram"
                  ? "1-3 letters"
                  : "Enter text..."
            }
            onChange={(e) => setPresetInput({ ...presetInput, value: e.target.value })}
            className="w-full rounded border-gray-300 shadow-sm text-sm px-2 py-1.5 border"
            onKeyDown={(e) => { if (e.key === "Enter") applyPreset(); }}
          />
          <div className="flex gap-2">
            <button
              onClick={applyPreset}
              className="text-sm px-2 py-1 bg-amber-700 text-white rounded hover:bg-amber-800"
            >
              Apply
            </button>
            <button
              onClick={() => setPresetInput(null)}
              className="text-sm px-2 py-1 bg-gray-100 rounded hover:bg-gray-200"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {texts.map((text, i) => (
        <div key={i} className="space-y-2 border-t pt-3">
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={text.content}
              placeholder="Enter text..."
              onChange={(e) => updateText(i, { content: e.target.value })}
              className="flex-1 rounded border-gray-300 shadow-sm text-sm px-2 py-1.5 border"
            />
            <button
              onClick={() => removeText(i)}
              className="text-red-500 hover:text-red-700 text-sm"
            >
              Remove
            </button>
          </div>

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

          <SliderInput label="Letter Spacing" value={text.letterSpacing} min={0} max={5} step={0.1}
            onChange={(v) => updateText(i, { letterSpacing: v })} />
          <SliderInput label="X Offset" unit="mm" value={text.x} min={-20} max={20} step={0.5}
            onChange={(v) => updateText(i, { x: v })} />
          <SliderInput label="Y Offset" unit="mm" value={text.y} min={-20} max={20} step={0.5}
            onChange={(v) => updateText(i, { y: v })} />
        </div>
      ))}

      {texts.length === 0 && !presetInput && (
        <p className="text-sm text-gray-400">No text added yet.</p>
      )}
    </div>
  );
}
