"use client";

import { Canvas, useThree } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { useRef, useMemo, useEffect, useState, memo } from "react";
import * as THREE from "three";
import { createHandle } from "@/lib/handle-geometry";
import { downloadSTL } from "@/lib/stl-export";
import { GRID_MAJOR, GRID_MINOR, SCENE_BACKGROUND, STAMP_DESIGN } from "@/lib/scene-colors";
import DimensionOverlay from "./DimensionOverlay";
import { IconButton } from "./ui";
import { plateMargin, type StampSettings, type ThinFeatureMap, type FeatureChanges } from "@/types/stamp";
import type { StampGeoMessage, SerializedMesh } from "@/lib/stamp-geometry.worker";

function buildGroup(meshes: SerializedMesh[]): THREE.Group {
  const group = new THREE.Group();
  for (const m of meshes) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(m.position, 3));
    if (m.normal.length > 0) {
      geo.setAttribute("normal", new THREE.Float32BufferAttribute(m.normal, 3));
    }
    if (m.index) geo.setIndex(new THREE.BufferAttribute(m.index, 1));
    const mat = new THREE.MeshStandardMaterial({ color: m.color, roughness: 0.75 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = m.name;
    mesh.position.set(m.px, m.py, m.pz);
    mesh.rotation.set(m.rx, m.ry, m.rz);
    group.add(mesh);
  }
  return group;
}

/** A part that can be downloaded as STL; handed up to the header's Export button. */
export interface ExportPart {
  id: "stamp" | "handle" | "cutter";
  label: string;
  download: () => void;
}

type ViewMode = "stamp" | "clay";
type CameraView = "3d" | "top";

interface Props {
  settings: StampSettings;
  shapes: THREE.Shape[];
  exportName: string;
  thinFeatureMap: ThinFeatureMap | null;
  /** Turns thickening on; offered when the slicer would widen or drop strokes. */
  onEnableThicken: () => void;
  /** Shows the Size settings; offered when strokes stay too thin. */
  onShowSize: () => void;
  /** Called whenever the downloadable parts change. */
  onExportPartsChange: (parts: ExportPart[]) => void;
  /** Phone layout: the preview can be expanded to fill the screen. */
  expanded?: boolean;
  onToggleExpand?: () => void;
  /** Shown over the viewport (pipeline progress). */
  overlay?: React.ReactNode;
  dev: boolean;
}

