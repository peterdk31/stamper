import { Font, FontLoader } from "three/examples/jsm/loaders/FontLoader.js";
import * as opentype from "opentype.js";

export interface FontEntry {
  name: string;
  font: Font;
}

export type FontCategory = "Sans" | "Serif" | "Classical" | "Display" | "Script" | "Historic" | "Custom";

export const FONT_CATEGORIES: FontCategory[] = ["Sans", "Serif", "Classical", "Display", "Script", "Historic", "Custom"];

interface BundledFont {
  name: string;
  file: string;
  category: FontCategory;
}

const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH || "";

/** Static TTFs from Google Fonts (licences in public/fonts/licenses). The first entry is the default. */
export const BUNDLED_FONTS: BundledFont[] = [
  { name: "Nunito", file: "nunito-regular.ttf", category: "Sans" },
  { name: "Nunito Bold", file: "nunito-bold.ttf", category: "Sans" },
  { name: "Montserrat Bold", file: "montserrat-bold.ttf", category: "Sans" },
  { name: "Oswald", file: "oswald-medium.ttf", category: "Sans" },
  { name: "Fredoka", file: "fredoka-medium.ttf", category: "Sans" },
  { name: "Noto Serif", file: "noto-serif-regular.ttf", category: "Serif" },
  { name: "Noto Serif Bold", file: "noto-serif-bold.ttf", category: "Serif" },
  { name: "Roboto Slab Bold", file: "roboto-slab-bold.ttf", category: "Serif" },
  { name: "Alfa Slab One", file: "alfa-slab-one.ttf", category: "Serif" },
  { name: "Cinzel Bold", file: "cinzel-bold.ttf", category: "Classical" },
  { name: "Marcellus SC", file: "marcellus-sc.ttf", category: "Classical" },
  { name: "Bebas Neue", file: "bebas-neue.ttf", category: "Display" },
  { name: "Righteous", file: "righteous.ttf", category: "Display" },
  { name: "Abril Fatface", file: "abril-fatface.ttf", category: "Display" },
  { name: "Pacifico", file: "pacifico.ttf", category: "Script" },
  { name: "Lobster", file: "lobster.ttf", category: "Script" },
  { name: "Caveat Bold", file: "caveat-bold.ttf", category: "Script" },
  { name: "Permanent Marker", file: "permanent-marker.ttf", category: "Script" },
  { name: "UnifrakturMaguntia", file: "unifraktur-maguntia.ttf", category: "Historic" },
  { name: "Uncial Antiqua", file: "uncial-antiqua.ttf", category: "Historic" },
];

export const DEFAULT_FONT = BUNDLED_FONTS[0].name;

const fontCache = new Map<string, Font>();

export function getFontCache(): Map<string, Font> {
  return fontCache;
}

export function fontCategory(name: string): FontCategory {
  return BUNDLED_FONTS.find((f) => f.name === name)?.category ?? "Custom";
}

/** CSS font-family under which the font's preview face is registered. */
export function previewFontFamily(name: string): string {
  return `"stamp-preview-${name}"`;
}

/** Registers the raw font file with the browser so UI text can be drawn in it. */
function registerPreviewFace(name: string, buffer: ArrayBuffer) {
  if (typeof FontFace === "undefined") return;
  // FontFace takes ownership of the buffer, so hand it a copy
  const face = new FontFace(`stamp-preview-${name}`, buffer.slice(0));
  face.load().then(
    (loaded) => document.fonts.add(loaded),
    (e) => console.warn(`Preview for font "${name}" failed:`, e),
  );
}

/** Converts a .ttf/.otf file into a Three.js Font. Pure — usable outside the browser. */
export function fontFromBuffer(buffer: ArrayBuffer, otFont = opentype.parse(buffer)): Font {
  const loader = new FontLoader();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return loader.parse(convertOpentypeToTypeface(otFont) as any);
}

function parseFontBuffer(name: string, buffer: ArrayBuffer, otFont?: opentype.Font) {
  fontCache.set(name, fontFromBuffer(buffer, otFont));
  registerPreviewFace(name, buffer);
}

