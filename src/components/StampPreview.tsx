"use client";

import { Canvas } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { useRef, useMemo, useEffect, useState, memo } from "react";
import * as THREE from "three";
import { createHandle } from "@/lib/handle-geometry";
import { downloadSTL } from "@/lib/stl-export";
import DimensionOverlay, { IMPRINT_COLOR, PLATE_COLOR, AREA_COLOR } from "./DimensionOverlay";
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
    const mat = new THREE.MeshStandardMaterial({ color: m.color });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = m.name;
    mesh.position.set(m.px, m.py, m.pz);
    mesh.rotation.set(m.rx, m.ry, m.rz);
    group.add(mesh);
  }
  return group;
}

interface Props {
  settings: StampSettings;
  shapes: THREE.Shape[];
  exportName: string;
  thinFeatureMap: ThinFeatureMap | null;
  /** Turns thickening on; offered when the slicer would widen or drop strokes. */
  onEnableThicken: () => void;
  dev: boolean;
}

function StampPreview({ settings, shapes, exportName, thinFeatureMap, onEnableThicken, dev }: Props) {
  const stampRef = useRef<THREE.Group>(null);
  const geoWorkerRef = useRef<Worker | null>(null);
  const [stampGroup, setStampGroup] = useState<THREE.Group | null>(null);
  const [cutterGroup, setCutterGroup] = useState<THREE.Group | null>(null);
  const [cutterOnStamp, setCutterOnStamp] = useState(false);
  const [showDimensions, setShowDimensions] = useState(true);

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
      const { meshes, cutterMeshes, normalColor } = e.data;

      const group = buildGroup(meshes);
      group.userData.normalColor = normalColor;
      setStampGroup(group);
      setCutterGroup(cutterMeshes.length > 0 ? buildGroup(cutterMeshes) : null);

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
    });

    return () => {
      worker.terminate();
      if (geoWorkerRef.current === worker) geoWorkerRef.current = null;
    };
  }, [shapes, settings.width, settings.height, settings.margin, settings.baseThickness, settings.impressionDepth,
      settings.draftAngle, settings.cornerRadius, settings.threadEnabled, settings.threadConfig, settings.cutterEnabled, settings.cutterConfig]);

  useEffect(() => {
    if (!stampGroup) return;
    const designMesh = stampGroup.getObjectByName("design") as THREE.Mesh | undefined;
    if (!designMesh) return;

    const showOverlay = !!thinFeatureMap && (
      thinFeatureMap.hasThinFeatures || !!thinFeatureMap.changes?.widened || !!thinFeatureMap.changes?.rescued
    );
    if (!thinFeatureMap || !showOverlay) {
      const normalColor = (stampGroup.userData.normalColor as number) ?? 0x8b5e3c;
      (designMesh.material as THREE.MeshStandardMaterial).map = null;
      (designMesh.material as THREE.MeshStandardMaterial).color.setHex(normalColor);
      (designMesh.material as THREE.MeshStandardMaterial).needsUpdate = true;
      return;
    }

    const normalColor = (stampGroup.userData.normalColor as number) ?? 0x8b5e3c;
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

    (designMesh.material as THREE.MeshStandardMaterial).map = tex;
    (designMesh.material as THREE.MeshStandardMaterial).color.setHex(0xffffff);
    (designMesh.material as THREE.MeshStandardMaterial).needsUpdate = true;
  }, [stampGroup, thinFeatureMap, settings.width, settings.height]);

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

  const center = useMemo(() => {
    return new THREE.Vector3(
      settings.width / 2,
      settings.height / 2,
      (settings.baseThickness + settings.impressionDepth) / 2,
    );
  }, [settings.width, settings.height, settings.baseThickness, settings.impressionDepth]);

  function handleExportStamp() {
    if (!stampRef.current) return;
    downloadSTL(stampRef.current, `${exportName}-stamp.stl`);
  }

  function handleExportCutter() {
    if (!cutterGroup) return;
    downloadSTL(cutterGroup, `${exportName}-cutter.stl`);
  }

  function handleExportHandle() {
    const handle = createHandle(settings.threadConfig);
    downloadSTL(handle, `${exportName}-handle.stl`);
  }

  return (
    <div className="flex flex-col gap-2 h-full">
      <div className="relative bg-gray-900 rounded-lg overflow-hidden flex-1 min-h-0">
        <Canvas camera={{ position: [60, 60, 60], fov: 45 }}>
          <ambientLight intensity={0.5} />
          <directionalLight position={[50, 50, 50]} intensity={1} />
          {stampGroup && <primitive ref={stampRef} object={stampGroup} />}
          {handleGroup && <primitive object={handleGroup} />}
          {settings.cutterEnabled && cutterGroup && <primitive object={cutterGroup} />}
          {/* Sibling of the stamp group, not a child, so it never ends up in the STL */}
          {showDimensions && <DimensionOverlay settings={settings} shapes={shapes} />}
          <OrbitControls target={center} />
          <gridHelper args={[200, 20, 0x444444, 0x222222]} rotation={[Math.PI / 2, 0, 0]} />
        </Canvas>

        <div className="absolute top-2 left-2 z-20 rounded bg-gray-900/80 px-2 py-1 text-xs text-gray-200 select-none sm:top-3 sm:left-3">
          <label className="flex items-center gap-1.5">
            <input
              type="checkbox"
              checked={showDimensions}
              onChange={e => setShowDimensions(e.target.checked)}
            />
            Dimensions
          </label>
          {showDimensions && (
            <ul className="mt-1 space-y-0.5 text-gray-300">
              <LegendItem color={IMPRINT_COLOR}>imprint in clay</LegendItem>
              {!settings.cutterEnabled && <LegendItem color={PLATE_COLOR}>plate (design area + 2 × margin)</LegendItem>}
              <LegendItem color={AREA_COLOR} dashed>design area (Width × Height)</LegendItem>
            </ul>
          )}
          {settings.cutterEnabled && (
            <label className="mt-1 flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={cutterOnStamp}
                onChange={e => setCutterOnStamp(e.target.checked)}
              />
              Cutter on stamp
            </label>
          )}
        </div>
      </div>

      {thinFeatureMap?.changes
        ? <FeatureChangesLegend changes={thinFeatureMap.changes} residual={thinFeatureMap.hasThinFeatures}
            onEnableThicken={onEnableThicken} dev={dev} />
        : thinFeatureMap?.hasThinFeatures && (
          <p className="text-sm text-red-600">
            Some features are thinner than {settings.nozzleDiameter} mm (highlighted in red).
            {" "}<FixButton onClick={onEnableThicken}>Thicken them</FixButton>
          </p>
        )}

      <div className="flex flex-wrap items-center gap-2 rounded-lg bg-white px-3 py-2 shadow">
        <span className="text-sm font-semibold text-gray-700 mr-auto">Export STL</span>
        <ExportButton onClick={handleExportStamp} disabled={!stampGroup}>Stamp</ExportButton>
        {settings.threadEnabled && <ExportButton onClick={handleExportHandle}>Handle</ExportButton>}
        {settings.cutterEnabled && <ExportButton onClick={handleExportCutter} disabled={!cutterGroup}>Cutter</ExportButton>}
      </div>
    </div>
  );
}

