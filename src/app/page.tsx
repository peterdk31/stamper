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
import type { ExportPart } from "@/components/StampPreview";
import { Menu, MenuItem, Section, SectionsContext, type SectionsState } from "@/components/ui";
import { ChoiceButtons } from "@/components/ChoiceButtons";
import { useStampPipeline } from "@/hooks/useStampPipeline";

const noopSubscribe = () => () => {};

const StampPreview = dynamic(() => import("@/components/StampPreview"), { ssr: false });

const AUTOSAVE_DELAY = 500; // ms

/**
 * Side-by-side layout (preview left, sidebar right) on desktops and landscape
 * phones; otherwise the phone layout: preview on top, the sections as tabs below.
 */
const WIDE_QUERY = "(min-width: 1024px), (min-width: 640px) and (orientation: landscape)";
const subscribeWide = (onChange: () => void) => {
  const query = window.matchMedia(WIDE_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
};

const slug = (s: string) => s.trim().replace(/[^a-zA-Z0-9_-]+/g, "_").replace(/^_+|_+$/g, "").toLowerCase();

const imageSource = (image: ProjectImage | null) =>
  image ? (image.kind === "raster" ? image.dataUrl : image.svgText) : null;

function buildProject(
  name: string, settings: StampSettings, image: ProjectImage | null, texts: StampText[], thickenEnabled: boolean,
): StampProject {
  const fonts = [...new Set(texts.map((t) => t.fontFamily))].flatMap((name) => {
    const file = getCustomFontFile(name);
    return file ? [{ name, data: bufferToBase64(file) }] : [];
  });
  return { version: PROJECT_VERSION, name, settings, image, texts, fonts, thickenEnabled };
}

export default function Home() {
  const [name, setName] = useState("");
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
  const wide = useSyncExternalStore(subscribeWide, () => window.matchMedia(WIDE_QUERY).matches, () => true);
  const [activeTab, setActiveTab] = useState("design");
  const [focus, setFocus] = useState<SectionsState["focus"]>(null);
  const [expanded, setExpanded] = useState(false);
  const [exportParts, setExportParts] = useState<ExportPart[]>([]);

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
    setName(project.name);
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
    const timer = setTimeout(() => saveAutosave(buildProject(name, settings, image, texts, thickenEnabled)), AUTOSAVE_DELAY);
    return () => clearTimeout(timer);
  }, [restored, name, settings, image, texts, thickenEnabled]);

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
    restoreProject(buildProject("", DEFAULT_STAMP_SETTINGS, null, [], true));
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

  const handleShowSection = useCallback((id: string) => {
    setActiveTab(id);
    setExpanded(false);
    setFocus((f) => ({ id, n: (f?.n ?? 0) + 1 }));
  }, []);
  const handleShowSize = useCallback(() => handleShowSection("size"), [handleShowSection]);
  const handleToggleExpand = useCallback(() => setExpanded((v) => !v), []);

  // Typed project name, else one made from the image file name and the texts
  const derivedName = useMemo(() => {
    const parts: string[] = [];
    if (image?.fileName) parts.push(image.fileName.replace(/\.[^.]+$/, ""));
    const textContent = texts.map((t) => t.content.trim()).filter(Boolean).join("-");
    if (textContent) parts.push(textContent);
    return slug(parts.join("-")) || "stamp";
  }, [image, texts]);
  const exportName = slug(name) || derivedName;

  const hasImage = !!image;
  const textCount = texts.filter((t) => t.content.trim()).length;
  const designSummary = [
    hasImage && "image",
    textCount > 0 && `${textCount} text${textCount > 1 ? "s" : ""}`,
  ].filter(Boolean).join(" + ") || "empty";

  const sections: SectionsState = { mode: wide ? "accordion" : "tabs", active: activeTab, focus };
  const tabs = [
    { id: "design", title: "Design" },
    { id: "size", title: "Size" },
    { id: "base", title: "Base" },
    { id: "handle", title: "Handle", on: settings.threadEnabled },
    { id: "cutter", title: "Cutter", on: settings.cutterEnabled },
    { id: "printer", title: "Printer" },
  ];

  const saveProject = () => downloadProject(buildProject(name, settings, image, texts, thickenEnabled), exportName);
  const openProject = () => projectInputRef.current?.click();

  return (
    <main className="flex h-dvh flex-col overflow-hidden">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-stone-200 bg-white px-3 sm:gap-3 sm:px-4">
        {wide && <h1 className="shrink-0 text-sm font-semibold text-stone-900">Ceramic Stamps</h1>}
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={derivedName === "stamp" ? "Untitled stamp" : derivedName}
          aria-label="Project name"
          title="Project name, used for the downloaded files"
          className="min-w-0 flex-1 rounded border border-transparent px-2 py-1 text-sm text-stone-800 placeholder:text-stone-400 hover:border-stone-200 focus:border-accent-600 focus:outline-none sm:max-w-64"
        />
        {wide ? (
          <nav className="ml-auto flex gap-0.5 text-sm">
            <HeaderButton onClick={handleNewProject} title="Start over with an empty stamp">New</HeaderButton>
            <HeaderButton onClick={openProject} title={`Open a ${PROJECT_EXTENSION} project file`}>Open…</HeaderButton>
            <HeaderButton onClick={saveProject}
              title="Download the project (settings, image, texts and uploaded fonts) to open again later">
              Save
            </HeaderButton>
          </nav>
        ) : (
          <Menu button={(toggle) => (
            <button type="button" onClick={toggle} aria-label="Project menu" title="Project"
              className="flex h-8 w-8 items-center justify-center rounded text-stone-600 hover:bg-stone-100">
              <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
                <circle cx="5" cy="12" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle cx="19" cy="12" r="1.8" />
              </svg>
            </button>
          )}>
            {(close) => (
              <>
                <MenuItem onClick={() => { close(); handleNewProject(); }}>New stamp</MenuItem>
                <MenuItem onClick={() => { close(); openProject(); }}>Open project…</MenuItem>
                <MenuItem onClick={() => { close(); saveProject(); }}>Save project</MenuItem>
              </>
            )}
          </Menu>
        )}
        <ExportButton parts={exportParts} />
        <input ref={projectInputRef} type="file" accept={`${PROJECT_EXTENSION},.json,application/json`} className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleOpenProject(file);
            e.target.value = "";
          }} />
      </header>

      {/* Same tree in both layouts, so rotating a phone doesn't rebuild the 3D view */}
      <div className={`flex min-h-0 flex-1 ${wide ? "" : "flex-col"}`}>
        <section className={wide ? "relative min-w-0 flex-1" : expanded ? "relative min-h-0 flex-1" : "relative h-[40dvh] shrink-0"}>
          <StampPreview
            settings={pipeline.effectiveSettings}
            shapes={pipeline.shapes}
            exportName={exportName}
            thinFeatureMap={pipeline.thinFeatureMap}
            onEnableThicken={handleEnableThicken}
            onShowSize={handleShowSize}
            onExportPartsChange={setExportParts}
            expanded={expanded}
            onToggleExpand={wide ? undefined : handleToggleExpand}
            overlay={<PipelineToast
              isProcessing={pipeline.isProcessing}
              pipelineProgress={pipeline.pipelineProgress}
              pipelineStage={pipeline.pipelineStage}
            />}
            dev={dev}
          />
        </section>

        <aside className={wide
          ? "w-80 shrink-0 overflow-y-auto border-l border-stone-200 bg-white lg:w-[400px]"
          : `${expanded ? "hidden" : "flex"} min-h-0 flex-1 flex-col border-t border-stone-200 bg-white`}>
          {!wide && (
            <nav className="flex shrink-0 overflow-x-auto border-b border-stone-200" role="tablist">
              {tabs.map((t) => (
                <button key={t.id} type="button" role="tab" aria-selected={activeTab === t.id}
                  onClick={() => setActiveTab(t.id)}
                  className={`flex flex-1 shrink-0 items-center justify-center gap-1 border-b-2 px-2 py-2.5 text-sm font-medium ${
                    activeTab === t.id ? "border-accent-600 text-accent-700" : "border-transparent text-stone-500"
                  }`}>
                  {t.title}
                  {t.on && <span className="h-1.5 w-1.5 rounded-full bg-accent-600" title="On" />}
                </button>
              ))}
            </nav>
          )}
          <div className={wide ? "" : "min-h-0 flex-1 overflow-y-auto"}>
            <SectionsContext.Provider value={sections}>
              <Section id="design" title="Design" defaultOpen summary={designSummary}>
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
                <div className="border-t border-stone-100 pt-3">
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
            </SectionsContext.Provider>
          </div>
        </aside>
      </div>
    </main>
  );
}

