/**
 * Tiny versioned localStorage store.
 *
 * Everything is saved as { v: <schema version>, data }. On load, anything older
 * than the current version goes through `migrate`, one version at a time, so a
 * schema change never strands data a shopper already has. Corrupt or unknown
 * (newer) data falls back to the initial value instead of crashing the app.
 */

export interface Envelope {
  v: number;
  data: unknown;
}

export type Migration = (data: unknown) => unknown;

export interface StoreSpec<T> {
  key: string;
  version: number;
  initial: () => T;
  /** migrations[n] upgrades version n data to version n + 1 */
  migrations?: Record<number, Migration>;
  /** final shape check; return null if unusable */
  validate: (data: unknown) => T | null;
}

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

export function parseEnvelope(raw: string | null): Envelope | null {
  if (raw === null) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed === 'object' && parsed !== null && 'v' in parsed && typeof (parsed as Envelope).v === 'number') {
      return parsed as Envelope;
    }
  } catch {
    /* fall through */
  }
  return null;
}

export function migrateEnvelope<T>(env: Envelope | null, spec: StoreSpec<T>): T {
  if (!env || env.v > spec.version || env.v < 1) return spec.initial();
  let data = env.data;
  try {
    for (let v = env.v; v < spec.version; v++) {
      const m = spec.migrations?.[v];
      if (!m) return spec.initial();
      data = m(data);
    }
  } catch {
    return spec.initial();
  }
  return spec.validate(data) ?? spec.initial();
}

export interface Store<T> {
  get(): T;
  set(next: T | ((prev: T) => T)): void;
  subscribe(listener: () => void): () => void;
  /** re-read from storage (tests, cross-tab) */
  reload(): void;
}

export function createStore<T>(spec: StoreSpec<T>): Store<T> {
  const read = (): T => {
    let raw: string | null;
    try {
      raw = storage()?.getItem(spec.key) ?? null;
    } catch {
      raw = null;
    }
    return migrateEnvelope(parseEnvelope(raw), spec);
  };
  let state = read();
  const listeners = new Set<() => void>();
  const emit = () => listeners.forEach((l) => l());

  if (typeof window !== 'undefined') {
    window.addEventListener('storage', (e) => {
      if (e.key === spec.key) {
        state = read();
        emit();
      }
    });
  }

  return {
    get: () => state,
    set(next) {
      state = typeof next === 'function' ? (next as (p: T) => T)(state) : next;
      try {
        storage()?.setItem(spec.key, JSON.stringify({ v: spec.version, data: state } satisfies Envelope));
      } catch {
        /* quota or private mode: keep working in memory */
      }
      emit();
    },
    subscribe(l) {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    reload() {
      state = read();
      emit();
    },
  };
}
