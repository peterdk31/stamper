"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import dynamic from "next/dynamic";
import * as THREE from "three";
import { DEFAULT_STAMP_SETTINGS, type StampSettings, type StampText } from "@/types/stamp";
import { traceImageToShapes } from "@/lib/image-trace";
import { parseSvgToShapes, getSvgAspectRatio } from "@/lib/svg-parse";
import { loadAllBundledFonts, getFontCache, type FontEntry } from "@/lib/font-manager";
import { textEntriesToShapes, computeTextBounds } from "@/lib/text-to-shapes";
import StampSettingsPanel from "@/components/StampSettingsPanel";
import ImageUpload from "@/components/ImageUpload";
import TextEditor from "@/components/TextEditor";

const StampPreview = dynamic(() => import("@/components/StampPreview"), { ssr: false });

export default function Home() {
  const [settings, setSettings] = useState<StampSettings>(DEFAULT_STAMP_SETTINGS);
  const [imageDataUrl, setImageDataUrl] = useState<string | null>(null);
  const [svgText, setSvgText] = useState<string | null>(null);
  const [texts, setTexts] = useState<StampText[]>([]);
  const [designShapes, setDesignShapes] = useState<THREE.Shape[]>([]);
  const [availableFonts, setAvailableFonts] = useState<string[]>([]);
  const [fontsReady, setFontsReady] = useState(false);
  const [imageAspectRatio, setImageAspectRatio] = useState<number | null>(null);

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

  // Derive stamp height from content when auto-size is on
  const effectiveHeight = useMemo(() => {
    if (!settings.autoSize) return settings.height;

    let newHeight: number | null = null;

    const aspectRatio = svgText ? getSvgAspectRatio(svgText) : imageAspectRatio;
    if (aspectRatio && aspectRatio > 0) {
      newHeight = settings.width / aspectRatio;
    }

    if (texts.length > 0 && fontsReady) {
      const bounds = computeTextBounds(texts, getFontCache());
      if (bounds && bounds.width > 0) {
        const availWidth = settings.width - settings.padding * 2;
        const scale = availWidth / bounds.width;
        const textHeight = bounds.height * scale + settings.padding * 2;
        newHeight = newHeight ? Math.max(newHeight, textHeight) : textHeight;
      }
    }

    if (newHeight === null) return settings.height;
    return Math.round(Math.max(10, newHeight) * 10) / 10;
  }, [settings.autoSize, settings.height, settings.width, settings.padding, svgText, imageAspectRatio, texts, fontsReady]);

  const effectiveSettings = useMemo(() =>
    effectiveHeight !== settings.height ? { ...settings, height: effectiveHeight } : settings,
    [settings, effectiveHeight],
  );

  const processRasterImage = useCallback(
    (dataUrl: string) => {
      const img = new Image();
      img.onload = () => {
        setImageAspectRatio(img.width / img.height);
        const canvas = document.createElement("canvas");
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext("2d")!;
        ctx.drawImage(img, 0, 0);
        const imageData = ctx.getImageData(0, 0, img.width, img.height);
        const shapes = traceImageToShapes(
          imageData, effectiveSettings.width, effectiveSettings.height, effectiveSettings.simplification,
        );
        setDesignShapes(shapes);
      };
      img.src = dataUrl;
    },
    [effectiveSettings.width, effectiveSettings.height, effectiveSettings.simplification],
  );

  useEffect(() => {
    if (svgText) {
      const shapes = parseSvgToShapes(svgText, effectiveSettings.width, effectiveSettings.height);
      setDesignShapes(shapes);
    } else if (imageDataUrl) {
      processRasterImage(imageDataUrl);
    } else {
      setDesignShapes([]);
      setImageAspectRatio(null);
    }
  }, [svgText, imageDataUrl, effectiveSettings.width, effectiveSettings.height, effectiveSettings.simplification, processRasterImage]);

  const textShapes = useMemo(() => {
    if (!fontsReady) return [];
    return textEntriesToShapes(texts, getFontCache(), effectiveSettings.width, effectiveSettings.height, 0, effectiveSettings.padding);
  }, [texts, fontsReady, effectiveSettings.width, effectiveSettings.height, effectiveSettings.padding]);

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
            simplification={effectiveSettings.simplification}
            onImageChange={setImageDataUrl}
            onSvgChange={setSvgText}
            onSimplificationChange={(v) => setSettings((s) => ({ ...s, simplification: v }))}
          />
          <TextEditor
            texts={texts}
            availableFonts={availableFonts}
            stampWidth={effectiveSettings.width}
            stampHeight={effectiveSettings.height}
            onChange={setTexts}
            onFontLoaded={handleFontLoaded}
          />
          <StampSettingsPanel settings={effectiveSettings} onChange={setSettings} />
        </aside>

        <section>
          <StampPreview settings={effectiveSettings} designShapes={designShapes} textShapes={textShapes} />
        </section>
      </div>
    </main>
  );
}
