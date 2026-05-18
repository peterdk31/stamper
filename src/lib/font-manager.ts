import { Font, FontLoader } from "three/examples/jsm/loaders/FontLoader.js";
import * as opentype from "opentype.js";

export interface FontEntry {
  name: string;
  font: Font;
}

const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH || "";

export const BUNDLED_FONTS = [
  { name: "Nunito", url: `${BASE_PATH}/fonts/nunito_regular.typeface.json` },
  { name: "Nunito Bold", url: `${BASE_PATH}/fonts/nunito_bold.typeface.json` },
  { name: "Droid Serif", url: `${BASE_PATH}/fonts/droid_serif_regular.typeface.json` },
  { name: "Droid Serif Bold", url: `${BASE_PATH}/fonts/droid_serif_bold.typeface.json` },
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
