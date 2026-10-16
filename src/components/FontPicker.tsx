"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { FONT_CATEGORIES, fontCategory, previewFontFamily } from "@/lib/font-manager";

interface Props {
  value: string;
  fonts: string[];
  /** Text drawn in each font; falls back to the font name when empty. */
  sample: string;
  onChange: (font: string) => void;
  /** Adds an "Upload font…" entry at the end of the list. */
  onUpload?: () => void;
}

/** Font dropdown where every option is rendered in its own font. */
export default function FontPicker({ value, fonts, sample, onChange, onUpload }: Props) {
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const sampleLine = sample.split("\n").find((l) => l.trim())?.trim() ?? "";

  // Grouped by category, flattened so arrow keys walk the visible order
  const groups = useMemo(
    () => FONT_CATEGORIES
      .map((category) => ({ category, fonts: fonts.filter((f) => fontCategory(f) === category) }))
      .filter((g) => g.fonts.length > 0),
    [fonts],
  );
  const ordered = useMemo(() => groups.flatMap((g) => g.fonts), [groups]);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    listRef.current
      ?.querySelector(`[data-index="${highlighted}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [open, highlighted]);

  function openList() {
    setHighlighted(Math.max(0, ordered.indexOf(value)));
    setOpen(true);
  }

  function select(font: string) {
    onChange(font);
    setOpen(false);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (!open) {
      if (["ArrowDown", "ArrowUp", "Enter", " "].includes(e.key)) {
        e.preventDefault();
        openList();
      }
      return;
    }
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setHighlighted((h) => Math.min(ordered.length - 1, h + 1));
        break;
      case "ArrowUp":
        e.preventDefault();
        setHighlighted((h) => Math.max(0, h - 1));
        break;
      case "Enter":
      case " ":
        e.preventDefault();
        if (ordered[highlighted]) select(ordered[highlighted]);
        break;
      case "Escape":
      case "Tab":
        setOpen(false);
        break;
    }
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => (open ? setOpen(false) : openList())}
        onKeyDown={onKeyDown}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="w-full flex items-center justify-between gap-1 rounded border border-stone-300 shadow-sm bg-white text-sm px-2 py-1 text-left"
      >
        <span className="truncate" style={{ fontFamily: `${previewFontFamily(value)}, sans-serif` }}>
          {value}
        </span>
        <span className="text-stone-400 text-xs">▾</span>
      </button>

      {open && (
        <ul
          ref={listRef}
          role="listbox"
          className="absolute z-20 mt-1 w-64 max-h-80 overflow-y-auto rounded border border-stone-300 bg-white shadow-lg py-1"
        >
          {groups.map((group) => (
            <li key={group.category} role="presentation">
              <div className="px-2 pt-2 pb-0.5 text-[10px] uppercase tracking-wide text-stone-400">
                {group.category}
              </div>
              <ul role="group">
                {group.fonts.map((font) => {
                  const index = ordered.indexOf(font);
                  return (
                    <li
                      key={font}
                      role="option"
                      aria-selected={font === value}
                      data-index={index}
                      onPointerEnter={() => setHighlighted(index)}
                      onClick={() => select(font)}
                      className={`px-2 py-1 cursor-pointer ${index === highlighted ? "bg-stone-100" : ""} ${font === value ? "font-semibold" : ""}`}
                    >
                      <div
                        className="text-lg leading-tight truncate"
                        style={{ fontFamily: `${previewFontFamily(font)}, sans-serif`, fontWeight: "normal" }}
                      >
                        {sampleLine || font}
                      </div>
                      {sampleLine && <div className="text-[10px] text-stone-500">{font}</div>}
                    </li>
                  );
                })}
              </ul>
            </li>
          ))}
          {onUpload && (
            <li role="presentation" className="border-t border-stone-200 mt-1 pt-1">
              <button
                type="button"
                onClick={() => { setOpen(false); onUpload(); }}
                className="w-full px-2 py-1.5 text-left text-sm text-accent-700 hover:bg-stone-100"
              >
                Upload font (.ttf, .otf)…
              </button>
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
