import * as THREE from "three";
import type { StampSettings } from "@/types/stamp";
import { createFemaleThreadGeometry } from "./thread-geometry";

export function createRoundedRectShape(
  width: number,
  height: number,
  radius: number,
): THREE.Shape {
  const r = Math.min(radius, width / 2, height / 2);
  const shape = new THREE.Shape();
  shape.moveTo(r, 0);
  shape.lineTo(width - r, 0);
  shape.quadraticCurveTo(width, 0, width, r);
  shape.lineTo(width, height - r);
  shape.quadraticCurveTo(width, height, width - r, height);
  shape.lineTo(r, height);
  shape.quadraticCurveTo(0, height, 0, height - r);
  shape.lineTo(0, r);
  shape.quadraticCurveTo(0, 0, r, 0);
  return shape;
}

function mirrorShapes(shapes: THREE.Shape[], width: number): THREE.Shape[] {
  return shapes.map((original) => {
    const mirrored = new THREE.Shape();
    const points = original.getPoints();
    if (points.length > 0) {
      mirrored.moveTo(width - points[0].x, points[0].y);
      for (let i = 1; i < points.length; i++) {
        mirrored.lineTo(width - points[i].x, points[i].y);
      }
      mirrored.closePath();
    }
    for (const hole of original.holes) {
      const holePath = new THREE.Path();
      const holePoints = hole.getPoints();
      if (holePoints.length === 0) continue;
      holePath.moveTo(width - holePoints[0].x, holePoints[0].y);
      for (let i = 1; i < holePoints.length; i++) {
        holePath.lineTo(width - holePoints[i].x, holePoints[i].y);
      }
      mirrored.holes.push(holePath);
    }
    return mirrored;
  });
}

export function buildStampGeometry(
  settings: StampSettings,
  designShapes: THREE.Shape[],
  textShapes: THREE.Shape[] = [],
): THREE.Group {
  const group = new THREE.Group();
  const totalHeight = settings.baseThickness + settings.impressionDepth;
  const isRaised = settings.designMode === "raised";

  const baseDepth = isRaised ? settings.baseThickness : totalHeight;
  const baseMat = new THREE.MeshStandardMaterial({ color: 0xd4a373 });

  if (settings.threadEnabled) {
    const majorR = settings.threadConfig.majorDiameter / 2;
    const threadDepth = Math.min(settings.threadConfig.height, baseDepth);

    const holedShape = createRoundedRectShape(settings.width, settings.height, settings.cornerRadius);
    const holePath = new THREE.Path();
    holePath.absarc(settings.width / 2, settings.height / 2, majorR, 0, Math.PI * 2, true);
    holedShape.holes.push(holePath);

    const backGeo = new THREE.ExtrudeGeometry(holedShape, {
      depth: threadDepth,
      bevelEnabled: false,
      curveSegments: settings.threadConfig.segments,
    });
    group.add(new THREE.Mesh(backGeo, baseMat));

    if (threadDepth < baseDepth) {
      const frontShape = createRoundedRectShape(settings.width, settings.height, settings.cornerRadius);
      const frontGeo = new THREE.ExtrudeGeometry(frontShape, {
        depth: baseDepth - threadDepth,
        bevelEnabled: false,
      });
      const frontMesh = new THREE.Mesh(frontGeo, baseMat);
      frontMesh.position.z = threadDepth;
      group.add(frontMesh);
    }
  } else {
    const baseShape = createRoundedRectShape(settings.width, settings.height, settings.cornerRadius);
    const baseGeo = new THREE.ExtrudeGeometry(baseShape, {
      depth: baseDepth,
      bevelEnabled: false,
    });
    group.add(new THREE.Mesh(baseGeo, baseMat));
  }

  const allShapes = [...designShapes, ...textShapes];
  if (allShapes.length > 0) {
    const mirrored = mirrorShapes(allShapes, settings.width);

    if (isRaised) {
      const geo = new THREE.ExtrudeGeometry(mirrored, {
        depth: settings.impressionDepth,
        bevelEnabled: false,
      });
      const mat = new THREE.MeshStandardMaterial({ color: 0x8b5e3c });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(0, 0, settings.baseThickness);
      group.add(mesh);
    } else {
      const geo = new THREE.ExtrudeGeometry(mirrored, {
        depth: settings.impressionDepth,
        bevelEnabled: false,
      });
      const mat = new THREE.MeshStandardMaterial({ color: 0x6b4226 });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(0, 0, totalHeight - settings.impressionDepth);
      group.add(mesh);
    }
  }

  if (settings.threadEnabled) {
    const threadGeo = createFemaleThreadGeometry(settings.threadConfig);
    const threadMat = new THREE.MeshStandardMaterial({ color: 0x6b4226 });
    const threadMesh = new THREE.Mesh(threadGeo, threadMat);
    // Position thread hole centered on the back face (z=0), extending downward
    // We flip it so it goes into the stamp from the back
    threadMesh.position.set(settings.width / 2, settings.height / 2, 0);
    threadMesh.rotation.x = Math.PI;
    threadMesh.position.z = settings.threadConfig.height;
    group.add(threadMesh);
  }

  return group;
}
