"use client";

/** Small segmented picker, used for the dev-only algorithm choices. */
export function ChoiceButtons({ label, value, options, onChange }: {
  label: string;
  value: string;
  options: { id: string; label: string; title?: string }[];
  onChange: (id: string) => void;
}) {
  return (
    <div className="flex items-center gap-1 flex-wrap">
      <span className="text-xs text-gray-500 mr-1">{label}</span>
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          onClick={() => onChange(o.id)}
          title={o.title}
          aria-pressed={value === o.id}
          className={`px-2 py-0.5 rounded text-xs font-medium ${
            value === o.id ? "bg-amber-700 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
