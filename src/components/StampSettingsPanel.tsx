"use client";

import { useState } from "react";
import {
  type CutterConfig,
  type StampSettings,
  type ThreadConfig,
} from "@/types/stamp";
import SliderInput from "./SliderInput";
import { STEP_SLOTS, TRACERS } from "@/lib/pipeline/registry";

interface Props {
  settings: StampSettings;
  onChange: (settings: StampSettings) => void;
  thickenEnabled?: boolean;
  isThickening?: boolean;
  hasDesign?: boolean;
  onThickenToggle?: () => void;
  thickenAlgorithm?: string;
  onThickenAlgorithmChange?: (id: string) => void;
  tracerAlgorithm?: string;
  onTracerChange?: (id: string) => void;
  hasImage?: boolean;
}

const thickenSlot = STEP_SLOTS.find((s) => s.id === "thicken");

export default function StampSettingsPanel({ settings, onChange, thickenEnabled, isThickening, hasDesign, onThickenToggle, thickenAlgorithm, onThickenAlgorithmChange, tracerAlgorithm, onTracerChange, hasImage }: Props) {
  const [advancedOpen, setAdvancedOpen] = useState(false);

  function update(partial: Partial<StampSettings>) {
    onChange({ ...settings, ...partial });
  }

  const minSize = settings.threadEnabled ? Math.max(10, settings.threadConfig.majorDiameter + 4) : 10;
  const minBaseThickness = settings.threadEnabled ? Math.max(3, settings.threadConfig.height) : 3;
  const maxThreadHeight = Math.max(settings.baseThickness - 2, 2);

  function updateThread(partial: Partial<ThreadConfig>) {
    onChange({ ...settings, threadConfig: { ...settings.threadConfig, ...partial } });
  }

  function updateCutter(partial: Partial<CutterConfig>) {
    onChange({ ...settings, cutterConfig: { ...settings.cutterConfig, ...partial } });
  }

  const cutter = settings.cutterConfig;
  const reliefTooDeep = settings.impressionDepth > cutter.clayThickness;

  return (
    <div className="space-y-4 p-4 bg-white rounded-lg shadow">
      <h2 className="text-lg font-semibold">Stamp Settings</h2>

      <fieldset className="space-y-3">
        <legend className="text-xs font-semibold uppercase tracking-wide text-gray-500">Design area</legend>
        <div className="flex items-center gap-1 text-sm">
          <span className="text-sm font-medium text-gray-700 mr-2">Fit to</span>
          {(["width", "height", "off"] as const).map((dim) => (
            <button
              key={dim}
              onClick={() => update({ fitDimension: dim })}
              className={`px-2 py-0.5 rounded text-xs font-medium ${
                settings.fitDimension === dim
                  ? "bg-amber-700 text-white"
                  : "bg-gray-100 text-gray-600 hover:bg-gray-200"
              }`}
            >
              {dim === "off" ? "Manual" : dim.charAt(0).toUpperCase() + dim.slice(1)}
            </button>
          ))}
        </div>
        <SliderInput label="Width" unit="mm" value={settings.width} min={minSize} max={200} step={1}
          onChange={(v) => update({ width: v })}
          disabled={settings.fitDimension === "height"}
        />
        <SliderInput label="Height" unit="mm" value={settings.height} min={minSize} max={200} step={1}
          onChange={(v) => update({ height: v })}
          disabled={settings.fitDimension === "width"} />
        <p className="text-xs text-gray-500">
          Plate: {((settings.width + settings.margin * 2) / 10).toFixed(1)} × {((settings.height + settings.margin * 2) / 10).toFixed(1)} cm
          {" "}(design area + 2 × {settings.margin} mm margin)
        </p>
      </fieldset>

      <fieldset className="space-y-3 border-t pt-3">
        <legend className="sr-only">Clay cutter</legend>
        <div className="flex items-center justify-between">
          <label className="text-sm font-medium text-gray-700 min-w-0">Clay cutter</label>
          <button
            onClick={() => update({ cutterEnabled: !settings.cutterEnabled })}
            className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
              settings.cutterEnabled ? "bg-amber-700" : "bg-gray-300"
            }`}
          >
            <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${
              settings.cutterEnabled ? "translate-x-4.5" : "translate-x-0.5"
            }`} />
          </button>
        </div>
        {settings.cutterEnabled && (
          <div className="space-y-3">
            <p className="text-xs text-gray-500">
              The stamp base follows the design, and a separate ring cuts the clay tile around it.
              Use them in either order: the ring slides over the stamp.
            </p>
            <SliderInput label="Outline fidelity" value={cutter.fidelity} min={0} max={100} step={5}
              headerRight={<span className="text-xs text-gray-500">
                {cutter.fidelity === 0 ? "rectangle" : cutter.fidelity <= 50 ? "rounder" : cutter.fidelity === 100 ? "follows design" : "smoothed"}
              </span>}
              onChange={(v) => updateCutter({ fidelity: v })} />
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input type="checkbox" checked={cutter.sharpCorners}
                onChange={(e) => updateCutter({ sharpCorners: e.target.checked })} />
              Sharp corners
            </label>
            <SliderInput label="Clay thickness" unit="mm" value={cutter.clayThickness} min={2} max={20} step={0.5}
              onChange={(v) => updateCutter({ clayThickness: v })} />
            {reliefTooDeep ? (
              <p className="text-xs text-red-600">
                The relief ({settings.impressionDepth} mm) is deeper than the clay, so it hits the table first and the
                cutter won&apos;t cut through. Use thicker clay or a shallower impression depth.
              </p>
            ) : (
              <p className="text-xs text-gray-500">
                Cuts a {cutter.clayThickness} mm slab · full {settings.impressionDepth} mm impression
              </p>
            )}
            <SliderInput label="Wall thickness" unit="mm" value={cutter.wallThickness} min={0.8} max={3} step={0.1}
              onChange={(v) => updateCutter({ wallThickness: v })} />
            <SliderInput label="Grip height" unit="mm" value={Math.min(cutter.gripHeight, settings.baseThickness)}
              min={0} max={settings.baseThickness} step={0.5}
              onChange={(v) => updateCutter({ gripHeight: v })} />
            <SliderInput label="Fit clearance" unit="mm" value={cutter.clearance} min={0.1} max={0.6} step={0.05}
              onChange={(v) => updateCutter({ clearance: v })} />
          </div>
        )}
      </fieldset>

      <div className="border-t pt-3">
        <button
          onClick={() => setAdvancedOpen((v) => !v)}
          className="flex items-center gap-1.5 text-sm font-medium text-gray-500 hover:text-gray-700 transition-colors w-full"
        >
          <svg
            className={`w-3.5 h-3.5 transition-transform ${advancedOpen ? "rotate-90" : ""}`}
            fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
          Advanced
        </button>

        {advancedOpen && (
          <div className="mt-3 space-y-4">
            {hasImage && TRACERS.length > 1 && onTracerChange && (
              <fieldset className="space-y-3">
                <legend className="text-xs font-semibold uppercase tracking-wide text-gray-500">Tracer</legend>
                <div className="flex items-center gap-1">
                  {TRACERS.map((t) => (
                    <button
                      key={t.id}
                      onClick={() => onTracerChange(t.id)}
                      title={t.description}
                      className={`px-2 py-0.5 rounded text-xs font-medium ${
                        tracerAlgorithm === t.id
                          ? "bg-amber-700 text-white"
                          : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                      }`}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
              </fieldset>
            )}

            <fieldset className="space-y-3">
              <legend className="text-xs font-semibold uppercase tracking-wide text-gray-500">Shape</legend>
              <SliderInput label="Impression Depth" unit="mm" value={settings.impressionDepth} min={0.2} max={10} step={0.1}
                onChange={(v) => update({ impressionDepth: v })} />
              <SliderInput label="Margin" unit="mm" value={settings.margin} min={0} max={20} step={0.5}
                onChange={(v) => update({ margin: v })} />
              {!settings.cutterEnabled && (
                <SliderInput label="Corner Radius" unit="mm" value={settings.cornerRadius}
                  min={0} max={(Math.min(settings.width, settings.height) + settings.margin * 2) / 2} step={0.5}
                  onChange={(v) => update({ cornerRadius: v })} />
              )}
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
              {thickenSlot && thickenSlot.variants.length > 1 && thickenEnabled && onThickenAlgorithmChange && (
                <div className="flex items-center gap-1 ml-1">
                  {thickenSlot.variants.map((v) => (
                    <button
                      key={v.id}
                      onClick={() => onThickenAlgorithmChange(v.id)}
                      title={v.description}
                      className={`px-2 py-0.5 rounded text-xs font-medium ${
                        thickenAlgorithm === v.id
                          ? "bg-amber-700 text-white"
                          : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                      }`}
                    >
                      {v.label}
                    </button>
                  ))}
                </div>
              )}
              {thickenAlgorithm === "medial" && (
                <>
                  <SliderInput label="Min perimeter width" unit="%" value={settings.minPerimeterWidthPct}
                    min={25} max={150} step={1}
                    headerRight={<span className="text-xs text-gray-500">
                      {(settings.nozzleDiameter * settings.minPerimeterWidthPct / 100).toFixed(2)} mm
                    </span>}
                    onChange={(v) => update({
                      minPerimeterWidthPct: v,
                      minFeatureSizePct: Math.min(settings.minFeatureSizePct, v),
                    })} />
                  <SliderInput label="Min feature size" unit="%" value={settings.minFeatureSizePct}
                    min={0} max={settings.minPerimeterWidthPct} step={1}
                    headerRight={<span className="text-xs text-gray-500">
                      {(settings.nozzleDiameter * settings.minFeatureSizePct / 100).toFixed(2)} mm
                    </span>}
                    onChange={(v) => update({ minFeatureSizePct: v })} />
                  <p className="text-xs text-gray-500">
                    % of nozzle, as in PrusaSlicer → Print Settings → Advanced → Arachne. Use 100% min perimeter width for the Classic generator.
                  </p>
                </>
              )}
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
        )}
      </div>
    </div>
  );
}