function StampPreview({
  settings, shapes, exportName, thinFeatureMap, onEnableThicken, onShowSize, onExportPartsChange,
  expanded, onToggleExpand, overlay, dev,
}: Props) {
  const geoWorkerRef = useRef<Worker | null>(null);
  const [stampGroup, setStampGroup] = useState<THREE.Group | null>(null);
  const [cutterGroup, setCutterGroup] = useState<THREE.Group | null>(null);
  const [clayGroup, setClayGroup] = useState<THREE.Group | null>(null);
  const [cutterOnStamp, setCutterOnStamp] = useState(false);
  const [showDimensions, setShowDimensions] = useState(true);
  const [showHighlights, setShowHighlights] = useState(true);
  const [viewMode, setViewMode] = useState<ViewMode>("stamp");
  const [cameraView, setCameraView] = useState<CameraView>("3d");
  const [fitRequest, setFitRequest] = useState(0);
  const [warningDetails, setWarningDetails] = useState(false);
  const clay = viewMode === "clay";
  // Phone layout (the expandable preview): warnings start as a one-line summary
  const compactWarnings = !!onToggleExpand && !warningDetails;

  useEffect(() => {
    const shapeData = shapes.map(s => ({
      outer: s.getPoints().map(p => ({ x: p.x, y: p.y })),
      holes: s.holes.map(h => h.getPoints().map(p => ({ x: p.x, y: p.y }))),
    }));

    if (geoWorkerRef.current) geoWorkerRef.current.terminate();

    const worker = new Worker(new URL("../lib/stamp-geometry.worker.ts", import.meta.url));
    geoWorkerRef.current = worker;

    worker.onmessage = (e: MessageEvent<StampGeoMessage>) => {
      if (geoWorkerRef.current !== worker) return;
      const { meshes, cutterMeshes, clayMeshes, normalColor } = e.data;

      const group = buildGroup(meshes);
      group.userData.normalColor = normalColor;
      setStampGroup(group);
      setCutterGroup(cutterMeshes.length > 0 ? buildGroup(cutterMeshes) : null);
      setClayGroup(clayMeshes.length > 0 ? buildGroup(clayMeshes) : null);

      worker.terminate();
      geoWorkerRef.current = null;
    };

    worker.onerror = () => {
      worker.terminate();
      if (geoWorkerRef.current === worker) geoWorkerRef.current = null;
    };

    worker.postMessage({
      shapes: shapeData,
      width: settings.width,
      height: settings.height,
      margin: plateMargin(settings),
      baseThickness: settings.baseThickness,
      impressionDepth: settings.impressionDepth,
      draftAngle: settings.draftAngle,
      cornerRadius: settings.cornerRadius,
      threadEnabled: settings.threadEnabled,
      threadConfig: settings.threadConfig,
      cutter: settings.cutterEnabled ? settings.cutterConfig : null,
      clay,
    });

    return () => {
      worker.terminate();
      if (geoWorkerRef.current === worker) geoWorkerRef.current = null;
    };
  }, [shapes, settings.width, settings.height, settings.margin, settings.baseThickness, settings.impressionDepth,
      settings.draftAngle, settings.cornerRadius, settings.threadEnabled, settings.threadConfig, settings.cutterEnabled,
      settings.cutterConfig, clay]);

  const hasChanges = !!thinFeatureMap?.changes?.widened || !!thinFeatureMap?.changes?.rescued;
  const hasIssues = !!thinFeatureMap && (thinFeatureMap.hasThinFeatures || hasChanges);

  useEffect(() => {
    if (!stampGroup) return;
    const designMesh = stampGroup.getObjectByName("design") as THREE.Mesh | undefined;
    if (!designMesh) return;
    const material = designMesh.material as THREE.MeshStandardMaterial;
    const normalColor = (stampGroup.userData.normalColor as number) || STAMP_DESIGN;

    if (!thinFeatureMap || !hasIssues || !showHighlights) {
      material.map = null;
      material.color.setHex(normalColor);
      material.needsUpdate = true;
      return;
    }

    const nr = (normalColor >> 16) & 0xff;
    const ng = (normalColor >> 8) & 0xff;
    const nb = normalColor & 0xff;

    const pixels = new Uint8Array(thinFeatureMap.pixels);
    for (let i = 0; i < thinFeatureMap.gridW * thinFeatureMap.gridH; i++) {
      if (pixels[i * 4 + 3] === 0) {
        pixels[i * 4] = nr;
        pixels[i * 4 + 1] = ng;
        pixels[i * 4 + 2] = nb;
        pixels[i * 4 + 3] = 255;
      }
    }

    const tex = new THREE.DataTexture(pixels, thinFeatureMap.gridW, thinFeatureMap.gridH);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.needsUpdate = true;
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;

    const geo = designMesh.geometry;
    const positions = geo.attributes.position;
    const uvs = new Float32Array(positions.count * 2);
    for (let i = 0; i < positions.count; i++) {
      uvs[i * 2] = 1 - positions.getX(i) / settings.width;
      uvs[i * 2 + 1] = positions.getY(i) / settings.height;
    }
    geo.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));

    material.map = tex;
    material.color.setHex(0xffffff);
    material.needsUpdate = true;
  }, [stampGroup, thinFeatureMap, hasIssues, showHighlights, settings.width, settings.height]);

  const handleGroup = useMemo(() => {
    if (!settings.threadEnabled) return null;
    const handle = createHandle(settings.threadConfig);
    const gap = 15;
    const handleHeight = settings.threadConfig.height + 18;
    handle.position.set(settings.width + gap + settings.threadConfig.majorDiameter * 1.2, settings.height / 2, handleHeight);
    handle.rotation.x = Math.PI;
    return handle;
  }, [settings.threadEnabled, settings.threadConfig, settings.width, settings.height]);

  // Beside the stamp (opposite the handle), or slid onto it to check the fit.
  useEffect(() => {
    if (!cutterGroup) return;
    const gap = 15;
    const { offset, clearance, wallThickness } = settings.cutterConfig;
    const reach = offset + clearance + wallThickness; // ring beyond the design area, per side
    cutterGroup.position.set(0, cutterOnStamp ? 0 : -(settings.height + reach * 2 + gap), 0);
  }, [cutterGroup, cutterOnStamp, settings.height, settings.cutterConfig]);

  // The header's Export button downloads whatever is built
  useEffect(() => {
    const parts: ExportPart[] = [];
    if (stampGroup) parts.push({ id: "stamp", label: "Stamp", download: () => downloadSTL(stampGroup, `${exportName}-stamp.stl`) });
    if (settings.threadEnabled) {
      const config = settings.threadConfig;
      parts.push({ id: "handle", label: "Handle", download: () => downloadSTL(createHandle(config), `${exportName}-handle.stl`) });
    }
    if (settings.cutterEnabled && cutterGroup) {
      parts.push({ id: "cutter", label: "Clay cutter", download: () => downloadSTL(cutterGroup, `${exportName}-cutter.stl`) });
    }
    onExportPartsChange(parts);
  }, [stampGroup, cutterGroup, settings.threadEnabled, settings.threadConfig, settings.cutterEnabled, exportName, onExportPartsChange]);

  const physW = settings.width + plateMargin(settings) * 2;
  const physH = settings.height + plateMargin(settings) * 2;
  const showCutter = !clay && settings.cutterEnabled && !!cutterGroup;
  const fitObjects = clay ? [clayGroup] : [stampGroup, handleGroup, showCutter ? cutterGroup : null];

  function pickView(view: CameraView) {
    setCameraView(view);
    setFitRequest((n) => n + 1);
  }

  return (
    <div className="relative h-full w-full overflow-hidden" style={{ background: SCENE_BACKGROUND }}>
      <Canvas camera={{ position: [40, -90, 80], fov: 40, up: [0, 0, 1] }}>
        <color attach="background" args={[SCENE_BACKGROUND]} />
        <hemisphereLight args={[0xffffff, 0xb8b0a5, 1.1]} />
        <directionalLight position={[40, -60, 100]} intensity={1.6} />
        <directionalLight position={[-60, 50, 40]} intensity={0.4} />
        {stampGroup && <primitive object={stampGroup} visible={!clay} />}
        {handleGroup && <primitive object={handleGroup} visible={!clay} />}
        {cutterGroup && <primitive object={cutterGroup} visible={showCutter} />}
        {clayGroup && <primitive object={clayGroup} visible={clay} />}
        {/* Sibling of the stamp group, not a child, so it never ends up in the STL */}
        {showDimensions && !clay && <DimensionOverlay settings={settings} shapes={shapes} />}
        <OrbitControls makeDefault />
        <CameraRig objects={fitObjects} view={cameraView} fitRequest={fitRequest} />
        <gridHelper args={[200, 20, GRID_MAJOR, GRID_MINOR]} rotation={[Math.PI / 2, 0, 0]}
          position={[Math.round(physW / 20) * 10, Math.round(physH / 20) * 10, -0.01]} />
      </Canvas>

      {/* Toolbar */}
      <div className="pointer-events-none absolute inset-x-2 top-2 flex flex-wrap items-start justify-between gap-2">
        <Segmented value={viewMode} onChange={setViewMode} options={[
          { id: "stamp", label: "Stamp", title: "The stamp as printed (the design is mirrored)" },
          { id: "clay", label: "Clay", title: "The impression it leaves in clay" },
        ]} />
        <div className="pointer-events-auto flex items-center gap-0.5 rounded-md border border-stone-300/70 bg-white/90 p-0.5 shadow-sm">
          <Segmented bare value={cameraView} onChange={pickView} options={[
            { id: "3d", label: "3D", title: "Angled view" },
            { id: "top", label: "Top", title: "Straight down onto the face" },
          ]} />
          <IconButton title="Fit to view" onClick={() => setFitRequest((n) => n + 1)}>
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
              <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
            </svg>
          </IconButton>
          {!clay && (
            <IconButton title="Dimensions: imprint size (dark), plate size (gray), design area (dashed)"
              pressed={showDimensions} onClick={() => setShowDimensions((v) => !v)}>
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
                <path d="M3 8h18v8H3zM7 8v3M11 8v4M15 8v3M19 8v4" />
              </svg>
            </IconButton>
          )}
          {settings.cutterEnabled && !clay && (
            <IconButton title="Slide the cutter onto the stamp to check the fit" pressed={cutterOnStamp}
              onClick={() => setCutterOnStamp((v) => !v)}>
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <rect x="3" y="3" width="18" height="18" rx="2" />
                <rect x="7.5" y="7.5" width="9" height="9" rx="1" />
              </svg>
            </IconButton>
          )}
          {onToggleExpand && (
            <IconButton title={expanded ? "Show settings" : "Expand preview"} onClick={onToggleExpand}>
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
                <path d={expanded ? "M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" : "M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5M9 9l-5-5M15 9l5-5M9 15l-5 5M15 15l5 5"} />
              </svg>
            </IconButton>
          )}
        </div>
      </div>

      {overlay}

      {/* Thin-feature messages, kept inside the viewport so the layout never jumps */}
      <div className="pointer-events-none absolute inset-x-2 bottom-2 flex flex-col items-start gap-1">
        {shapes.length === 0 && (
          <p className="self-center rounded bg-white/90 px-2 py-1 text-xs text-stone-600 shadow-sm">
            Add an image or text to start
          </p>
        )}
        {!clay && thinFeatureMap && hasIssues && (
          <div className="pointer-events-auto max-w-full space-y-1 rounded-md border border-stone-300/70 bg-white/95 px-2.5 py-1.5 text-xs shadow-sm sm:text-sm">
            {compactWarnings ? (
              <p className="flex items-center gap-1.5 text-stone-700">
                {thinFeatureMap.hasThinFeatures && <Swatch className={hasChanges ? "bg-purple-600" : "bg-red-600"} />}
                {thinFeatureMap.changes?.widened && <Swatch className="bg-amber-500" />}
                {thinFeatureMap.changes?.rescued && <Swatch className="bg-red-600" />}
                Some strokes are too thin to print 1:1
                <FixButton onClick={() => setWarningDetails(true)}>Details</FixButton>
              </p>
            ) : (
              <>
                {thinFeatureMap.changes && hasChanges
                  ? <FeatureChangesLegend changes={thinFeatureMap.changes} residual={thinFeatureMap.hasThinFeatures}
                      onEnableThicken={onEnableThicken} onShowSize={onShowSize} dev={dev} />
                  : (
                    <p className="text-red-700">
                      <Swatch className="bg-red-600" />
                      Some features are thinner than {settings.nozzleDiameter} mm.
                      <FixButton onClick={onEnableThicken}>Thicken them</FixButton>
                    </p>
                  )}
                <div className="flex gap-3 text-xs text-stone-500">
                  <button type="button" onClick={() => setShowHighlights((v) => !v)} className="underline hover:text-stone-800">
                    {showHighlights ? "Hide highlights" : "Show highlights on the stamp"}
                  </button>
                  {onToggleExpand && (
                    <button type="button" onClick={() => setWarningDetails(false)} className="underline hover:text-stone-800">
                      Less
                    </button>
                  )}
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Frames the visible parts: on a preset or Fit click from the preset direction,
 * otherwise (the parts changed size, the viewport was resized) from where the
 * camera is now, so orbiting isn't undone by every settings change.
 */
function CameraRig({ objects, view, fitRequest }: {
  objects: (THREE.Object3D | null)[];
  view: CameraView;
  fitRequest: number;
}) {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const controls = useThree((s) => s.controls) as unknown as { target: THREE.Vector3; update: () => void } | null;
  const size = useThree((s) => s.size);
  const last = useRef<{ box: THREE.Box3; aspect: number; fitRequest: number } | null>(null);
  const [a, b, c] = objects;

  useEffect(() => {
    if (!controls) return;
    // Next frame: the cutter's position is set by an effect outside the canvas
    const frame = requestAnimationFrame(() => {
      const box = new THREE.Box3();
      for (const o of [a, b, c]) {
        if (!o) continue;
        o.updateMatrixWorld(true);
        box.expandByObject(o);
      }
      if (box.isEmpty()) return;
      const aspect = size.width / Math.max(1, size.height);
      const prev = last.current;
      const forced = !prev || prev.fitRequest !== fitRequest;
      const changed = !prev || Math.abs(prev.aspect - aspect) > 0.01
        || prev.box.min.distanceTo(box.min) + prev.box.max.distanceTo(box.max) > 0.5;
      if (!forced && !changed) return;
      last.current = { box, aspect, fitRequest };

      const dir = forced
        ? (view === "top" ? new THREE.Vector3(0, -0.01, 1) : new THREE.Vector3(0.35, -1, 1.05)).normalize()
        : camera.position.clone().sub(controls.target).normalize();
      const sphere = box.getBoundingSphere(new THREE.Sphere());
      const vfov = (camera.fov * Math.PI) / 180;
      const hfov = 2 * Math.atan(Math.tan(vfov / 2) * aspect);
      const dist = (sphere.radius / Math.sin(Math.min(vfov, hfov) / 2)) * 0.95;
      controls.target.copy(sphere.center);
      camera.position.copy(sphere.center).addScaledVector(dir, dist);
      camera.near = dist / 100;
      camera.far = dist * 100;
      camera.updateProjectionMatrix();
      controls.update();
    });
    return () => cancelAnimationFrame(frame);
  }, [a, b, c, view, fitRequest, controls, camera, size.width, size.height]);

  return null;
}

function Segmented<T extends string>({ value, options, onChange, bare }: {
  value: T;
  options: { id: T; label: string; title: string }[];
  onChange: (id: T) => void;
  /** No frame of its own (it sits inside another toolbar group). */
  bare?: boolean;
}) {
  return (
    <div className={`pointer-events-auto flex ${bare ? "" : "rounded-md border border-stone-300/70 bg-white/90 p-0.5 shadow-sm"}`}>
      {options.map((o) => (
        <button key={o.id} type="button" onClick={() => onChange(o.id)} title={o.title} aria-pressed={value === o.id}
          className={`h-8 rounded px-2.5 text-sm font-medium ${
            value === o.id ? "bg-accent-600 text-white" : "text-stone-600 hover:bg-stone-200 hover:text-stone-900"
          }`}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

function FixButton({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick}
      className="ml-1.5 rounded border border-current px-1.5 py-px text-xs font-medium hover:bg-white">
      {children}
    </button>
  );
}

function FeatureChangesLegend({ changes, residual, onEnableThicken, onShowSize, dev }: {
  changes: FeatureChanges;
  residual: boolean;
  onEnableThicken: () => void;
  onShowSize: () => void;
  dev: boolean;
}) {
  const target = changes.targetWidth.toFixed(2);
  const minFeature = changes.minFeatureSize.toFixed(2);
  return (
    <>
      {residual && (
        <p className="text-purple-700">
          <Swatch className="bg-purple-600" />
          {dev
            ? `Still thinner than ${target} mm after thickening — this is a bug. Try the Clipper or EDT variant.`
            : `Some strokes are still thinner than ${target} mm and may not print.`}
          {!dev && <FixButton onClick={onShowSize}>Enlarge stamp</FixButton>}
        </p>
      )}
      {changes.widened && (
        <p className="text-amber-700">
          <Swatch className="bg-amber-500" />
          {changes.thickened
            ? `Widened to ${target} mm — prints, but bolder than designed.`
            : `Thinner than ${target} mm — the slicer will widen these.`}
          {!changes.thickened && <FixButton onClick={onEnableThicken}>Thicken them</FixButton>}
        </p>
      )}
      {changes.rescued && (
        <p className="text-red-700">
          <Swatch className="bg-red-600" />
          {changes.thickened
            ? `Was under ${minFeature} mm and would not have printed — now far from 1:1.`
            : `Thinner than ${minFeature} mm — the slicer will drop these.`}
          {changes.thickened
            ? <FixButton onClick={onShowSize}>Enlarge stamp</FixButton>
            : <FixButton onClick={onEnableThicken}>Thicken them</FixButton>}
        </p>
      )}
    </>
  );
}

function Swatch({ className }: { className: string }) {
  return <span className={`inline-block w-2.5 h-2.5 shrink-0 rounded-sm mr-1.5 align-baseline ${className}`} />;
}

export default memo(StampPreview);
