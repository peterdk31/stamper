import * as THREE from "three";
import type { ThreadConfig } from "@/types/stamp";

const STEPS_PER_PITCH = 32;
const WALL_OVERLAP = 2;

function isoMetricDimensions(majorDiameter: number, pitch: number) {
  const H = (Math.sqrt(3) / 2) * pitch;
  const threadDepth = (5 * H) / 8;
  const majorR = majorDiameter / 2;
  const minorR = majorR - threadDepth;
  return { threadDepth, majorR, minorR };
}

function threadProfile(phase: number): number {
  const p = ((phase % 1) + 1) % 1;
  const crestHalf = 1 / 16;
  const flank = 5 / 16;
  const rootFlat = 1 / 4;

  if (p < crestHalf) {
    return 1;
  } else if (p < crestHalf + flank) {
    return 1 - (p - crestHalf) / flank;
  } else if (p < crestHalf + flank + rootFlat) {
    return 0;
  } else if (p < crestHalf + flank + rootFlat + flank) {
    return (p - crestHalf - flank - rootFlat) / flank;
  }
  return 1;
}

export function createFemaleThreadGeometry(config: ThreadConfig): THREE.BufferGeometry {
  const { majorDiameter, pitch, height, segments } = config;
  const { threadDepth, majorR } = isoMetricDimensions(majorDiameter, pitch);
  const outerR = majorR + WALL_OVERLAP;
  const revolutions = height / pitch;
  const totalZSteps = Math.ceil(revolutions * STEPS_PER_PITCH);

  const vertices: number[] = [];
  const indices: number[] = [];

  for (let i = 0; i <= totalZSteps; i++) {
    const z = (i / totalZSteps) * height;
    for (let j = 0; j <= segments; j++) {
      const circumAngle = (j / segments) * Math.PI * 2;
      const helixPhase = z / pitch - circumAngle / (Math.PI * 2);
      const profile = threadProfile(helixPhase);
      const distFromEntry = height - z;
      const taper = Math.min(distFromEntry / pitch, 1);
      const r = majorR - profile * threadDepth * taper;
      vertices.push(Math.cos(circumAngle) * r, Math.sin(circumAngle) * r, z);
      vertices.push(Math.cos(circumAngle) * outerR, Math.sin(circumAngle) * outerR, z);
    }
  }

  const ringSize = (segments + 1) * 2;
  for (let i = 0; i < totalZSteps; i++) {
    for (let j = 0; j < segments; j++) {
      const curr = i * ringSize + j * 2;
      const next = curr + ringSize;

      indices.push(curr, next, next + 2);
      indices.push(curr, next + 2, curr + 2);

      indices.push(curr + 1, curr + 3, next + 3);
      indices.push(curr + 1, next + 3, next + 1);
    }
  }

  const bottomCenter = vertices.length / 3;
  vertices.push(0, 0, 0);
  for (let j = 0; j <= segments; j++) {
    const segAngle = (j / segments) * Math.PI * 2;
    vertices.push(Math.cos(segAngle) * outerR, Math.sin(segAngle) * outerR, 0);
  }
  for (let j = 0; j < segments; j++) {
    indices.push(bottomCenter, bottomCenter + 1 + ((j + 1) % (segments + 1)), bottomCenter + 1 + j);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

export function createMaleThreadGeometry(config: ThreadConfig): THREE.BufferGeometry {
  const { majorDiameter, pitch, height, tolerance, segments } = config;
  const { threadDepth, minorR } = isoMetricDimensions(majorDiameter, pitch);
  const effectiveMinorR = minorR - tolerance;
  const revolutions = height / pitch;
  const totalZSteps = Math.ceil(revolutions * STEPS_PER_PITCH);

  const vertices: number[] = [];
  const indices: number[] = [];

  const ringSize = segments + 1;

  for (let i = 0; i <= totalZSteps; i++) {
    const z = (i / totalZSteps) * height;
    for (let j = 0; j <= segments; j++) {
      const circumAngle = (j / segments) * Math.PI * 2;
      const helixPhase = z / pitch - circumAngle / (Math.PI * 2);
      const profile = threadProfile(helixPhase);
      const taper = Math.min(z / pitch, 1);
      const r = effectiveMinorR + profile * threadDepth * taper;
      vertices.push(Math.cos(circumAngle) * r, Math.sin(circumAngle) * r, z);
    }
  }

  for (let i = 0; i < totalZSteps; i++) {
    for (let j = 0; j < segments; j++) {
      const curr = i * ringSize + j;
      const next = curr + ringSize;

      indices.push(curr, curr + 1, next + 1);
      indices.push(curr, next + 1, next);
    }
  }

  const bottomCenter = vertices.length / 3;
  vertices.push(0, 0, 0);
  for (let j = 0; j < segments; j++) {
    indices.push(bottomCenter, j + 1, j);
  }

  const topRingStart = totalZSteps * ringSize;
  const topCenter = vertices.length / 3;
  vertices.push(0, 0, height);
  for (let j = 0; j < segments; j++) {
    indices.push(topCenter, topRingStart + j, topRingStart + j + 1);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}
