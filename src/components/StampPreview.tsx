"use client";

import { Canvas } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { useRef, useMemo } from "react";
import * as THREE from "three";
import { buildStampGeometry } from "@/lib/stamp-geometry";
import { createHandle } from "@/lib/handle-geometry";
import { downloadSTL } from "@/lib/stl-export";
import type { StampSettings } from "@/types/stamp";

interface Props {
  settings: StampSettings;
  designShapes: THREE.Shape[];
  textShapes: THREE.Shape[];
  exportName: string;
}

export default function StampPreview({ settings, designShapes, textShapes, exportName }: Props) {
  const stampRef = useRef<THREE.Group>(null);

  const stampGroup = useMemo(
    () => buildStampGeometry(settings, designShapes, textShapes),
    [settings, designShapes, textShapes],
  );

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
    <div className="flex flex-col gap-3">
      <div>
        <p className="text-xs font-medium text-gray-500 mb-1">Stamp Preview</p>
        <div className="bg-gray-900 rounded-lg overflow-hidden" style={{ height: 500 }}>
          <Canvas camera={{ position: [60, 60, 60], fov: 45 }}>
            <ambientLight intensity={0.5} />
            <directionalLight position={[50, 50, 50]} intensity={1} />
            <primitive ref={stampRef} object={stampGroup} />
            {handleGroup && <primitive object={handleGroup} />}
            <OrbitControls target={center} />
            <gridHelper args={[200, 20, 0x444444, 0x222222]} rotation={[Math.PI / 2, 0, 0]} />
          </Canvas>
        </div>
      </div>

      {stampGroup.userData.hasThinFeatures && (
        <p className="text-sm text-red-600">
          Some features are thinner than {settings.nozzleDiameter} mm (highlighted in red)
        </p>
      )}

      <div className="flex justify-end gap-2">
        <button
          onClick={handleExportStamp}
          className="px-4 py-2 bg-amber-700 text-white rounded hover:bg-amber-800 font-medium text-sm"
        >
          Export Stamp STL
        </button>
        {settings.threadEnabled && (
          <button
            onClick={handleExportHandle}
            className="px-4 py-2 bg-amber-700 text-white rounded hover:bg-amber-800 font-medium text-sm"
          >
            Export Handle STL
          </button>
        )}
      </div>
    </div>
  );
}
