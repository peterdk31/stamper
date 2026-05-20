"use client";

import {
  type StampSettings,
  type ThreadConfig,
} from "@/types/stamp";
import SliderInput from "./SliderInput";

interface Props {
  settings: StampSettings;
  onChange: (settings: StampSettings) => void;
  onFindMinWidth?: () => void;
  thickenEnabled?: boolean;
  isThickening?: boolean;
  smoothEnabled?: boolean;
  isSmoothing?: boolean;
  hasDesign?: boolean;
  onThickenToggle?: () => void;
  onSmoothToggle?: () => void;
}

export default function StampSettingsPanel({ settings, onChange, onFindMinWidth, thickenEnabled, isThickening, smoothEnabled, isSmoothing, hasDesign, onThickenToggle, onSmoothToggle }: Props) {
  function update(partial: Partial<StampSettings>) {
    onChange({ ...settings, ...partial });
  }

  const minSize = settings.threadEnabled ? Math.max(10, settings.threadConfig.majorDiameter + 4) : 10;
  const minBaseThickness = settings.threadEnabled ? Math.max(3, settings.threadConfig.height) : 3;
  const maxThreadHeight = Math.max(settings.baseThickness - 2, 2);

  function updateThread(partial: Partial<ThreadConfig>) {
    onChange({ ...settings, threadConfig: { ...settings.threadConfig, ...partial } });
  }

  return (
    <div className="space-y-4 p-4 bg-white rounded-lg shadow">
      <h2 className="text-lg font-semibold">Stamp Settings</h2>

      <fieldset className="space-y-3">
        <legend className="text-xs font-semibold uppercase tracking-wide text-gray-500">Dimensions</legend>
        <SliderInput label="Width" unit="mm" value={settings.width} min={minSize} max={200} step={1}
          onChange={(v) => update({ width: v })}
          headerRight={onFindMinWidth ? (
            <button
              onClick={onFindMinWidth}
              title="Find smallest printable width for your nozzle"
              className="px-1.5 py-0.5 text-xs bg-gray-100 text-gray-700 rounded hover:bg-gray-200 font-medium"
            >
              Auto-fit
            </button>
          ) : undefined}
        />
        <SliderInput label="Height" unit="mm" value={settings.height} min={minSize} max={200} step={1}
          onChange={(v) => update({ height: v, autoSize: false })}
          disabled={settings.autoSize} />
        <div className="flex items-center justify-between">
          <label className="text-sm font-medium text-gray-700">Auto-size height</label>
          <button
            onClick={() => update({ autoSize: !settings.autoSize })}
            className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
              settings.autoSize ? "bg-amber-700" : "bg-gray-300"
            }`}
          >
            <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${
              settings.autoSize ? "translate-x-4.5" : "translate-x-0.5"
            }`} />
          </button>
        </div>
        {settings.autoSize && (
          <SliderInput label="Padding" unit="mm" value={settings.padding} min={0} max={20} step={0.5}
            onChange={(v) => update({ padding: v })} />
        )}
        <SliderInput label="Corner Radius" unit="mm" value={settings.cornerRadius}
          min={0} max={Math.min(settings.width, settings.height) / 2} step={0.5}
          onChange={(v) => update({ cornerRadius: v })} />
      </fieldset>

      <fieldset className="space-y-3 border-t pt-4">
        <legend className="text-xs font-semibold uppercase tracking-wide text-gray-500">Design</legend>
        <SliderInput label="Impression Depth" unit="mm" value={settings.impressionDepth} min={0.2} max={10} step={0.1}
          onChange={(v) => update({ impressionDepth: v })} />
        <div className="flex items-center justify-between">
          <label className={`text-sm font-medium ${hasDesign ? "text-gray-700" : "text-gray-400"}`}>
            {isSmoothing ? "Smoothing…" : "Smooth curves"}
          </label>
          <button
            onClick={onSmoothToggle}
            disabled={!hasDesign}
            className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
              smoothEnabled ? "bg-amber-700" : "bg-gray-300"
            } ${!hasDesign ? "opacity-50 cursor-not-allowed" : ""}`}
          >
            <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${
              smoothEnabled ? "translate-x-4.5" : "translate-x-0.5"
            }`} />
          </button>
        </div>
      </fieldset>

      <fieldset className="space-y-3 border-t pt-4">
        <legend className="text-xs font-semibold uppercase tracking-wide text-gray-500">Print Settings</legend>
        <SliderInput label="Base Thickness" unit="mm" value={settings.baseThickness} min={minBaseThickness} max={20} step={0.5}
          onChange={(v) => {
            const newMax = Math.max(v - 2, 2);
            const clampedThread = Math.min(settings.threadConfig.height, newMax);
            update({ baseThickness: v, threadConfig: { ...settings.threadConfig, height: clampedThread } });
          }} />
        <SliderInput label="Nozzle Diameter" unit="mm" value={settings.nozzleDiameter}
          min={0.1} max={1.5} step={0.05}
          onChange={(v) => update({ nozzleDiameter: v })} />
        <div className="flex items-center justify-between">
          <label className={`text-sm font-medium ${hasDesign ? "text-gray-700" : "text-gray-400"}`}>
            {isThickening ? "Thickening…" : "Thicken for nozzle"}
          </label>
          <button
            onClick={onThickenToggle}
            disabled={!hasDesign}
            className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
              thickenEnabled ? "bg-amber-700" : "bg-gray-300"
            } ${!hasDesign ? "opacity-50 cursor-not-allowed" : ""}`}
          >
            <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${
              thickenEnabled ? "translate-x-4.5" : "translate-x-0.5"
            }`} />
          </button>
        </div>
      </fieldset>

      <fieldset className="space-y-3 border-t pt-4">
        <legend className="text-xs font-semibold uppercase tracking-wide text-gray-500">Handle Mount</legend>
        <div className="flex items-center justify-between">
          <label className="text-sm font-medium text-gray-700 min-w-0">Handle Mount (M10×1.5)</label>
          <button
            onClick={() => {
              const enabling = !settings.threadEnabled;
              if (enabling) {
                const outerD = settings.threadConfig.majorDiameter + 4;
                const th = settings.threadConfig.height;
                update({
                  threadEnabled: true,
                  width: Math.max(settings.width, outerD),
                  height: Math.max(settings.height, outerD),
                  baseThickness: Math.max(settings.baseThickness, th),
                });
              } else {
                update({ threadEnabled: false });
              }
            }}
            className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
              settings.threadEnabled ? "bg-amber-700" : "bg-gray-300"
            }`}
          >
            <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${
              settings.threadEnabled ? "translate-x-4.5" : "translate-x-0.5"
            }`} />
          </button>
        </div>

        {settings.threadEnabled && (
          <div className="space-y-3">
            <SliderInput label="Tolerance" unit="mm" value={settings.threadConfig.tolerance}
              min={0} max={1.5} step={0.05}
              onChange={(v) => updateThread({ tolerance: v })} />
            <SliderInput label="Thread Height" unit="mm" value={Math.min(settings.threadConfig.height, maxThreadHeight)}
              min={4} max={maxThreadHeight} step={0.5} onChange={(v) => updateThread({ height: v })} />
          </div>
        )}
      </fieldset>
    </div>
  );
}
