"use client";

import { useMemo } from "react";
import { Html, Line } from "@react-three/drei";
import * as THREE from "three";
import { plateMargin, type StampSettings } from "@/types/stamp";

// Preview-only annotation. Rendered as a sibling of the stamp group (never a
// child), so STL export — which walks only the stamp group — can't pick it up.

interface Props {
  settings: StampSettings;
  shapes: THREE.Shape[];
}

export const IMPRINT_COLOR = "#fbbf24";
export const PLATE_COLOR = "#9ca3af";
export const AREA_COLOR = "#60a5fa";

function cm(mm: number) {
  return `${(mm / 10).toFixed(1)} cm`;
}

export default function DimensionOverlay({ settings, shapes }: Props) {
  const { width, height, baseThickness, impressionDepth } = settings;
  const margin = plateMargin(settings);
  const physW = width + margin * 2;
  const physH = height + margin * 2;
  const z = baseThickness + impressionDepth;
  const gap = Math.max(4, 0.08 * Math.max(physW, physH));

  // Design bounding box in world coords. Shapes are unmirrored; the stamp
  // worker mirrors them (x → width - x) and offsets by the margin.
  const bounds = useMemo(() => {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const s of shapes) {
      for (const p of s.getPoints()) {
        if (p.x < minX) minX = p.x;
        if (p.x > maxX) maxX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.y > maxY) maxY = p.y;
      }
    }
    if (!isFinite(minX)) return null;
    return {
      x0: margin + width - maxX,
      x1: margin + width - minX,
      y0: margin + minY,
      y1: margin + maxY,
    };
  }, [shapes, width, margin]);

  // Design area (Width × Height sliders) as a dashed outline, lifted just above
  // the top face so it isn't z-fighting with the design.
  const lz = z + 0.05;
  const area: [number, number, number][] = [
    [margin, margin, lz], [margin + width, margin, lz],
    [margin + width, margin + height, lz], [margin, margin + height, lz],
    [margin, margin, lz],
  ];

  return (
    <group>
      <Line points={area} color={AREA_COLOR} lineWidth={1} dashed dashSize={1.5} gapSize={1} />
      {bounds && (
        <>
          <Dimension axis="x" from={bounds.x0} to={bounds.x1} edge={bounds.y0} at={-gap} z={z}
            color={IMPRINT_COLOR} label={`imprint ${cm(bounds.x1 - bounds.x0)}`} primary />
          <Dimension axis="y" from={bounds.y0} to={bounds.y1} edge={bounds.x0} at={-gap} z={z}
            color={IMPRINT_COLOR} label={`imprint ${cm(bounds.y1 - bounds.y0)}`} primary />
        </>
      )}
      {/* No rectangular plate in cutter mode: the base follows the design. */}
      {!settings.cutterEnabled && (
        <>
          <Dimension axis="x" from={0} to={physW} edge={0} at={-gap * 2} z={z}
            color={PLATE_COLOR} label={`plate ${cm(physW)}`} />
          <Dimension axis="y" from={0} to={physH} edge={0} at={-gap * 2} z={z}
            color={PLATE_COLOR} label={`plate ${cm(physH)}`} />
        </>
      )}
    </group>
  );
}

interface DimensionProps {
  axis: "x" | "y";
  /** Span being measured, along `axis`. */
  from: number;
  to: number;
  /** Cross-axis coordinate where the measured feature ends; extension lines start here. */
  edge: number;
  /** Cross-axis coordinate of the dimension line. */
  at: number;
  z: number;
  color: string;
  label: string;
  primary?: boolean;
}

function Dimension({ axis, from, to, edge, at, z, color, label, primary }: DimensionProps) {
  if (to - from < 1e-6) return null;

  const p = (along: number, cross: number): [number, number, number] =>
    axis === "x" ? [along, cross, z] : [cross, along, z];
  const overshoot = Math.sign(at - edge) * 1.5;
  const tick = 1;

  const points = [
    // extension lines
    p(from, edge), p(from, at + overshoot),
    p(to, edge), p(to, at + overshoot),
    // dimension line
    p(from, at), p(to, at),
    // 45° end ticks
    p(from - tick, at - tick), p(from + tick, at + tick),
    p(to - tick, at - tick), p(to + tick, at + tick),
  ];

  return (
    <>
      <Line points={points} segments color={color} lineWidth={primary ? 1.5 : 1} />
      <Html position={p((from + to) / 2, at)} center zIndexRange={[10, 0]} pointerEvents="none">
        <span
          className={`whitespace-nowrap rounded bg-gray-900/90 px-1 font-mono ${primary ? "text-sm font-semibold" : "text-xs"}`}
          style={{ color }}
        >
          {label}
        </span>
      </Html>
    </>
  );
}
