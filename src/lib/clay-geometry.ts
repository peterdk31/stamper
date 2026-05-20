import * as THREE from "three";
import type { StampSettings } from "@/types/stamp";
import { createRoundedRectShape } from "./stamp-geometry";
const CLAY_DEPTH = 5;

export function buildClayImpressionGeometry(
  settings: StampSettings,
  shapes: THREE.Shape[],
): THREE.Group {
  const group = new THREE.Group();

  const clayShape = createRoundedRectShape(settings.width, settings.height, settings.cornerRadius);
  const clayGeo = new THREE.ExtrudeGeometry(clayShape, {
    depth: CLAY_DEPTH,
    bevelEnabled: false,
  });
  const clayMat = new THREE.MeshStandardMaterial({ color: 0xc4a882, roughness: 0.9 });
  const clayMesh = new THREE.Mesh(clayGeo, clayMat);
  group.add(clayMesh);

  if (shapes.length === 0) return group;

  const impressionGeo = new THREE.ExtrudeGeometry(shapes, {
    depth: settings.impressionDepth,
    bevelEnabled: false,
  });
  const impressionMat = new THREE.MeshStandardMaterial({ color: 0x9c8060, roughness: 0.95 });
  const impressionMesh = new THREE.Mesh(impressionGeo, impressionMat);
  impressionMesh.position.set(0, 0, CLAY_DEPTH - settings.impressionDepth);
  group.add(impressionMesh);

  return group;
}
