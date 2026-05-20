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
}

export default function SliderInput({
  label, unit, value, min, max, step = 1, onChange, disabled = false, headerRight,
}: Props) {
  const [localValue, setLocalValue] = useState(value);
  const dragging = useRef(false);
  const localValueRef = useRef(value);

  useEffect(() => {
    if (!dragging.current) setLocalValue(value);
  }, [value]);

  useEffect(() => {
    localValueRef.current = localValue;
  }, [localValue]);

  const commit = useCallback(() => {
    dragging.current = false;
    onChange(localValueRef.current);
  }, [onChange]);

  const decimals = step < 0.1 ? 2 : step < 1 ? 1 : 0;
  const display = localValue.toFixed(decimals);

  return (
    <div className={disabled ? "opacity-50" : ""}>
      {(label != null || headerRight) && (
        <div className="flex items-baseline justify-between mb-1">
          <div className="flex items-baseline gap-2">
            {label != null && <label className="text-sm font-medium text-gray-700">{label}</label>}
            {headerRight}
          </div>
          <span className="text-xs text-gray-500 tabular-nums">{display}{unit ? ` ${unit}` : ""}</span>
        </div>
      )}
      <input
        type="range"
        value={localValue}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        onPointerDown={() => { dragging.current = true; }}
        onChange={(e) => {
          const v = Number(e.target.value);
          setLocalValue(v);
          if (!dragging.current) onChange(v);
        }}
        onPointerUp={commit}
        onLostPointerCapture={commit}
        className="w-full accent-amber-700"
      />
    </div>
  );
}
