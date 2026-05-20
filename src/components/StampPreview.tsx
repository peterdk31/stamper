"use client";

import { Canvas } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { useRef, useMemo, useEffect, useState, memo } from "react";
import * as THREE from "three";
import { createHandle } from "@/lib/handle-geometry";
import { downloadSTL } from "@/lib/stl-export";
import type { StampSettings, ThinFeatureMap } from "@/types/stamp";
import type { StampGeoMessage } from "@/lib/stamp-geometry.worker";

interface Props {
  settings: StampSettings;
  shapes: THREE.Shape[];
  exportName: string;
  thinFeatureMap: ThinFeatureMap | null;
}

function StampPreview({ settings, shapes, exportName, thinFeatureMap }: Props) {
  const stampRef = useRef<THREE.Group>(null);
  const geoWorkerRef = useRef<Worker | null>(null);
  const [stampGroup, setStampGroup] = useState<THREE.Group | null>(null);

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
      const { meshes, normalColor } = e.data;

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
      group.userData.normalColor = normalColor;
      setStampGroup(group);

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
      margin: settings.margin,
      baseThickness: settings.baseThickness,
      impressionDepth: settings.impressionDepth,
      cornerRadius: settings.cornerRadius,
      threadEnabled: settings.threadEnabled,
      threadConfig: settings.threadConfig,
    });

    return () => {
      worker.terminate();
      if (geoWorkerRef.current === worker) geoWorkerRef.current = null;
    };
  }, [shapes, settings.width, settings.height, settings.margin, settings.baseThickness, settings.impressionDepth,
      settings.cornerRadius, settings.threadEnabled, settings.threadConfig]);

  useEffect(() => {
    if (!stampGroup) return;
    const designMesh = stampGroup.getObjectByName("design") as THREE.Mesh | undefined;
    if (!designMesh) return;

    if (!thinFeatureMap || !thinFeatureMap.hasThinFeatures) {
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

  function handleExportHandle() {
    const handle = createHandle(settings.threadConfig);
    downloadSTL(handle, `${exportName}-handle.stl`);
  }

  return (
    <div className="flex flex-col h-[60vh] lg:sticky lg:top-6 lg:h-[calc(100vh-120px)]">
      <div className="relative bg-gray-900 rounded-lg overflow-hidden flex-1 min-h-0">
        <Canvas camera={{ position: [60, 60, 60], fov: 45 }}>
          <ambientLight intensity={0.5} />
          <directionalLight position={[50, 50, 50]} intensity={1} />
          {stampGroup && <primitive ref={stampRef} object={stampGroup} />}
          {handleGroup && <primitive object={handleGroup} />}
          <OrbitControls target={center} />
          <gridHelper args={[200, 20, 0x444444, 0x222222]} rotation={[Math.PI / 2, 0, 0]} />
        </Canvas>

        <div className="absolute bottom-2 left-2 right-2 flex justify-end gap-2 sm:left-auto sm:bottom-3 sm:right-3">
          <button
            onClick={handleExportStamp}
            className="px-2.5 py-1.5 bg-amber-700/90 text-white rounded hover:bg-amber-800 font-medium text-xs sm:text-sm sm:px-3 backdrop-blur-sm"
          >
            Export Stamp STL
          </button>
          {settings.threadEnabled && (
            <button
              onClick={handleExportHandle}
              className="px-2.5 py-1.5 bg-amber-700/90 text-white rounded hover:bg-amber-800 font-medium text-xs sm:text-sm sm:px-3 backdrop-blur-sm"
            >
              Export Handle STL
            </button>
          )}
        </div>
      </div>

      {thinFeatureMap?.hasThinFeatures && (
        <p className="mt-2 text-sm text-red-600">
          Some features are thinner than {settings.nozzleDiameter} mm (highlighted in red)
        </p>
      )}
    </div>
  );
}

export default memo(StampPreview);
