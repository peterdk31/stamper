"use client";

import { useRef, useState } from "react";
import type { StampText, TextAlign } from "@/types/stamp";
import { DEFAULT_FONT, loadCustomFont, type FontEntry } from "@/lib/font-manager";
import FontPicker from "./FontPicker";
import SliderInput from "./SliderInput";
import { More } from "./ui";

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
  // Entry whose font picker asked for the upload, so the new font is applied to it
  const uploadTargetRef = useRef<number | null>(null);
  const [fontError, setFontError] = useState<string | null>(null);
  const defaultFont = availableFonts[0] || DEFAULT_FONT;

  function addText() {
    onChange([...texts, {
      content: "",
      fontSize: 5,
      fontFamily: texts.at(-1)?.fontFamily ?? defaultFont,
      letterSpacing: 0,
      align: texts.length === 0 ? "top" : "bottom",
    }]);
  }

  function updateText(index: number, partial: Partial<StampText>) {
    onChange(texts.map((t, i) => (i === index ? { ...t, ...partial } : t)));
  }

  function removeText(index: number) {
    onChange(texts.filter((_, i) => i !== index));
  }

  async function handleFontUpload(file: File) {
    try {
      const entry = await loadCustomFont(file);
      onFontLoaded(entry);
      setFontError(null);
      const target = uploadTargetRef.current;
      if (target != null && target < texts.length) updateText(target, { fontFamily: entry.name });
    } catch (e) {
      console.error("Failed to load font:", e);
      setFontError(`Couldn't read ${file.name} as a font.`);
    }
  }

  return (
    <div className="space-y-3">
      <input
        ref={fontInputRef}
        type="file"
        accept=".ttf,.otf,.woff"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleFontUpload(file);
          e.target.value = "";
        }}
      />

      {texts.map((text, i) => (
        <div key={i} className="space-y-2 rounded border border-gray-200 p-2.5">
          <div className="flex items-start gap-2">
            <textarea
              value={text.content}
              placeholder="Enter text…"
              aria-label={`Text ${i + 1}`}
              rows={Math.max(1, text.content.split("\n").length)}
              onChange={(e) => updateText(i, { content: e.target.value })}
              className="flex-1 rounded border border-gray-300 text-sm px-2 py-1.5 resize-y"
            />
            <button
              type="button"
              onClick={() => removeText(i)}
              aria-label={`Remove text ${i + 1}`}
              title="Remove text"
              className="px-1.5 py-1 text-gray-400 hover:text-red-600"
            >
              ✕
            </button>
          </div>

          <FontPicker
            value={text.fontFamily}
            fonts={availableFonts}
            sample={text.content}
            onChange={(fontFamily) => updateText(i, { fontFamily })}
            onUpload={() => { uploadTargetRef.current = i; fontInputRef.current?.click(); }}
          />

          <SliderInput label="Size" unit="mm" value={text.fontSize} min={1} max={15} step={0.5}
            onChange={(v) => updateText(i, { fontSize: v })} />

          <More dot={text.letterSpacing !== 0}>
            <SliderInput label="Letter spacing" unit="mm" value={text.letterSpacing} min={0} max={5} step={0.1}
              onChange={(v) => updateText(i, { letterSpacing: v })} />
            {hasImage && (
              <div className="flex items-center justify-between gap-2">
                <label htmlFor={`text-pos-${i}`} className="text-sm font-medium text-gray-700">Position</label>
                <select
                  id={`text-pos-${i}`}
                  value={text.align}
                  onChange={(e) => updateText(i, { align: e.target.value as TextAlign })}
                  className="rounded border border-gray-300 text-sm px-2 py-1"
                >
                  <option value="top">Above image</option>
                  <option value="bottom">Below image</option>
                </select>
              </div>
            )}
          </More>
        </div>
      ))}

      {fontError && <p className="text-xs text-red-600">{fontError}</p>}

      <button
        type="button"
        onClick={addText}
        className="w-full rounded border border-dashed border-gray-300 py-1.5 text-sm text-gray-600 hover:border-amber-500 hover:text-amber-800"
      >
        + Add text
      </button>
    </div>
  );
}
