import * as THREE from "three";
import type { StampSettings } from "@/types/stamp";
import { createRoundedRectShape } from "./stamp-geometry";
const CLAY_DEPTH = 5;

/**
 * Builds a clay impression preview — shows what the stamp produces in clay.
 * Uses the original (unmirrored) shapes so the impression reads correctly.
 * Inverts the raised/recessed logic relative to the stamp.
 */
export function buildClayImpressionGeometry(
  settings: StampSettings,
  designShapes: THREE.Shape[],
  textShapes: THREE.Shape[] = [],
): THREE.Group {
  const group = new THREE.Group();
  const isStampRaised = settings.designMode === "raised";

  const clayShape = createRoundedRectShape(settings.width, settings.height, settings.cornerRadius);
  const clayGeo = new THREE.ExtrudeGeometry(clayShape, {
    depth: CLAY_DEPTH,
    bevelEnabled: false,
  });
  const clayMat = new THREE.MeshStandardMaterial({ color: 0xc4a882, roughness: 0.9 });
  const clayMesh = new THREE.Mesh(clayGeo, clayMat);
  group.add(clayMesh);

  const allShapes = [...designShapes, ...textShapes];
  if (allShapes.length === 0) return group;

  if (isStampRaised) {
    // Stamp raised → clay gets indentations (darker recessed areas on top)
    const impressionGeo = new THREE.ExtrudeGeometry(allShapes, {
      depth: settings.impressionDepth,
      bevelEnabled: false,
    });
    const impressionMat = new THREE.MeshStandardMaterial({ color: 0x9c8060, roughness: 0.95 });
    const impressionMesh = new THREE.Mesh(impressionGeo, impressionMat);
    impressionMesh.position.set(0, 0, CLAY_DEPTH - settings.impressionDepth);
    group.add(impressionMesh);
  } else {
    // Stamp recessed → clay gets raised relief
    const reliefGeo = new THREE.ExtrudeGeometry(allShapes, {
      depth: settings.impressionDepth,
      bevelEnabled: false,
    });
    const reliefMat = new THREE.MeshStandardMaterial({ color: 0xd4b898, roughness: 0.85 });
    const reliefMesh = new THREE.Mesh(reliefGeo, reliefMat);
    reliefMesh.position.set(0, 0, CLAY_DEPTH);
    group.add(reliefMesh);
  }

  return group;
}
