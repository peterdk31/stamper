"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import dynamic from "next/dynamic";
import { DEFAULT_STAMP_SETTINGS, type StampSettings, type StampText } from "@/types/stamp";
import { loadAllBundledFonts, type FontEntry } from "@/lib/font-manager";
import StampSettingsPanel from "@/components/StampSettingsPanel";
import ImageUpload from "@/components/ImageUpload";
import TextEditor from "@/components/TextEditor";
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
  const [thickenEnabled, setThickenEnabled] = useState(false);
  const [smoothEnabled, setSmoothEnabled] = useState(false);

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
  });

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
      <header className="bg-amber-800 text-white px-6 py-4">
        <h1 className="text-xl font-bold">Ceramic Stamps</h1>
        <p className="text-amber-200 text-sm">Design and export 3D-printable ceramic stamps</p>
      </header>

      <div className="max-w-7xl mx-auto p-6 grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-6">
        <aside className="space-y-4">
          <ImageUpload
            imageDataUrl={imageDataUrl}
            svgText={svgText}
            onImageChange={handleImageChange}
            onSvgChange={setSvgText}
            isProcessing={pipeline.isTracing}
            progress={pipeline.traceProgress}
            progressStage={pipeline.traceStage}
          />
          <TextEditor
            texts={texts}
            availableFonts={availableFonts}
            stampWidth={pipeline.effectiveSettings.width}
            stampHeight={pipeline.effectiveSettings.height}
            onChange={setTexts}
            onFontLoaded={handleFontLoaded}
          />
          <StampSettingsPanel settings={pipeline.effectiveSettings} onChange={setSettings}
            isAutoFitting={pipeline.isAutoFitting}
            thickenEnabled={thickenEnabled}
            isThickening={pipeline.isThickening}
            smoothEnabled={smoothEnabled}
            isSmoothing={pipeline.isSmoothing}
            smoothProgress={pipeline.smoothProgress}
            hasDesign={pipeline.hasDesign}
            onThickenToggle={() => setThickenEnabled((v) => !v)}
            onSmoothToggle={() => setSmoothEnabled((v) => !v)}
            onFindMinWidth={pipeline.onFindMinWidth}
          />
        </aside>

        <section>
          <StampPreview settings={pipeline.effectiveSettings} shapes={pipeline.shapes} exportName={exportName} />
        </section>
      </div>
    </main>
  );
}
