"use client";

import {
  type DesignMode,
  type StampSettings,
  type ThreadConfig,
} from "@/types/stamp";
import SliderInput from "./SliderInput";

interface Props {
  settings: StampSettings;
  onChange: (settings: StampSettings) => void;
}

export default function StampSettingsPanel({ settings, onChange }: Props) {
  function update(partial: Partial<StampSettings>) {
    onChange({ ...settings, ...partial });
  }

  const maxThreadHeight = Math.max(settings.baseThickness - 2, 2);

  function updateThread(partial: Partial<ThreadConfig>) {
    onChange({ ...settings, threadConfig: { ...settings.threadConfig, ...partial } });
  }

  return (
    <div className="space-y-4 p-4 bg-white rounded-lg shadow">
      <h2 className="text-lg font-semibold">Stamp Settings</h2>

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

      <SliderInput label="Width" unit="mm" value={settings.width} min={10} max={200} step={1}
        onChange={(v) => update({ width: v })} />
      <SliderInput label="Height" unit="mm" value={settings.height} min={10} max={200} step={1}
        onChange={(v) => update({ height: v, autoSize: false })}
        disabled={settings.autoSize} />
      <SliderInput label="Base Thickness" unit="mm" value={settings.baseThickness} min={1} max={20} step={0.5}
        onChange={(v) => {
          const newMax = Math.max(v - 2, 2);
          const clampedThread = Math.min(settings.threadConfig.height, newMax);
          update({ baseThickness: v, threadConfig: { ...settings.threadConfig, height: clampedThread } });
        }} />
      <SliderInput label="Impression Depth" unit="mm" value={settings.impressionDepth} min={0.2} max={10} step={0.1}
        onChange={(v) => update({ impressionDepth: v })} />
      <SliderInput label="Corner Radius" unit="mm" value={settings.cornerRadius}
        min={0} max={Math.min(settings.width, settings.height) / 2} step={0.5}
        onChange={(v) => update({ cornerRadius: v })} />

      <div>
        <label className="block text-sm font-medium text-gray-700">Design Mode</label>
        <div className="mt-1 flex gap-2">
          {(["raised", "recessed"] as DesignMode[]).map((mode) => (
            <button
              key={mode}
              onClick={() => update({ designMode: mode })}
              className={`px-3 py-1.5 rounded text-sm font-medium capitalize ${
                settings.designMode === mode
                  ? "bg-amber-700 text-white"
                  : "bg-gray-100 text-gray-700 hover:bg-gray-200"
              }`}
            >
              {mode}
            </button>
          ))}
        </div>
      </div>

      <div className="border-t pt-4">
        <div className="flex items-center justify-between">
          <label className="text-sm font-medium text-gray-700">Handle Mount (M10×1.5)</label>
          <button
            onClick={() => update({ threadEnabled: !settings.threadEnabled })}
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
          <div className="mt-3 space-y-3">
            <SliderInput label="Tolerance" unit="mm" value={settings.threadConfig.tolerance}
              min={0} max={1.5} step={0.05}
              onChange={(v) => updateThread({ tolerance: v })} />
            <SliderInput label="Thread Height" unit="mm" value={Math.min(settings.threadConfig.height, maxThreadHeight)}
              min={4} max={maxThreadHeight} step={0.5} onChange={(v) => updateThread({ height: v })} />
          </div>
        )}
      </div>
    </div>
  );
}
