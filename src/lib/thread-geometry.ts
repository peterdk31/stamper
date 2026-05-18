import * as THREE from "three";
import type { ThreadConfig } from "@/types/stamp";

/**
 * Creates female thread geometry (hole in the stamp).
 * This is a cylinder with helical grooves on the inner wall.
 * The geometry is centered at origin, extending along +Z axis.
 */
export function createFemaleThreadGeometry(config: ThreadConfig): THREE.BufferGeometry {
  const { outerDiameter, innerDiameter, pitch, height, segments } = config;
  const outerR = outerDiameter / 2;
  const innerR = innerDiameter / 2;
  const threadDepth = (outerR - innerR) / 2;
  const midR = innerR + threadDepth;
  const revolutions = height / pitch;
  const totalSegments = Math.ceil(revolutions * segments);

  const vertices: number[] = [];
  const indices: number[] = [];

  // Generate two radii per segment: inner wall (with thread profile) and outer wall
  for (let i = 0; i <= totalSegments; i++) {
    const t = i / totalSegments;
    const z = t * height;
    const angle = t * revolutions * Math.PI * 2;

    // Thread profile: sinusoidal modulation of radius
    const threadPhase = (z % pitch) / pitch;
    const threadProfile = Math.sin(threadPhase * Math.PI * 2);
    const r = midR + threadDepth * threadProfile * 0.5;

    for (let j = 0; j <= segments; j++) {
      const segAngle = (j / segments) * Math.PI * 2;
      // Inner wall (with thread)
      vertices.push(
        Math.cos(segAngle) * r,
        Math.sin(segAngle) * r,
        z,
      );
      // Outer wall (smooth cylinder)
      vertices.push(
        Math.cos(segAngle) * outerR,
        Math.sin(segAngle) * outerR,
        z,
      );
    }
  }

  const ringSize = (segments + 1) * 2;
  for (let i = 0; i < totalSegments; i++) {
    for (let j = 0; j < segments; j++) {
      const curr = i * ringSize + j * 2;
      const next = curr + ringSize;

      // Inner wall quad
      indices.push(curr, next, next + 2);
      indices.push(curr, next + 2, curr + 2);

      // Outer wall quad (reversed winding)
      indices.push(curr + 1, curr + 3, next + 3);
      indices.push(curr + 1, next + 3, next + 1);
    }
  }

  // Bottom cap
  const bottomCenter = vertices.length / 3;
  vertices.push(0, 0, 0);
  for (let j = 0; j <= segments; j++) {
    const segAngle = (j / segments) * Math.PI * 2;
    vertices.push(Math.cos(segAngle) * outerR, Math.sin(segAngle) * outerR, 0);
  }
  for (let j = 0; j < segments; j++) {
    indices.push(bottomCenter, bottomCenter + 1 + ((j + 1) % (segments + 1)), bottomCenter + 1 + j);
  }

  // Top cap
  const topCenter = vertices.length / 3;
  vertices.push(0, 0, height);
  for (let j = 0; j <= segments; j++) {
    const segAngle = (j / segments) * Math.PI * 2;
    vertices.push(Math.cos(segAngle) * outerR, Math.sin(segAngle) * outerR, height);
  }
  for (let j = 0; j < segments; j++) {
    indices.push(topCenter, topCenter + 1 + j, topCenter + 1 + ((j + 1) % (segments + 1)));
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

/**
 * Creates male thread geometry (on the handle post).
 * A cylinder with helical ridges on the outer wall.
 * Tolerance is applied by shrinking the outer dimensions.
 */
export function createMaleThreadGeometry(config: ThreadConfig): THREE.BufferGeometry {
  const { innerDiameter, pitch, height, tolerance, segments } = config;
  const outerR = innerDiameter / 2;
  const threadDepth = (config.outerDiameter / 2 - outerR) / 2;
  const midR = outerR - tolerance;
  const coreR = midR - threadDepth;
  const revolutions = height / pitch;
  const totalSegments = Math.ceil(revolutions * segments);

  const vertices: number[] = [];
  const indices: number[] = [];

  for (let i = 0; i <= totalSegments; i++) {
    const t = i / totalSegments;
    const z = t * height;

    const threadPhase = (z % pitch) / pitch;
    const threadProfile = Math.sin(threadPhase * Math.PI * 2);
    const r = midR + threadDepth * threadProfile * 0.5;

    for (let j = 0; j <= segments; j++) {
      const segAngle = (j / segments) * Math.PI * 2;
      // Outer wall (with thread)
      vertices.push(
        Math.cos(segAngle) * r,
        Math.sin(segAngle) * r,
        z,
      );
      // Inner core
      vertices.push(
        Math.cos(segAngle) * coreR,
        Math.sin(segAngle) * coreR,
        z,
      );
    }
  }

  const ringSize = (segments + 1) * 2;
  for (let i = 0; i < totalSegments; i++) {
    for (let j = 0; j < segments; j++) {
      const curr = i * ringSize + j * 2;
      const next = curr + ringSize;

      // Outer wall quad
      indices.push(curr, curr + 2, next + 2);
      indices.push(curr, next + 2, next);

      // Inner wall quad (reversed)
      indices.push(curr + 1, next + 3, curr + 3);
      indices.push(curr + 1, next + 1, next + 3);
    }
  }

  // Bottom cap
  const bottomCenter = vertices.length / 3;
  vertices.push(0, 0, 0);
  for (let j = 0; j <= segments; j++) {
    const segAngle = (j / segments) * Math.PI * 2;
    const t0Phase = 0;
    const r = midR + threadDepth * Math.sin(t0Phase * Math.PI * 2) * 0.5;
    vertices.push(Math.cos(segAngle) * r, Math.sin(segAngle) * r, 0);
  }
  for (let j = 0; j < segments; j++) {
    indices.push(bottomCenter, bottomCenter + 1 + j, bottomCenter + 1 + ((j + 1) % (segments + 1)));
  }

  // Top cap
  const topCenter = vertices.length / 3;
  vertices.push(0, 0, height);
  for (let j = 0; j <= segments; j++) {
    const segAngle = (j / segments) * Math.PI * 2;
    const tEndPhase = (height % pitch) / pitch;
    const r = midR + threadDepth * Math.sin(tEndPhase * Math.PI * 2) * 0.5;
    vertices.push(Math.cos(segAngle) * r, Math.sin(segAngle) * r, height);
  }
  for (let j = 0; j < segments; j++) {
    indices.push(topCenter, topCenter + 1 + ((j + 1) % (segments + 1)), topCenter + 1 + j);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}
