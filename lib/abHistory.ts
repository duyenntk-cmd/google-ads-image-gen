/**
 * Stored runs for the AI Banner tool.
 *
 * The point of keeping a run is that the artwork is the expensive part: with it
 * on disk, reopening a set or localising it into another market costs nothing
 * but a text call. Twenty PNGs as data URLs is 20-40MB, far past what
 * localStorage takes, so this is IndexedDB.
 *
 * Two stores on purpose. The list view reads `runs`, which is small; the
 * artwork sits in `art` and is only fetched when a run is actually opened.
 */

export interface AbRunMeta {
  id: string;
  createdAt: number;
  appName: string;
  appUrl: string;
  country: string;
  language: string;
  quality: string;
  platform: string;
  /** The brief the overlay was drawn from — re-rendering needs every field. */
  brief: unknown;
  icon: string | null;
  /** One small JPEG of the first asset, for the list. */
  thumb: string;
  slotCount: number;
}

const DB_NAME = "ab_history";
const DB_VERSION = 1;
const RUNS = "runs";
const ART = "art";

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(RUNS)) db.createObjectStore(RUNS, { keyPath: "id" });
      if (!db.objectStoreNames.contains(ART)) db.createObjectStore(ART);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export async function abSaveRun(meta: AbRunMeta, bases: Record<string, string>): Promise<void> {
  const db = await open();
  try {
    const tx = db.transaction([RUNS, ART], "readwrite");
    tx.objectStore(RUNS).put(meta);
    tx.objectStore(ART).put(bases, meta.id);
    await done(tx);
  } finally {
    db.close();
  }
}

export async function abListRuns(): Promise<AbRunMeta[]> {
  const db = await open();
  try {
    const tx = db.transaction(RUNS, "readonly");
    const req = tx.objectStore(RUNS).getAll();
    await done(tx);
    return (req.result as AbRunMeta[]).sort((a, b) => b.createdAt - a.createdAt);
  } finally {
    db.close();
  }
}

export async function abLoadArt(id: string): Promise<Record<string, string> | null> {
  const db = await open();
  try {
    const tx = db.transaction(ART, "readonly");
    const req = tx.objectStore(ART).get(id);
    await done(tx);
    return (req.result as Record<string, string>) || null;
  } finally {
    db.close();
  }
}

export async function abDeleteRun(id: string): Promise<void> {
  const db = await open();
  try {
    const tx = db.transaction([RUNS, ART], "readwrite");
    tx.objectStore(RUNS).delete(id);
    tx.objectStore(ART).delete(id);
    await done(tx);
  } finally {
    db.close();
  }
}

/** Rough on-disk size, so the operator can see why the browser is asking. */
export async function abHistoryUsage(): Promise<number> {
  try {
    const est = await navigator.storage?.estimate?.();
    return est?.usage || 0;
  } catch {
    return 0;
  }
}
