import * as THREE from "three";
import type { StampSettings } from "@/types/stamp";
import { createFemaleThreadGeometry } from "./thread-geometry";
import {
  computeThinFeatureMap,
  type ThinFeatureMap,
} from "./thin-feature-detect";

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

    let thinMap: ThinFeatureMap | null = null;
    if (settings.nozzleDiameter > 0) {
      thinMap = computeThinFeatureMap(
        mirrored,
        settings.width,
        settings.height,
        settings.nozzleDiameter,
      );
    }

    const normalColor = isRaised ? 0x8b5e3c : 0x6b4226;
    const geo = new THREE.ExtrudeGeometry(mirrored, {
      depth: settings.impressionDepth,
      bevelEnabled: false,
    });

    let mat: THREE.MeshStandardMaterial;
    if (thinMap?.hasThinFeatures) {
      remapUVsToStamp(geo, settings.width, settings.height);
      const tex = createThinFeatureTexture(thinMap, normalColor);
      mat = new THREE.MeshStandardMaterial({ map: tex });
    } else {
      mat = new THREE.MeshStandardMaterial({ color: normalColor });
    }

    const mesh = new THREE.Mesh(geo, mat);
    const z = isRaised ? settings.baseThickness : totalHeight - settings.impressionDepth;
    mesh.position.set(0, 0, z);
    group.add(mesh);

    group.userData.hasThinFeatures = thinMap?.hasThinFeatures ?? false;
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

function remapUVsToStamp(
  geo: THREE.BufferGeometry,
  stampWidth: number,
  stampHeight: number,
): void {
  const positions = geo.attributes.position;
  const uvs = new Float32Array(positions.count * 2);
  for (let i = 0; i < positions.count; i++) {
    uvs[i * 2] = positions.getX(i) / stampWidth;
    uvs[i * 2 + 1] = positions.getY(i) / stampHeight;
  }
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
}

function createThinFeatureTexture(
  thinMap: ThinFeatureMap,
  normalColor: number,
): THREE.DataTexture {
  const { data, gridW, gridH } = thinMap;
  const pixels = new Uint8Array(gridW * gridH * 4);

  const nr = (normalColor >> 16) & 0xff;
  const ng = (normalColor >> 8) & 0xff;
  const nb = normalColor & 0xff;

  for (let i = 0; i < gridW * gridH; i++) {
    if (data[i]) {
      pixels[i * 4] = 230;
      pixels[i * 4 + 1] = 38;
      pixels[i * 4 + 2] = 38;
    } else {
      pixels[i * 4] = nr;
      pixels[i * 4 + 1] = ng;
      pixels[i * 4 + 2] = nb;
    }
    pixels[i * 4 + 3] = 255;
  }

  const tex = new THREE.DataTexture(pixels, gridW, gridH);
  tex.needsUpdate = true;
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  return tex;
}
