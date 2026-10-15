"use client";

import { useState } from "react";

/** On/off switch. */
export function Toggle({ checked, onChange, disabled, label }: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full ${
        checked ? "bg-amber-700" : "bg-gray-300"
      } ${disabled ? "opacity-50 cursor-not-allowed" : ""}`}
    >
      <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white ${
        checked ? "translate-x-4.5" : "translate-x-0.5"
      }`} />
    </button>
  );
}

/** Label on the left, toggle on the right. */
export function ToggleRow({ label, checked, onChange, disabled }: {
  label: React.ReactNode;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className={`text-sm font-medium ${disabled ? "text-gray-400" : "text-gray-700"}`}>{label}</span>
      <Toggle checked={checked} onChange={onChange} disabled={disabled}
        label={typeof label === "string" ? label : "Toggle"} />
    </div>
  );
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg className={`w-3.5 h-3.5 shrink-0 ${open ? "rotate-90" : ""}`}
      fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
    </svg>
  );
}

/** Collapsible sidebar section. Shows `summary` in the header while closed. */
export function Section({ id, title, summary, defaultOpen = false, openWhen, headerRight, children }: {
  id?: string;
  title: string;
  summary?: React.ReactNode;
  defaultOpen?: boolean;
  /** Opens the section whenever this turns true (e.g. its feature was just switched on). */
  openWhen?: boolean;
  /** Control in the header (e.g. an on/off toggle) that works without opening the section. */
  headerRight?: React.ReactNode;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [prevOpenWhen, setPrevOpenWhen] = useState(openWhen);
  if (openWhen !== prevOpenWhen) {
    setPrevOpenWhen(openWhen);
    if (openWhen) setOpen(true);
  }
  return (
    <section id={id} className="bg-white rounded-lg shadow scroll-mt-4">
      <div className="flex items-center gap-2 px-4 py-3">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="flex flex-1 min-w-0 items-center gap-2 text-left"
        >
          <span className="text-gray-500"><Chevron open={open} /></span>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-800 shrink-0">{title}</h2>
          {!open && summary && <span className="text-xs text-gray-500 truncate">{summary}</span>}
        </button>
        {headerRight}
      </div>
      {open && <div className="px-4 pb-4 space-y-3">{children}</div>}
    </section>
  );
}

/** Inline disclosure for the less common settings inside a section. */
export function More({ label = "More", dot, children }: {
  label?: string;
  /** Show a marker when something inside differs from its default. */
  dot?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex items-center gap-1 text-xs font-medium text-gray-500 hover:text-gray-800"
      >
        <Chevron open={open} />
        {label}
        {dot && <span className="ml-1 w-1.5 h-1.5 rounded-full bg-amber-600 inline-block" />}
      </button>
      {open && <div className="mt-3 space-y-3 pl-3 border-l-2 border-gray-100">{children}</div>}
    </div>
  );
}

export function Hint({ children, tone = "muted" }: { children: React.ReactNode; tone?: "muted" | "error" }) {
  return <p className={`text-xs ${tone === "error" ? "text-red-600" : "text-gray-500"}`}>{children}</p>;
}
