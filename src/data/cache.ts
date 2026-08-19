// IndexedDB-backed cache for RFS forecast / retrospective / return-period
// payloads, following the pattern in geoglows/rfs-v2-hydroviewer
// (src/data/cache.js). Keeps the N most-recent entries by write time.

const CACHE_SIZE = 300;
const DB_NAME = 'geoglowsEvalDB';
const DB_VERSION = 1;

export const CACHE_STORE = 'discharge';

export type CacheType = 'forecast' | 'retro' | 'retper';

interface CacheRecord<T> {
  key: string;
  data: T;
  timestamp: number;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(CACHE_STORE)) {
        db.createObjectStore(CACHE_STORE, { keyPath: 'key' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function pruneCache(): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(CACHE_STORE, 'readwrite');
    const store = tx.objectStore(CACHE_STORE);
    const req = store.getAll();
    req.onsuccess = () => {
      const items = req.result as CacheRecord<unknown>[];
      if (items.length > CACHE_SIZE) {
        items.sort((a, b) => a.timestamp - b.timestamp);
        const toRemove = items.length - CACHE_SIZE;
        for (let i = 0; i < toRemove; i++) store.delete(items[i].key);
      }
      resolve();
    };
    req.onerror = () => reject(req.error);
  });
}

export function cacheKey(opts: {
  riverId: number;
  type: CacheType;
  date?: string;
}): string {
  let date: string;
  if (opts.type === 'retro') {
    // Roll the key forward once per day so daily retro refreshes ~12h after UTC midnight.
    date = new Date(Date.now() - 12 * 3600 * 1000)
      .toISOString()
      .slice(0, 10)
      .replaceAll('-', '');
  } else if (opts.type === 'retper') {
    date = 'static';
  } else {
    if (!opts.date) throw new Error('forecast cache key requires a date');
    date = opts.date;
  }
  return `${opts.riverId}_${opts.type}_${date}`;
}

export async function readCache<T>(key: string): Promise<T | undefined> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(CACHE_STORE, 'readonly');
    const req = tx.objectStore(CACHE_STORE).get(key);
    req.onsuccess = () =>
      resolve(req.result ? (req.result as CacheRecord<T>).data : undefined);
    req.onerror = () => reject(req.error);
  });
}

export async function writeCache<T>(key: string, data: T): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(CACHE_STORE, 'readwrite');
    tx.objectStore(CACHE_STORE).put({ key, data, timestamp: Date.now() });
    tx.oncomplete = () => {
      void pruneCache().catch(() => {});
      resolve();
    };
    tx.onerror = () => reject(tx.error);
  });
}

export async function clearCache(): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(CACHE_STORE, 'readwrite');
    tx.objectStore(CACHE_STORE).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
