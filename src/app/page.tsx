"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import dynamic from "next/dynamic";
import { DEFAULT_STAMP_SETTINGS, type StampSettings, type StampText, type FitDimension } from "@/types/stamp";
import { loadAllBundledFonts, type FontEntry } from "@/lib/font-manager";
import StampSettingsPanel from "@/components/StampSettingsPanel";
import ImageUpload from "@/components/ImageUpload";
import TextEditor from "@/components/TextEditor";
import PipelineToast from "@/components/PipelineToast";
import { useStampPipeline } from "@/hooks/useStampPipeline";

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
  const [smoothEnabled, setSmoothEnabled] = useState(true);
  const [tracerAlgorithm, setTracerAlgorithm] = useState("potrace");
  const [thickenAlgorithm, setThickenAlgorithm] = useState("clipper");

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
    smoothEnabled,
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

  const exportName = useMemo(() => {
    const parts: string[] = [];
    if (imageName) parts.push(imageName);
    const textContent = texts.map((t) => t.content.trim()).filter(Boolean).join("-");
    if (textContent) parts.push(textContent);
    if (parts.length === 0) return "stamp";
    return parts.join("-").replace(/[^a-zA-Z0-9_-]/g, "_").toLowerCase();
  }, [imageName, texts]);

  return (
    <main className="min-h-screen bg-gray-50">
      <header className="bg-amber-800 text-white px-3 py-3 sm:px-6 sm:py-4">
        <h1 className="text-lg sm:text-xl font-bold">Ceramic Stamps</h1>
        <p className="text-amber-200 text-xs sm:text-sm">Design and export 3D-printable ceramic stamps</p>
      </header>

      <PipelineToast
        isProcessing={pipeline.isProcessing}
        pipelineProgress={pipeline.pipelineProgress}
        pipelineStage={pipeline.pipelineStage}
      />

      <div className="p-3 sm:p-6 grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-4 sm:gap-6">
        <section className="order-2 lg:order-1">
          <StampPreview settings={pipeline.effectiveSettings} shapes={pipeline.shapes} exportName={exportName} thinFeatureMap={pipeline.thinFeatureMap} />
        </section>

        <aside className="space-y-4 order-1 lg:order-2">
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
            colorMaskTolerance={settings.colorMaskTolerance}
            onColorMaskToleranceChange={(v) => setSettings((s) => ({ ...s, colorMaskTolerance: v }))}
            invert={settings.invert}
            onInvertChange={(v) => setSettings((s) => ({ ...s, invert: v }))}
          />
          <TextEditor
            texts={texts}
            availableFonts={availableFonts}
            hasImage={!!(imageDataUrl || svgText)}
            onChange={setTexts}
            onFontLoaded={handleFontLoaded}
          />
          <StampSettingsPanel settings={pipeline.effectiveSettings} onChange={setSettings}
            thickenEnabled={thickenEnabled}
            isThickening={pipeline.isThickening}
            smoothEnabled={smoothEnabled}
            isSmoothing={pipeline.isSmoothing}
            hasDesign={pipeline.hasDesign}
            onThickenToggle={() => setThickenEnabled((v) => !v)}
            onSmoothToggle={() => setSmoothEnabled((v) => !v)}
            thickenAlgorithm={thickenAlgorithm}
            onThickenAlgorithmChange={setThickenAlgorithm}
            tracerAlgorithm={tracerAlgorithm}
            onTracerChange={setTracerAlgorithm}
            hasImage={!!(imageDataUrl || svgText)}
          />
        </aside>
      </div>
    </main>
  );
}
