import type { StampText } from "@/types/stamp";

export type LayoutPreset = "circular" | "stacked" | "monogram";

export function applyCircularLayout(
  text: string,
  fontSize: number,
  stampWidth: number,
  stampHeight: number,
  fontFamily: string,
): StampText[] {
  const radius = Math.min(stampWidth, stampHeight) * 0.35;
  const chars = text.split("");
  const totalAngle = Math.min(chars.length * 25, 340);
  const startAngle = 90 + totalAngle / 2;

  return chars.map((char, i) => {
    const angle = startAngle - (i / Math.max(chars.length - 1, 1)) * totalAngle;
    const rad = (angle * Math.PI) / 180;
    return {
      content: char,
      fontSize,
      fontFamily,
      x: Math.cos(rad) * radius,
      y: Math.sin(rad) * radius - stampHeight * 0.05,
      letterSpacing: 0,
      rotation: angle - 90,
    };
  });
}

export function applyStackedLayout(
  text: string,
  fontSize: number,
  stampWidth: number,
  stampHeight: number,
  fontFamily: string,
): StampText[] {
  const lines = text.split("\n").filter(Boolean);
  if (lines.length === 0) return [];

  const lineSpacing = fontSize * 1.4;
  const totalTextHeight = lines.length * lineSpacing;
  const startY = (totalTextHeight - lineSpacing) / 2;

  return lines.map((line, i) => ({
    content: line,
    fontSize,
    fontFamily,
    x: 0,
    y: startY - i * lineSpacing,
    letterSpacing: 0,
    rotation: 0,
  }));
}

export function applyMonogramLayout(
  chars: string,
  fontSize: number,
  _stampWidth: number,
  _stampHeight: number,
  fontFamily: string,
): StampText[] {
  const letters = chars.slice(0, 3).split("");
  if (letters.length === 0) return [];

  if (letters.length === 1) {
    return [{ content: letters[0], fontSize: fontSize * 1.5, fontFamily, x: 0, y: 0, letterSpacing: 0, rotation: 0 }];
  }

  if (letters.length === 2) {
    const spacing = fontSize * 0.8;
    return [
      { content: letters[0], fontSize, fontFamily, x: -spacing, y: 0, letterSpacing: 0, rotation: 0 },
      { content: letters[1], fontSize, fontFamily, x: spacing, y: 0, letterSpacing: 0, rotation: 0 },
    ];
  }

  // 3 letters: center letter is larger
  const spacing = fontSize * 0.9;
  return [
    { content: letters[0], fontSize, fontFamily, x: -spacing, y: 0, letterSpacing: 0, rotation: 0 },
    { content: letters[1], fontSize: fontSize * 1.4, fontFamily, x: 0, y: 0, letterSpacing: 0, rotation: 0 },
    { content: letters[2], fontSize, fontFamily, x: spacing, y: 0, letterSpacing: 0, rotation: 0 },
  ];
}
