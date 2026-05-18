import { Font, FontLoader } from "three/examples/jsm/loaders/FontLoader.js";
import * as opentype from "opentype.js";

export interface FontEntry {
  name: string;
  font: Font;
}

const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH || "";

export const BUNDLED_FONTS = [
  { name: "Helvetiker", url: `${BASE_PATH}/fonts/helvetiker_regular.typeface.json` },
  { name: "Helvetiker Bold", url: `${BASE_PATH}/fonts/helvetiker_bold.typeface.json` },
  { name: "Droid Serif", url: `${BASE_PATH}/fonts/droid_serif_regular.typeface.json` },
  { name: "Droid Serif Bold", url: `${BASE_PATH}/fonts/droid_serif_bold.typeface.json` },
  { name: "Optimer", url: `${BASE_PATH}/fonts/optimer_regular.typeface.json` },
];

const fontCache = new Map<string, Font>();

export function getFontCache(): Map<string, Font> {
  return fontCache;
}

export async function loadBundledFont(name: string, url: string): Promise<FontEntry> {
  const cached = fontCache.get(name);
  if (cached) return { name, font: cached };

  const loader = new FontLoader();
  const response = await fetch(url);
  const json = await response.json();
  const font = loader.parse(json);
  fontCache.set(name, font);
  return { name, font };
}

export async function loadAllBundledFonts(): Promise<FontEntry[]> {
  const entries = await Promise.all(
    BUNDLED_FONTS.map((f) => loadBundledFont(f.name, f.url)),
  );
  return entries;
}

export async function loadCustomFont(file: File): Promise<FontEntry> {
  const buffer = await file.arrayBuffer();
  const otFont = opentype.parse(buffer);
  const typefaceJson = convertOpentypeToTypeface(otFont);
  const loader = new FontLoader();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const font = loader.parse(typefaceJson as any);
  const name = otFont.names.fontFamily?.en || file.name.replace(/\.\w+$/, "");
  fontCache.set(name, font);
  return { name, font };
}

function convertOpentypeToTypeface(otFont: opentype.Font): Record<string, unknown> {
  const resolution = 1000;
  const glyphs: Record<string, unknown> = {};

  for (let i = 0; i < otFont.glyphs.length; i++) {
    const glyph = otFont.glyphs.get(i);
    if (!glyph.unicode) continue;

    const char = String.fromCodePoint(glyph.unicode);
    const path = glyph.getPath(0, 0, resolution);
    let o = "";

    for (const cmd of path.commands) {
      switch (cmd.type) {
        case "M":
          o += `m ${cmd.x} ${cmd.y} `;
          break;
        case "L":
          o += `l ${cmd.x} ${cmd.y} `;
          break;
        case "Q":
          o += `q ${cmd.x1} ${cmd.y1} ${cmd.x} ${cmd.y} `;
          break;
        case "C":
          o += `b ${cmd.x1} ${cmd.y1} ${cmd.x2} ${cmd.y2} ${cmd.x} ${cmd.y} `;
          break;
        case "Z":
          break;
      }
    }

    const bb = glyph.getBoundingBox();
    glyphs[char] = {
      ha: Math.round((glyph.advanceWidth ?? 0) * (resolution / otFont.unitsPerEm)),
      x_min: Math.round(bb.x1),
      x_max: Math.round(bb.x2),
      o: o.trim(),
    };
  }

  return {
    glyphs,
    familyName: otFont.names.fontFamily?.en || "Custom",
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
