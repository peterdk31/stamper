import { DEFAULT_STAMP_SETTINGS, type StampProject, type StampSettings } from "@/types/stamp";

/**
 * Project files (.stamp.json) and the browser autosave. Both hold the same
 * `StampProject`: settings, texts, the source image and any uploaded fonts the
 * texts use, so a project opens the same on another machine.
 */

export const PROJECT_VERSION = 1;
export const PROJECT_EXTENSION = ".stamp.json";

/** Fills in settings added since the project was saved, so old files keep opening. */
function withDefaults(settings: Partial<StampSettings>): StampSettings {
  return {
    ...DEFAULT_STAMP_SETTINGS,
    ...settings,
    threadConfig: { ...DEFAULT_STAMP_SETTINGS.threadConfig, ...settings.threadConfig },
    cutterConfig: { ...DEFAULT_STAMP_SETTINGS.cutterConfig, ...settings.cutterConfig },
  };
}

/** Validates a parsed project file. Throws with a user-facing message if it isn't one. */
export function parseProject(json: unknown): StampProject {
  const p = json as Partial<StampProject> | null;
  if (!p || typeof p !== "object" || typeof p.version !== "number" || typeof p.settings !== "object") {
    throw new Error("This isn't a Ceramic Stamps project file.");
  }
  if (p.version > PROJECT_VERSION) {
    throw new Error("This project was saved by a newer version of Ceramic Stamps.");
  }
  return {
    version: PROJECT_VERSION,
    settings: withDefaults(p.settings ?? {}),
    image: p.image ?? null,
    texts: Array.isArray(p.texts) ? p.texts : [],
    fonts: Array.isArray(p.fonts) ? p.fonts : [],
    thickenEnabled: p.thickenEnabled ?? true,
  };
}

export function downloadProject(project: StampProject, name: string) {
  const blob = new Blob([JSON.stringify(project)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${name}${PROJECT_EXTENSION}`;
  a.click();
  URL.revokeObjectURL(url);
}

export async function readProjectFile(file: File): Promise<StampProject> {
  let json: unknown;
  try {
    json = JSON.parse(await file.text());
  } catch {
    throw new Error(`Couldn't read ${file.name} as a project file.`);
  }
  return parseProject(json);
}

export function bufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

export function base64ToBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

// Autosave lives in IndexedDB: images and fonts easily outgrow localStorage's ~5 MB.
const DB_NAME = "ceramic-stamps";
const STORE = "projects";
const AUTOSAVE_KEY = "autosave";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function withStore<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const req = run(db.transaction(STORE, mode).objectStore(STORE));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

/** The last session's project, or null if there is none or storage is unavailable (e.g. private window). */
export async function loadAutosave(): Promise<StampProject | null> {
  try {
    const saved = await withStore("readonly", (s) => s.get(AUTOSAVE_KEY));
    return saved ? parseProject(saved) : null;
  } catch (e) {
    console.warn("Couldn't restore the autosaved project:", e);
    return null;
  }
}

export async function saveAutosave(project: StampProject): Promise<void> {
  try {
    await withStore("readwrite", (s) => s.put(project, AUTOSAVE_KEY));
  } catch (e) {
    console.warn("Couldn't autosave the project:", e);
  }
}