function ExportButton({ onClick, disabled, children }: { onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-700 text-white rounded hover:bg-amber-800 font-medium text-sm disabled:opacity-50"
    >
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v11m0 0l-4-4m4 4l4-4M5 20h14" />
      </svg>
      {children}
    </button>
  );
}

function FixButton({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick}
      className="ml-1 rounded border border-current px-1.5 py-px text-xs font-medium hover:bg-white">
      {children}
    </button>
  );
}

function scrollToSize() {
  document.getElementById("size")?.scrollIntoView({ block: "start" });
}

function FeatureChangesLegend({ changes, residual, onEnableThicken, dev }: {
  changes: FeatureChanges;
  residual: boolean;
  onEnableThicken: () => void;
  dev: boolean;
}) {
  const target = changes.targetWidth.toFixed(2);
  const minFeature = changes.minFeatureSize.toFixed(2);
  if (!changes.widened && !changes.rescued) return null;
  return (
    <div className="space-y-0.5 text-sm">
      {residual && (
        <p className="text-purple-700">
          <Swatch className="bg-purple-600" />
          {dev
            ? `Still thinner than ${target} mm after thickening — this is a bug. Try the Clipper or EDT variant.`
            : `Some strokes are still thinner than ${target} mm and may not print.`}
          {!dev && <FixButton onClick={scrollToSize}>Enlarge stamp</FixButton>}
        </p>
      )}
      {changes.widened && (
        <p className="text-amber-700">
          <Swatch className="bg-amber-600" />
          {changes.thickened
            ? `Widened to ${target} mm — prints, but bolder than designed.`
            : `Thinner than ${target} mm — the slicer will widen these.`}
          {!changes.thickened && <FixButton onClick={onEnableThicken}>Thicken them</FixButton>}
        </p>
      )}
      {changes.rescued && (
        <p className="text-red-600">
          <Swatch className="bg-red-600" />
          {changes.thickened
            ? `Was under ${minFeature} mm and would not have printed — now far from 1:1.`
            : `Thinner than ${minFeature} mm — the slicer will drop these.`}
          {changes.thickened
            ? <FixButton onClick={scrollToSize}>Enlarge stamp</FixButton>
            : <FixButton onClick={onEnableThicken}>Thicken them</FixButton>}
        </p>
      )}
    </div>
  );
}

function LegendItem({ color, dashed, children }: { color: string; dashed?: boolean; children: React.ReactNode }) {
  return (
    <li className="flex items-center gap-1.5">
      <span className="inline-block w-3" style={{ borderTop: `2px ${dashed ? "dashed" : "solid"} ${color}` }} />
      {children}
    </li>
  );
}

function Swatch({ className }: { className: string }) {
  return <span className={`inline-block w-2.5 h-2.5 rounded-sm mr-1.5 align-baseline ${className}`} />;
}

export default memo(StampPreview);
