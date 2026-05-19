"use client";

import { Canvas } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { useRef, useMemo, useEffect, useState } from "react";
import * as THREE from "three";
import { buildStampGeometry } from "@/lib/stamp-geometry";
import { createHandle } from "@/lib/handle-geometry";
import { downloadSTL } from "@/lib/stl-export";
import type { StampSettings } from "@/types/stamp";
import type { ThinFeatureMessage } from "@/lib/thin-feature-detect.worker";

interface Props {
  settings: StampSettings;
  shapes: THREE.Shape[];
  exportName: string;
}

export default function StampPreview({ settings, shapes, exportName }: Props) {
  const stampRef = useRef<THREE.Group>(null);
  const thinWorkerRef = useRef<Worker | null>(null);
  const [hasThinFeatures, setHasThinFeatures] = useState(false);

  const stampGroup = useMemo(
    () => buildStampGeometry(settings, shapes),
    [settings, shapes],
  );

  useEffect(() => {
    const designMesh = stampGroup.getObjectByName("design") as THREE.Mesh | undefined;
    if (!designMesh || shapes.length === 0 || settings.nozzleDiameter <= 0) {
      setHasThinFeatures(false);
      return;
    }

    const mirroredData = shapes.map((s) => {
      const pts = s.getPoints();
      return {
        outer: pts.map((p) => ({ x: settings.width - p.x, y: p.y })),
        holes: s.holes.map((h) => h.getPoints().map((p) => ({ x: settings.width - p.x, y: p.y }))),
      };
    });

    if (thinWorkerRef.current) thinWorkerRef.current.terminate();

    const worker = new Worker(new URL("../lib/thin-feature-detect.worker.ts", import.meta.url));
    thinWorkerRef.current = worker;

    worker.onmessage = (e: MessageEvent<ThinFeatureMessage>) => {
      if (thinWorkerRef.current !== worker) return;
      const msg = e.data;
      if (msg.type === "empty") {
        setHasThinFeatures(false);
      } else {
        setHasThinFeatures(msg.hasThinFeatures);
        if (msg.hasThinFeatures) {
          const normalColor = (stampGroup.userData.normalColor as number) ?? 0x8b5e3c;
          const nr = (normalColor >> 16) & 0xff;
          const ng = (normalColor >> 8) & 0xff;
          const nb = normalColor & 0xff;
          const pixels = msg.pixels;
          for (let i = 0; i < msg.gridW * msg.gridH; i++) {
            if (pixels[i * 4 + 3] === 0) {
              pixels[i * 4] = nr;
              pixels[i * 4 + 1] = ng;
              pixels[i * 4 + 2] = nb;
              pixels[i * 4 + 3] = 255;
            }
          }
          const tex = new THREE.DataTexture(pixels, msg.gridW, msg.gridH);
          tex.needsUpdate = true;
          tex.magFilter = THREE.NearestFilter;
          tex.minFilter = THREE.NearestFilter;

          const geo = designMesh.geometry;
          const positions = geo.attributes.position;
          const uvs = new Float32Array(positions.count * 2);
          for (let i = 0; i < positions.count; i++) {
            uvs[i * 2] = positions.getX(i) / settings.width;
            uvs[i * 2 + 1] = positions.getY(i) / settings.height;
          }
          geo.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));

          (designMesh.material as THREE.MeshStandardMaterial).map = tex;
          (designMesh.material as THREE.MeshStandardMaterial).color.setHex(0xffffff);
          (designMesh.material as THREE.MeshStandardMaterial).needsUpdate = true;
        }
      }
      worker.terminate();
      thinWorkerRef.current = null;
    };

    worker.onerror = () => {
      setHasThinFeatures(false);
      worker.terminate();
      if (thinWorkerRef.current === worker) thinWorkerRef.current = null;
    };

    worker.postMessage({
      shapes: mirroredData,
      stampWidth: settings.width,
      stampHeight: settings.height,
      nozzleDiameter: settings.nozzleDiameter,
    });

    return () => {
      worker.terminate();
      if (thinWorkerRef.current === worker) thinWorkerRef.current = null;
    };
  }, [stampGroup, shapes, settings.width, settings.height, settings.nozzleDiameter]);

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
  }, [settings]);

  function handleExportStamp() {
    if (!stampRef.current) return;
    downloadSTL(stampRef.current, `${exportName}-stamp.stl`);
  }

  function handleExportHandle() {
    const handle = createHandle(settings.threadConfig);
    downloadSTL(handle, `${exportName}-handle.stl`);
  }

  return (
    <div className="sticky top-6 flex flex-col" style={{ height: "calc(100vh - 120px)" }}>
      <div className="relative bg-gray-900 rounded-lg overflow-hidden flex-1">
        <Canvas camera={{ position: [60, 60, 60], fov: 45 }}>
          <ambientLight intensity={0.5} />
          <directionalLight position={[50, 50, 50]} intensity={1} />
          <primitive ref={stampRef} object={stampGroup} />
          {handleGroup && <primitive object={handleGroup} />}
          <OrbitControls target={center} />
          <gridHelper args={[200, 20, 0x444444, 0x222222]} rotation={[Math.PI / 2, 0, 0]} />
        </Canvas>

        <div className="absolute bottom-3 right-3 flex gap-2">
          <button
            onClick={handleExportStamp}
            className="px-3 py-1.5 bg-amber-700/90 text-white rounded hover:bg-amber-800 font-medium text-sm backdrop-blur-sm"
          >
            Export Stamp STL
          </button>
          {settings.threadEnabled && (
            <button
              onClick={handleExportHandle}
              className="px-3 py-1.5 bg-amber-700/90 text-white rounded hover:bg-amber-800 font-medium text-sm backdrop-blur-sm"
            >
              Export Handle STL
            </button>
          )}
        </div>
      </div>

      {hasThinFeatures && (
        <p className="mt-2 text-sm text-red-600">
          Some features are thinner than {settings.nozzleDiameter} mm (highlighted in red)
        </p>
      )}
    </div>
  );
}