function HeaderButton({ onClick, title, children }: { onClick: () => void; title: string; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} title={title}
      className="rounded px-2.5 py-1 text-stone-600 hover:bg-stone-100 hover:text-stone-900">
      {children}
    </button>
  );
}

const DownloadIcon = () => (
  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v11m0 0l-4-4m4 4l4-4M5 20h14" />
  </svg>
);

const exportButtonClass =
  "flex h-8 shrink-0 items-center gap-1.5 rounded bg-accent-600 px-3 text-sm font-medium text-white hover:bg-accent-700 disabled:opacity-50";

/** The one primary action: downloads the STL directly, or offers a menu when there are several parts. */
function ExportButton({ parts }: { parts: ExportPart[] }) {
  if (parts.length <= 1) {
    return (
      <button type="button" onClick={() => parts[0]?.download()} disabled={parts.length === 0}
        title="Download the stamp as STL" className={exportButtonClass}>
        <DownloadIcon />Export STL
      </button>
    );
  }
  return (
    <Menu button={(toggle) => (
      <button type="button" onClick={toggle} className={exportButtonClass} aria-haspopup="menu">
        <DownloadIcon />Export STL
        <svg className="h-3 w-3" viewBox="0 0 12 12" fill="currentColor"><path d="M2.5 4.5L6 8l3.5-3.5z" /></svg>
      </button>
    )}>
      {(close) => (
        <>
          {parts.map((p) => (
            <MenuItem key={p.id} onClick={() => { close(); p.download(); }}>{p.label}</MenuItem>
          ))}
          <div className="my-1 border-t border-stone-100" />
          <MenuItem title="Downloads one STL file per part" onClick={() => {
            close();
            // Spaced out: browsers drop rapid back-to-back downloads
            parts.forEach((p, i) => setTimeout(p.download, i * 400));
          }}>
            All parts ({parts.length} files)
          </MenuItem>
        </>
      )}
    </Menu>
  );
}
