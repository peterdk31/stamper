"use client";

import { createContext, useContext, useEffect, useRef, useState } from "react";

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
        checked ? "bg-accent-600" : "bg-stone-300"
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
    <div className="flex min-h-8 items-center justify-between gap-2">
      <span className={`text-sm ${disabled ? "text-stone-400" : "text-stone-700"}`}>{label}</span>
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

/**
 * How the sidebar sections are shown: an accordion (desktop — several open at
 * once) or tabs (phone — one section at a time, picked from a tab bar).
 * `focus` asks a section to show itself, e.g. "Enlarge stamp" → Size.
 */
export interface SectionsState {
  mode: "accordion" | "tabs";
  /** Visible section in tabs mode. */
  active: string;
  focus: { id: string; n: number } | null;
}

export const SectionsContext = createContext<SectionsState>({ mode: "accordion", active: "", focus: null });

/** Collapsible sidebar section. Shows `summary` in the header while closed. */
export function Section({ id, title, summary, defaultOpen = false, openWhen, headerRight, children }: {
  id: string;
  title: string;
  summary?: React.ReactNode;
  defaultOpen?: boolean;
  /** Opens the section whenever this turns true (e.g. its feature was just switched on). */
  openWhen?: boolean;
  /** Control in the header (e.g. an on/off toggle) that works without opening the section. */
  headerRight?: React.ReactNode;
  children: React.ReactNode;
}) {
  const { mode, active, focus } = useContext(SectionsContext);
  const ref = useRef<HTMLElement>(null);
  const [open, setOpen] = useState(defaultOpen);
  const [prevOpenWhen, setPrevOpenWhen] = useState(openWhen);
  if (openWhen !== prevOpenWhen) {
    setPrevOpenWhen(openWhen);
    if (openWhen) setOpen(true);
  }
  const [prevFocus, setPrevFocus] = useState(focus);
  if (focus !== prevFocus) {
    setPrevFocus(focus);
    if (focus?.id === id) setOpen(true);
  }
  useEffect(() => {
    if (focus?.id === id) ref.current?.scrollIntoView({ block: "start" });
  }, [focus, id]);

  if (mode === "tabs") {
    if (active !== id) return null;
    return (
      <section ref={ref} className="space-y-3 p-4">
        {headerRight && (
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-stone-800">{title}</h2>
            {headerRight}
          </div>
        )}
        {children}
      </section>
    );
  }

  return (
    <section ref={ref} id={id} className="border-b border-stone-200 scroll-mt-2">
      <div className="flex items-center gap-2 px-4 py-2.5">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="flex flex-1 min-w-0 items-center gap-2 text-left"
        >
          <span className="text-stone-400"><Chevron open={open} /></span>
          <h2 className="text-sm font-semibold text-stone-800 shrink-0">{title}</h2>
          {!open && summary && <span className="text-xs text-stone-500 truncate">{summary}</span>}
        </button>
        {headerRight}
      </div>
      {open && <div className="px-4 pb-4 pt-0.5 space-y-2.5">{children}</div>}
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
        className="flex items-center gap-1 py-1 text-xs font-medium text-stone-500 hover:text-stone-800"
      >
        <Chevron open={open} />
        {label}
        {dot && <span className="ml-1 w-1.5 h-1.5 rounded-full bg-accent-600 inline-block" />}
      </button>
      {open && <div className="mt-2 space-y-2.5 pl-3 border-l-2 border-stone-100">{children}</div>}
    </div>
  );
}

export function Hint({ children, tone = "muted" }: { children: React.ReactNode; tone?: "muted" | "error" }) {
  return <p className={`text-xs ${tone === "error" ? "text-red-600" : "text-stone-500"}`}>{children}</p>;
}

/** Square toolbar button with an icon; `pressed` shows it as switched on. */
export function IconButton({ onClick, title, pressed, children }: {
  onClick: () => void;
  title: string;
  pressed?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      aria-pressed={pressed}
      className={`flex h-8 w-8 items-center justify-center rounded ${
        pressed ? "bg-accent-600 text-white" : "text-stone-600 hover:bg-stone-200 hover:text-stone-900"
      }`}
    >
      {children}
    </button>
  );
}

/** Button that opens a small list of actions below it. */
export function Menu({ button, align = "right", children }: {
  /** Renders the trigger; call `toggle` from its onClick. */
  button: (toggle: () => void, open: boolean) => React.ReactNode;
  align?: "left" | "right";
  /** Menu items; call `close` after acting. */
  children: (close: () => void) => React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);
  return (
    <div ref={rootRef} className="relative">
      {button(() => setOpen((v) => !v), open)}
      {open && (
        <div role="menu" className={`absolute top-full z-50 mt-1 min-w-44 rounded border border-stone-200 bg-white py-1 shadow-lg ${
          align === "right" ? "right-0" : "left-0"
        }`}>
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

export function MenuItem({ onClick, title, children }: { onClick: () => void; title?: string; children: React.ReactNode }) {
  return (
    <button type="button" role="menuitem" onClick={onClick} title={title}
      className="block w-full px-3 py-2 text-left text-sm text-stone-700 hover:bg-stone-100">
      {children}
    </button>
  );
}
