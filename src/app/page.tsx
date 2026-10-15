"use client";

import { useState, useEffect, useCallback, useMemo, useRef, useSyncExternalStore } from "react";
import dynamic from "next/dynamic";
import {
  DEFAULT_STAMP_SETTINGS, type StampSettings, type StampText, type FitDimension, type ProjectImage, type StampProject,
} from "@/types/stamp";
import {
  BUNDLED_FONTS, DEFAULT_FONT, getCustomFontFile, getFontCache, loadAllBundledFonts, loadCustomFontBuffer, type FontEntry,
} from "@/lib/font-manager";
import {
  PROJECT_EXTENSION, PROJECT_VERSION, base64ToBuffer, bufferToBase64, downloadProject, loadAutosave, readProjectFile, saveAutosave,
} from "@/lib/project";
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

const AUTOSAVE_DELAY = 500; // ms

const imageSource = (image: ProjectImage | null) =>
  image ? (image.kind === "raster" ? image.dataUrl : image.svgText) : null;

function buildProject(settings: StampSettings, image: ProjectImage | null, texts: StampText[], thickenEnabled: boolean): StampProject {
  const fonts = [...new Set(texts.map((t) => t.fontFamily))].flatMap((name) => {
    const file = getCustomFontFile(name);
    return file ? [{ name, data: bufferToBase64(file) }] : [];
  });
  return { version: PROJECT_VERSION, settings, image, texts, fonts, thickenEnabled };
}

export default function Home() {
  const [settings, setSettings] = useState<StampSettings>(DEFAULT_STAMP_SETTINGS);
  const [image, setImage] = useState<ProjectImage | null>(null);
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

  const imageDataUrl = image?.kind === "raster" ? image.dataUrl : null;
  const svgText = image?.kind === "svg" ? image.svgText : null;

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

  const restoreProject = useCallback((project: StampProject) => {
    const loadedFonts: string[] = [];
    for (const f of project.fonts) {
      try {
        loadedFonts.push(loadCustomFontBuffer(base64ToBuffer(f.data), f.name).name);
      } catch (e) {
        console.warn(`Couldn't load font "${f.name}" from the project:`, e);
      }
    }
    if (loadedFonts.length > 0) setAvailableFonts((prev) => [...new Set([...prev, ...loadedFonts])]);
    const fontKnown = (name: string) => getFontCache().has(name) || BUNDLED_FONTS.some((f) => f.name === name);
    // The saved settings already fit the image; don't let the new-image effect refit them
    prevImageRef.current = imageSource(project.image);
    setImage(project.image);
    setSettings(project.settings);
    setTexts(project.texts.map((t) => (fontKnown(t.fontFamily) ? t : { ...t, fontFamily: DEFAULT_FONT })));
    setThickenEnabled(project.thickenEnabled);
  }, []);

  // Restore the last session, then autosave every change
  const [restored, setRestored] = useState(false);
  useEffect(() => {
    loadAutosave().then((project) => {
      if (project) restoreProject(project);
      setRestored(true);
    });
  }, [restoreProject]);

  useEffect(() => {
    if (!restored) return;
    const timer = setTimeout(() => saveAutosave(buildProject(settings, image, texts, thickenEnabled)), AUTOSAVE_DELAY);
    return () => clearTimeout(timer);
  }, [restored, settings, image, texts, thickenEnabled]);

  const projectInputRef = useRef<HTMLInputElement>(null);

  async function handleOpenProject(file: File) {
    try {
      restoreProject(await readProjectFile(file));
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    }
  }

  function handleNewProject() {
    if (!confirm("Start a new stamp? Save the current one first if you want to keep it.")) return;
    restoreProject(buildProject(DEFAULT_STAMP_SETTINGS, null, [], true));
  }

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

  const handleEnableThicken = useCallback(() => setThickenEnabled(true), []);

  const exportName = useMemo(() => {
    const parts: string[] = [];
    if (image?.fileName) parts.push(image.fileName.replace(/\.[^.]+$/, ""));
    const textContent = texts.map((t) => t.content.trim()).filter(Boolean).join("-");
    if (textContent) parts.push(textContent);
    if (parts.length === 0) return "stamp";
    return parts.join("-").replace(/[^a-zA-Z0-9_-]/g, "_").toLowerCase();
  }, [image, texts]);

  const hasImage = !!image;
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
        <nav className="ml-auto flex gap-1 text-sm">
          <HeaderButton onClick={handleNewProject} title="Start over with an empty stamp">New</HeaderButton>
          <HeaderButton onClick={() => projectInputRef.current?.click()} title={`Open a ${PROJECT_EXTENSION} project file`}>
            Open…
          </HeaderButton>
          <HeaderButton onClick={() => downloadProject(buildProject(settings, image, texts, thickenEnabled), exportName)}
            title="Download the project (settings, image, texts and uploaded fonts) to open again later">
            Save
          </HeaderButton>
        </nav>
        <input ref={projectInputRef} type="file" accept={`${PROJECT_EXTENSION},.json,application/json`} className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleOpenProject(file);
            e.target.value = "";
          }} />
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
              image={image}
              onImageChange={setImage}
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

function HeaderButton({ onClick, title, children }: { onClick: () => void; title: string; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} title={title}
      className="rounded px-2 py-0.5 text-amber-100 hover:bg-amber-700 hover:text-white">
      {children}
    </button>
  );
}