export async function loadBundledFont({ name, file }: BundledFont): Promise<FontEntry> {
  const cached = fontCache.get(name);
  if (cached) return { name, font: cached };

  const response = await fetch(`${BASE_PATH}/fonts/${file}`);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  parseFontBuffer(name, await response.arrayBuffer());
  return { name, font: fontCache.get(name)! };
}

/** Loads every bundled font; a font that fails to load is skipped, not fatal. */
export async function loadAllBundledFonts(): Promise<FontEntry[]> {
  const results = await Promise.allSettled(BUNDLED_FONTS.map(loadBundledFont));
  return results.flatMap((r, i) => {
    if (r.status === "fulfilled") return [r.value];
    console.error(`Failed to load font "${BUNDLED_FONTS[i].name}":`, r.reason);
    return [];
  });
}

export async function loadCustomFont(file: File): Promise<FontEntry> {
  const buffer = await file.arrayBuffer();
  const otFont = opentype.parse(buffer);
  const name = otFont.getEnglishName("fontFamily") || file.name.replace(/\.\w+$/, "");
  parseFontBuffer(name, buffer, otFont);
  return { name, font: fontCache.get(name)! };
}

function convertOpentypeToTypeface(otFont: opentype.Font): Record<string, unknown> {
  const resolution = 1000;
  const scale = resolution / otFont.unitsPerEm;
  const s = (v: number) => +(v * scale).toFixed(2);
  const glyphs: Record<string, unknown> = {};

  for (let i = 0; i < otFont.glyphs.length; i++) {
    const glyph = otFont.glyphs.get(i);
    if (!glyph.unicode) continue;

    const char = String.fromCodePoint(glyph.unicode);
    let o = "";
    let curX = 0, curY = 0;

    for (const cmd of glyph.path.commands) {
      switch (cmd.type) {
        case "M":
          o += `m ${s(cmd.x)} ${s(cmd.y)} `;
          curX = cmd.x; curY = cmd.y;
          break;
        case "L":
          if (Math.abs(cmd.x - curX) > 0.1 || Math.abs(cmd.y - curY) > 0.1) {
            o += `l ${s(cmd.x)} ${s(cmd.y)} `;
          }
          curX = cmd.x; curY = cmd.y;
          break;
        case "Q":
          o += `q ${s(cmd.x)} ${s(cmd.y)} ${s(cmd.x1)} ${s(cmd.y1)} `;
          curX = cmd.x; curY = cmd.y;
          break;
        case "C":
          o += `b ${s(cmd.x)} ${s(cmd.y)} ${s(cmd.x1)} ${s(cmd.y1)} ${s(cmd.x2)} ${s(cmd.y2)} `;
          curX = cmd.x; curY = cmd.y;
          break;
        case "Z":
          break;
      }
    }

    const bb = glyph.getBoundingBox();
    glyphs[char] = {
      ha: s((glyph.advanceWidth ?? 0)),
      x_min: s(bb.x1),
      x_max: s(bb.x2),
      o: o.trim(),
    };
  }

  return {
    glyphs,
    familyName: otFont.getEnglishName("fontFamily") || "Custom",
    ascender: Math.round(otFont.ascender * (resolution / otFont.unitsPerEm)),
    descender: Math.round(otFont.descender * (resolution / otFont.unitsPerEm)),
    underlinePosition: Math.round((otFont.tables.post?.underlinePosition ?? -100) * (resolution / otFont.unitsPerEm)),
    underlineThickness: Math.round((otFont.tables.post?.underlineThickness ?? 50) * (resolution / otFont.unitsPerEm)),
    boundingBox: {
      yMin: Math.round(otFont.tables.head.yMin * (resolution / otFont.unitsPerEm)),
      xMin: Math.round(otFont.tables.head.xMin * (resolution / otFont.unitsPerEm)),
      yMax: Math.round(otFont.tables.head.yMax * (resolution / otFont.unitsPerEm)),
      xMax: Math.round(otFont.tables.head.xMax * (resolution / otFont.unitsPerEm)),
    },
    resolution,
    original_font_information: {},
    cssFontWeight: "normal",
    cssFontStyle: "normal",
  };
}
