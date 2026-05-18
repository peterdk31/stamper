interface Props {
  label: string;
  unit?: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
  disabled?: boolean;
}

export default function SliderInput({
  label, unit, value, min, max, step = 1, onChange, disabled = false,
}: Props) {
  const decimals = step < 0.1 ? 2 : step < 1 ? 1 : 0;
  const display = value.toFixed(decimals);

  return (
    <div className={disabled ? "opacity-50" : ""}>
      <div className="flex items-baseline justify-between mb-1">
        <label className="text-sm font-medium text-gray-700">{label}</label>
        <span className="text-xs text-gray-500 tabular-nums">{display}{unit ? ` ${unit}` : ""}</span>
      </div>
      <input
        type="range"
        value={value}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-amber-700"
      />
    </div>
  );
}
