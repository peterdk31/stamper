import { useState, useRef, useCallback, useEffect } from "react";

interface Props {
  label?: string;
  unit?: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
  disabled?: boolean;
  headerRight?: React.ReactNode;
  /** Called on every drag movement (before commit), for cheap live previews. */
  onInput?: (v: number) => void;
}

export default function SliderInput({
  label, unit, value, min, max, step = 1, onChange, disabled = false, headerRight, onInput,
}: Props) {
  const [localValue, setLocalValue] = useState(value);
  const [draft, setDraft] = useState<string | null>(null);
  const dragging = useRef(false);
  const localValueRef = useRef(value);

  useEffect(() => {
    if (!dragging.current) setLocalValue(value);
  }, [value]);

  useEffect(() => {
    localValueRef.current = localValue;
  }, [localValue]);

  const commit = useCallback(() => {
    if (!dragging.current) return;
    dragging.current = false;
    onChange(localValueRef.current);
  }, [onChange]);

  const decimals = step < 0.1 ? 2 : step < 1 ? 1 : 0;
  const display = localValue.toFixed(decimals);

  // Typed values may go past the slider's range only where the range is a soft
  // limit; clamp to it so every value is one the slider could also produce.
  function commitDraft() {
    if (draft == null) return;
    const v = Number(draft.replace(",", "."));
    setDraft(null);
    if (!Number.isFinite(v)) return;
    const clamped = Math.min(max, Math.max(min, v));
    const rounded = Math.round(clamped / step) * step;
    const fixed = Number(rounded.toFixed(decimals));
    setLocalValue(fixed);
    if (fixed !== value) onChange(fixed);
  }

  return (
    <div className={disabled ? "opacity-50" : ""}>
      {(label != null || headerRight) && (
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-baseline gap-2 min-w-0">
            {label != null && <label className="text-sm font-medium text-gray-700">{label}</label>}
            {headerRight}
          </div>
          <span className="flex items-center gap-1 text-xs text-gray-500 shrink-0">
            <input
              type="text"
              inputMode="decimal"
              aria-label={label}
              disabled={disabled}
              value={draft ?? display}
              onFocus={(e) => { setDraft(display); e.target.select(); }}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commitDraft}
              onKeyDown={(e) => {
                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                if (e.key === "Escape") { setDraft(null); (e.target as HTMLInputElement).blur(); }
              }}
              className="w-14 rounded border border-gray-200 px-1 py-0.5 text-right tabular-nums text-gray-800 hover:border-gray-400 focus:border-amber-600 focus:outline-none"
            />
            {unit && <span className="w-5">{unit}</span>}
          </span>
        </div>
      )}
      <input
        type="range"
        value={localValue}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        aria-label={label}
        onPointerDown={() => { dragging.current = true; }}
        onChange={(e) => {
          const v = Number(e.target.value);
          setLocalValue(v);
          onInput?.(v);
          if (!dragging.current) onChange(v);
        }}
        onPointerUp={commit}
        onLostPointerCapture={commit}
        className="w-full accent-amber-700"
      />
    </div>
  );
}
