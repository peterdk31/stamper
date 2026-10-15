"use client";

import { useState, useEffect, useCallback, useMemo, useRef, useSyncExternalStore } from "react";
import dynamic from "next/dynamic";
import { DEFAULT_STAMP_SETTINGS, type StampSettings, type StampText, type FitDimension } from "@/types/stamp";
import { loadAllBundledFonts, type FontEntry } from "@/lib/font-manager";
import { TRACERS } from "@/lib/pipeline/registry";
import StampSettingsPanel from "@/components/StampSettingsPanel";
import ImageUpload from "@/components/ImageUpload";
import TextEditor from "@/components/TextEditor";
import PipelineToast from "@/components/PipelineToast";
import { Section } from "@/components/ui";
import { ChoiceButtons } from "@/components/ChoiceButtons";
import { useStampPipeline } from "@/hooks/useStampPipeline";

const noopSubscribe = () => () => {};

const StampPreview = dynamic(() => import("@/components/StampPreview"), { ssr: false });

export default function Home() {
  const [settings, setSettings] = useState<StampSettings>(DEFAULT_STAMP_SETTINGS);
  const [imageDataUrl, setImageDataUrl] = useState<string | null>(null);
  const [imageName, setImageName] = useState<string | null>(null);
  const [svgText, setSvgText] = useState<string | null>(null);
  const [texts, setTexts] = useState<StampText[]>([]);
  const [availableFonts, setAvailableFonts] = useState<string[]>([]);
  const [fontsReady, setFontsReady] = useState(false);
  const [thickenEnabled, setThickenEnabled] = useState(true);
  const [tracerAlgorithm, setTracerAlgorithm] = useState("potrace");
  const [thickenAlgorithm, setThickenAlgorithm] = useState("medial");
  // Algorithm pickers and debug messages, only with ?dev in the URL
  const dev = useSyncExternalStore(
    noopSubscribe,
    () => new URLSearchParams(window.location.search).has("dev"),
    () => false,
  );

  useEffect(() => {
    loadAllBundledFonts().then((entries) => {
      setAvailableFonts(entries.map((e) => e.name));
      setFontsReady(true);
    });
  }, []);

  const handleFontLoaded = useCallback((entry: FontEntry) => {
    setAvailableFonts((prev) =>
      prev.includes(entry.name) ? prev : [...prev, entry.name],
    );
  }, []);

  const pipeline = useStampPipeline({
    settings,
    setSettings,
    imageDataUrl,
    svgText,
    texts,
    fontsReady,
    thickenEnabled,
    tracerAlgorithm,
    thickenAlgorithm,
  });

  const prevImageRef = useRef<string | null>(null);
  useEffect(() => {
    const currentImage = imageDataUrl ?? svgText;
    if (currentImage && currentImage !== prevImageRef.current && pipeline.sourceAspectRatio != null) {
      prevImageRef.current = currentImage;
      const fit: FitDimension = pipeline.sourceAspectRatio < 1 ? "height" : "width";
      setSettings((s) => s.fitDimension !== fit ? { ...s, fitDimension: fit } : s);
    } else if (!currentImage) {
      prevImageRef.current = null;
    }
  }, [imageDataUrl, svgText, pipeline.sourceAspectRatio]);

  const handleImageChange = useCallback((dataUrl: string | null, fileName?: string) => {
    setImageDataUrl(dataUrl);
    setImageName(dataUrl ? (fileName ?? null) : null);
  }, []);

  const handleEnableThicken = useCallback(() => setThickenEnabled(true), []);

  const exportName = useMemo(() => {
    const parts: string[] = [];
    if (imageName) parts.push(imageName);
    const textContent = texts.map((t) => t.content.trim()).filter(Boolean).join("-");
    if (textContent) parts.push(textContent);
    if (parts.length === 0) return "stamp";
    return parts.join("-").replace(/[^a-zA-Z0-9_-]/g, "_").toLowerCase();
  }, [imageName, texts]);

  const hasImage = !!(imageDataUrl || svgText);
  const textCount = texts.filter((t) => t.content.trim()).length;
  const designSummary = [
    hasImage && "image",
    textCount > 0 && `${textCount} text${textCount > 1 ? "s" : ""}`,
  ].filter(Boolean).join(" + ") || "empty";

  return (
    <main className="min-h-screen bg-gray-50">
      <header className="bg-amber-800 text-white px-3 py-2 sm:px-6 flex items-baseline gap-3">
        <h1 className="text-base font-bold">Ceramic Stamps</h1>
        <p className="hidden sm:block text-amber-200 text-xs">Design and export 3D-printable ceramic stamps</p>
      </header>

      <PipelineToast
        isProcessing={pipeline.isProcessing}
        pipelineProgress={pipeline.pipelineProgress}
        pipelineStage={pipeline.pipelineStage}
      />

      <div className="p-3 sm:p-4 grid grid-cols-1 lg:grid-cols-[1fr_400px] gap-3 sm:gap-4">
        {/* Preview stays in view while the settings scroll: pinned on top on phones, beside them on desktop */}
        <section className="sticky top-0 z-30 -mx-3 -mt-3 bg-gray-50 px-3 pt-3 pb-1 h-[48vh]
          lg:mx-0 lg:mt-0 lg:p-0 lg:top-4 lg:z-auto lg:h-[calc(100vh-4.5rem)]">
          <StampPreview
            settings={pipeline.effectiveSettings}
            shapes={pipeline.shapes}
            exportName={exportName}
            thinFeatureMap={pipeline.thinFeatureMap}
            onEnableThicken={handleEnableThicken}
            dev={dev}
          />
        </section>

        <aside className="space-y-3">
          <Section title="Design" defaultOpen summary={designSummary}>
            <ImageUpload
              imageDataUrl={imageDataUrl}
              svgText={svgText}
              onImageChange={handleImageChange}
              onSvgChange={setSvgText}
              isProcessing={pipeline.isTracing}
              progress={pipeline.traceProgress}
              progressStage={pipeline.traceStage}
              threshold={settings.threshold}
              onThresholdChange={(v) => setSettings((s) => ({ ...s, threshold: v }))}
              brightness={settings.brightness}
              onBrightnessChange={(v) => setSettings((s) => ({ ...s, brightness: v }))}
              contrast={settings.contrast}
              onContrastChange={(v) => setSettings((s) => ({ ...s, contrast: v }))}
              colorMasks={settings.colorMasks}
              onColorMasksChange={(v) => setSettings((s) => ({ ...s, colorMasks: v }))}
              invert={settings.invert}
              onInvertChange={(v) => setSettings((s) => ({ ...s, invert: v }))}
              extraOptions={dev && TRACERS.length > 1 && (
                <ChoiceButtons label="Tracer (dev)" value={tracerAlgorithm} onChange={setTracerAlgorithm}
                  options={TRACERS.map((t) => ({ id: t.id, label: t.label, title: t.description }))} />
              )}
            />
            <div className="border-t border-gray-100 pt-3">
              <TextEditor
                texts={texts}
                availableFonts={availableFonts}
                hasImage={hasImage}
                onChange={setTexts}
                onFontLoaded={handleFontLoaded}
              />
            </div>
          </Section>

          <StampSettingsPanel
            settings={pipeline.effectiveSettings}
            onChange={setSettings}
            thickenEnabled={thickenEnabled}
            isThickening={pipeline.isThickening}
            hasDesign={pipeline.hasDesign}
            onThickenToggle={() => setThickenEnabled((v) => !v)}
            thickenAlgorithm={thickenAlgorithm}
            onThickenAlgorithmChange={setThickenAlgorithm}
            dev={dev}
          />
        </aside>
      </div>
    </main>
  );
}
