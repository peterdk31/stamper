import { describe, it, expect } from "vitest";
import { base64ToBuffer, bufferToBase64, parseProject, PROJECT_VERSION } from "../project";
import { DEFAULT_STAMP_SETTINGS } from "@/types/stamp";

describe("parseProject", () => {
  it("fills in settings added after the file was saved", () => {
    const settings: Record<string, unknown> = { ...DEFAULT_STAMP_SETTINGS, width: 55 };
    delete settings.draftAngle;
    const cutterConfig: Record<string, unknown> = { ...DEFAULT_STAMP_SETTINGS.cutterConfig };
    delete cutterConfig.invertInside;
    const p = parseProject({ version: 1, settings: { ...settings, cutterConfig }, texts: [] });
    expect(p.settings.width).toBe(55);
    expect(p.settings.draftAngle).toBe(0);
    expect(p.settings.cutterConfig.invertInside).toBe(false);
    expect(p.image).toBeNull();
    expect(p.fonts).toEqual([]);
    expect(p.thickenEnabled).toBe(true);
  });

  it("rejects files that aren't projects, or are from a newer version", () => {
    expect(() => parseProject({ hello: "world" })).toThrow(/isn't a Ceramic Stamps project/);
    expect(() => parseProject(null)).toThrow();
    expect(() => parseProject({ version: PROJECT_VERSION + 1, settings: {} })).toThrow(/newer version/);
  });
});

describe("base64", () => {
  it("round-trips binary data larger than one chunk", () => {
    const bytes = new Uint8Array(100_000).map((_, i) => (i * 31) & 0xff);
    const back = new Uint8Array(base64ToBuffer(bufferToBase64(bytes.buffer)));
    expect(back).toEqual(bytes);
  });
});
