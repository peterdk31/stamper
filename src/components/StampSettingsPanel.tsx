"use client";

import {
  type CutterConfig,
  type StampSettings,
  type ThreadConfig,
} from "@/types/stamp";
import SliderInput from "./SliderInput";
import { STEP_SLOTS } from "@/lib/pipeline/registry";
import { Hint, More, Section, Toggle, ToggleRow } from "./ui";
import { ChoiceButtons } from "./ChoiceButtons";

interface Props {
  settings: StampSettings;
  onChange: (settings: StampSettings) => void;
  thickenEnabled: boolean;
  isThickening: boolean;
  hasDesign: boolean;
  onThickenToggle: () => void;
  thickenAlgorithm: string;
  onThickenAlgorithmChange: (id: string) => void;
  /** Show algorithm pickers meant for development (`?dev`). */
  dev: boolean;
}

const thickenSlot = STEP_SLOTS.find((s) => s.id === "thicken");

const mm = (v: number) => `${Number(v.toFixed(2))} mm`;

/** The settings sections below Design: Size, Base, Handle, Clay cutter, Printer. */
export default function StampSettingsPanel({
  settings, onChange, thickenEnabled, isThickening, hasDesign, onThickenToggle,
  thickenAlgorithm, onThickenAlgorithmChange, dev,
}: Props) {
  function update(partial: Partial<StampSettings>) {
    onChange({ ...settings, ...partial });
  }

  function updateThread(partial: Partial<ThreadConfig>) {
    onChange({ ...settings, threadConfig: { ...settings.threadConfig, ...partial } });
  }

  function updateCutter(partial: Partial<CutterConfig>) {
    onChange({ ...settings, cutterConfig: { ...settings.cutterConfig, ...partial } });
  }

  function setThreadEnabled(enabling: boolean) {
    if (enabling) {
      const outerD = settings.threadConfig.majorDiameter + 4;
      update({
        threadEnabled: true,
        width: Math.max(settings.width, outerD),
        height: Math.max(settings.height, outerD),
        baseThickness: Math.max(settings.baseThickness, settings.threadConfig.height),
      });
    } else {
      update({ threadEnabled: false });
    }
  }

  const minSize = settings.threadEnabled ? Math.max(10, settings.threadConfig.majorDiameter + 4) : 10;
  const minBaseThickness = settings.threadEnabled ? Math.max(3, settings.threadConfig.height) : 3;
  const maxThreadHeight = Math.max(settings.baseThickness - 2, 2);

  const cutter = settings.cutterConfig;
  const reliefTooDeep = settings.impressionDepth > cutter.clayThickness;

  // Locked: one dimension is typed, the other follows the design's proportions.
  const locked = settings.fitDimension !== "off";

  const plateW = settings.width + settings.margin * 2;
  const plateH = settings.height + settings.margin * 2;

  return (
    <>
      <Section id="size" title="Size" defaultOpen
        summary={`${mm(settings.width)} × ${mm(settings.height)} · ${mm(settings.impressionDepth)} deep`}>
        <SliderInput label="Width" unit="mm" value={settings.width} min={minSize} max={200} step={1}
          onChange={(v) => update({ width: v, ...(locked && { fitDimension: "width" }) })} />
        <div>
          <button
            type="button"
            onClick={() => update({ fitDimension: locked ? "off" : "width" })}
            aria-pressed={locked}
            title={locked ? "Proportions locked to the design — click to set width and height freely"
              : "Width and height are independent — click to keep the design's proportions"}
            className={`flex items-center gap-1.5 rounded px-2 py-0.5 text-xs font-medium ${
              locked ? "bg-amber-100 text-amber-900" : "bg-gray-100 text-gray-600 hover:bg-gray-200"
            }`}
          >
            <LockIcon locked={locked} />
            {locked ? "Keep proportions" : "Free proportions"}
          </button>
        </div>
        <SliderInput label="Height" unit="mm" value={settings.height} min={minSize} max={200} step={1}
          onChange={(v) => update({ height: v, ...(locked && { fitDimension: "height" }) })} />
        <SliderInput label="Impression depth" unit="mm" value={settings.impressionDepth} min={0.2} max={10} step={0.1}
          onChange={(v) => update({ impressionDepth: v })} />
        {dev && (
          <>
            <SliderInput label="Draft angle (dev)" unit="°" value={settings.draftAngle} min={0} max={20} step={1}
              onChange={(v) => update({ draftAngle: v })} />
            <Hint>Relief walls flare toward the base so the stamp releases from clay. The face stays exact.</Hint>
          </>
        )}
        <Hint>
          {settings.cutterEnabled
            ? "Design area. The base follows the design outline (see Clay cutter)."
            : `Design area. Plate with margin: ${(plateW / 10).toFixed(1)} × ${(plateH / 10).toFixed(1)} cm.`}
        </Hint>
      </Section>

      <Section title="Base"
        summary={settings.cutterEnabled
          ? `follows design · ${mm(settings.baseThickness)} thick`
          : `${mm(settings.margin)} margin · ${mm(settings.cornerRadius)} corners · ${mm(settings.baseThickness)} thick`}>
        {settings.cutterEnabled ? (
          <Hint>The base outline is set by the clay cutter&apos;s offset and fidelity.</Hint>
        ) : (
          <>
            <SliderInput label="Margin" unit="mm" value={settings.margin} min={0} max={20} step={0.5}
              onChange={(v) => update({ margin: v })} />
            <SliderInput label="Corner radius" unit="mm" value={settings.cornerRadius}
              min={0} max={Math.min(plateW, plateH) / 2} step={0.5}
              onChange={(v) => update({ cornerRadius: v })} />
          </>
        )}
        <SliderInput label="Base thickness" unit="mm" value={settings.baseThickness} min={minBaseThickness} max={20} step={0.5}
          onChange={(v) => {
            const clampedThread = Math.min(settings.threadConfig.height, Math.max(v - 2, 2));
            update({ baseThickness: v, threadConfig: { ...settings.threadConfig, height: clampedThread } });
          }} />
      </Section>

      <Section title="Handle" openWhen={settings.threadEnabled}
        summary={settings.threadEnabled ? "screw-on, M10×1.5" : "off"}
        headerRight={<Toggle label="Handle" checked={settings.threadEnabled} onChange={setThreadEnabled} />}>
        <Hint>Adds an M10×1.5 threaded hole to the stamp and a separate screw-on handle to export.</Hint>
        {settings.threadEnabled && (
            <More>
              <SliderInput label="Thread tolerance" unit="mm" value={settings.threadConfig.tolerance}
                min={0} max={1.5} step={0.05}
                onChange={(v) => updateThread({ tolerance: v })} />
              <Hint>Loosen if the printed handle is too tight.</Hint>
              <SliderInput label="Thread height" unit="mm" value={Math.min(settings.threadConfig.height, maxThreadHeight)}
                min={4} max={maxThreadHeight} step={0.5} onChange={(v) => updateThread({ height: v })} />
            </More>
        )}
      </Section>

      <Section title="Clay cutter" openWhen={settings.cutterEnabled}
        summary={settings.cutterEnabled ? `${mm(cutter.offset)} offset · ${mm(cutter.clayThickness)} clay` : "off"}
        headerRight={<Toggle label="Clay cutter" checked={settings.cutterEnabled}
          onChange={(v) => update({ cutterEnabled: v })} />}>
        <Hint>
          A separate ring that cuts the clay tile around the stamp. The stamp base then follows the design.
        </Hint>
        {settings.cutterEnabled && (
          <>
            <SliderInput label="Offset" unit="mm" value={cutter.offset} min={0} max={20} step={0.5}
              onChange={(v) => updateCutter({ offset: v })} />
            <SliderInput label="Outline fidelity" value={cutter.fidelity} min={0} max={100} step={5}
              headerRight={<span className="text-xs text-gray-500">
                {cutter.fidelity === 0 ? "rectangle" : cutter.fidelity <= 50 ? "rounder" : cutter.fidelity === 100 ? "follows design" : "smoothed"}
              </span>}
              onChange={(v) => updateCutter({ fidelity: v })} />
            <SliderInput label="Clay thickness" unit="mm" value={cutter.clayThickness} min={2} max={20} step={0.5}
              onChange={(v) => updateCutter({ clayThickness: v })} />
            {reliefTooDeep && (
              <Hint tone="error">
                The relief ({settings.impressionDepth} mm) is deeper than the clay, so it hits the table first and the
                cutter won&apos;t cut through. Use thicker clay or a shallower impression depth.
              </Hint>
            )}
            <More dot={cutter.invertInside}>
              <label className="flex items-center gap-2 text-sm text-gray-700">
                <input type="checkbox" checked={cutter.invertInside} className="accent-amber-700"
                  onChange={(e) => updateCutter({ invertInside: e.target.checked })} />
                Invert inside outline
              </label>
              <SliderInput label="Wall thickness" unit="mm" value={cutter.wallThickness} min={0.8} max={3} step={0.1}
                onChange={(v) => updateCutter({ wallThickness: v })} />
              <SliderInput label="Grip height" unit="mm" value={Math.min(cutter.gripHeight, settings.baseThickness)}
                min={0} max={settings.baseThickness} step={0.5}
                onChange={(v) => updateCutter({ gripHeight: v })} />
              <SliderInput label="Fit clearance" unit="mm" value={cutter.clearance} min={0.1} max={0.6} step={0.05}
                onChange={(v) => updateCutter({ clearance: v })} />
              <Hint>Gap per side between stamp and ring.</Hint>
            </More>
          </>
        )}
      </Section>

      <Section id="printer" title="Printer"
        summary={`${mm(settings.nozzleDiameter)} nozzle · thicken ${thickenEnabled ? "on" : "off"}`}>
        <SliderInput label="Nozzle diameter" unit="mm" value={settings.nozzleDiameter}
          min={0.1} max={1.5} step={0.05}
          onChange={(v) => update({ nozzleDiameter: v })} />
        <ToggleRow
          label={isThickening ? "Thickening…" : "Thicken thin strokes"}
          checked={thickenEnabled}
          onChange={onThickenToggle}
          disabled={!hasDesign}
        />
        <Hint>Widens strokes your printer can&apos;t print, so nothing goes missing.</Hint>
        {dev && thickenSlot && thickenSlot.variants.length > 1 && thickenEnabled && (
          <ChoiceButtons label="Variant (dev)" value={thickenAlgorithm} onChange={onThickenAlgorithmChange}
            options={thickenSlot.variants.map((v) => ({ id: v.id, label: v.label, title: v.description }))} />
        )}
        {thickenAlgorithm === "medial" && (
          <More label="Slicer limits">
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
            <Hint>
              % of nozzle, as in PrusaSlicer → Print Settings → Advanced → Arachne. Use 100% min perimeter width for the Classic generator.
            </Hint>
          </More>
        )}
      </Section>
    </>
  );
}

function LockIcon({ locked }: { locked: boolean }) {
  return (
    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path strokeLinecap="round" d={locked ? "M8 11V7a4 4 0 018 0v4" : "M8 11V7a4 4 0 017.5-2"} />
    </svg>
  );
}
