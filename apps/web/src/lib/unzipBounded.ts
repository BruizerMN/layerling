import { unzip, unzipSync, strFromU8, type UnzipFileInfo } from "fflate";

/**
 * Unpacks a ZIP package (a .lyl) with a bounded number of Workers.
 *
 * fflate's `unzip()` starts one Worker for every entry that expands to 512 KiB or more, all at once. A large design
 * has dozens of them (Foshay: 80 meshes plus project.json), and every Worker costs tens of MB before it inflates a
 * byte, so opening used to peak at several GB. Here
 *   - entries below `workerFromBytes` are inflated right here, in slices, handing the thread back between slices;
 *   - larger ones go to at most `maxWorkers` Workers at a time;
 *   - a Worker that fails, or does not answer within its time (`workerTimeoutMs` plus `workerMsPerMiB` per MiB), is
 *     terminated and its entry is inflated here instead, so a lost Worker can delay an opening but never hang it.
 * The files come back exactly as `unzip()` returns them (same bytes, same order as the ZIP directory).
 */
export interface ZipEntry {
  name: string;
  /** 0 = stored, 8 = deflate; anything else is refused before it gets here. */
  method: number;
  compressedSize: number;
  expandedSize: number;
}

export type UnzipEvent =
  | { type: "worker-start"; name: string }
  | { type: "worker-done"; name: string }
  | { type: "fallback"; name: string; reason: "timeout" | "error"; message: string };

export interface UnzipBoundedOptions {
  /** Which entries to read (all when omitted). */
  filter?: (entry: ZipEntry) => boolean;
  /** Most Worker inflations at once. Default 2. */
  maxWorkers?: number;
  /** Entries expanding to at least this many bytes may use a Worker. Default 8 MiB. */
  workerFromBytes?: number;
  /** Bytes (expanded) inflated in one go before the thread is handed back. Default 8 MiB. */
  sliceBytes?: number;
  /** Time a Worker gets before it is given up on: this plus `workerMsPerMiB` per expanded MiB. Default 20 s + 250 ms/MiB. */
  workerTimeoutMs?: number;
  workerMsPerMiB?: number;
  /** For diagnostics and tests. */
  onEvent?: (event: UnzipEvent) => void;
}

/** One Worker inflation in progress: its answer, and a way to stop it for good (late answers are ignored). */
export interface InflateJob {
  promise: Promise<Uint8Array>;
  cancel(): void;
}

/** The two ways of inflating, replaceable so the failure paths can be tested. */
export interface UnzipDeps {
  inflateHere(bytes: Uint8Array, names: ReadonlySet<string>): Record<string, Uint8Array>;
  inflateInWorker(bytes: Uint8Array, entry: ZipEntry): InflateJob;
  yieldThread(): Promise<void>;
}

const MIB = 1024 * 1024;

/** The central directory of a ZIP, read without expanding anything. Callers have validated the package already; this refuses what it cannot read. */
export function readZipDirectory(bytes: Uint8Array): ZipEntry[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  for (let offset = bytes.byteLength - 22; offset >= Math.max(0, bytes.byteLength - 65_557); offset -= 1) {
    if (view.getUint32(offset, true) === 0x06054b50) {
      eocd = offset;
      break;
    }
  }
  if (eocd < 0) throw new Error("ZIP directory not found");
  const count = view.getUint16(eocd + 10, true);
  let offset = view.getUint32(eocd + 16, true);
  const entries: ZipEntry[] = [];
  for (let index = 0; index < count; index += 1) {
    if (offset + 46 > bytes.byteLength || view.getUint32(offset, true) !== 0x02014b50) throw new Error("ZIP directory is malformed");
    const nameLength = view.getUint16(offset + 28, true);
    const end = offset + 46 + nameLength + view.getUint16(offset + 30, true) + view.getUint16(offset + 32, true);
    if (end > bytes.byteLength) throw new Error("ZIP directory is truncated");
    entries.push({
      name: strFromU8(bytes.subarray(offset + 46, offset + 46 + nameLength)),
      method: view.getUint16(offset + 10, true),
      compressedSize: view.getUint32(offset + 20, true),
      expandedSize: view.getUint32(offset + 24, true),
    });
    offset = end;
  }
  return entries;
}

export const defaultUnzipDeps: UnzipDeps = {
  inflateHere: (bytes, names) => unzipSync(bytes, { filter: (file: UnzipFileInfo) => names.has(file.name) }),
  inflateInWorker: (bytes, entry) => {
    let stop: () => void = () => undefined;
    let cancelled = false;
    const promise = new Promise<Uint8Array>((resolve, reject) => {
      stop = unzip(bytes, { filter: (file: UnzipFileInfo) => file.name === entry.name }, (error, files) => {
        if (cancelled) return;
        if (error) reject(error);
        else if (!files[entry.name]) reject(new Error(`'${entry.name}' missing from the unpacked files`));
        else resolve(files[entry.name]);
      });
    });
    return {
      promise,
      cancel: () => {
        cancelled = true;
        try {
          stop();
        } catch {
          // Already finished or gone.
        }
      },
    };
  },
  yieldThread: () => new Promise<void>((resolve) => setTimeout(resolve, 0)),
};

class WorkerTimeout extends Error {
  constructor(ms: number) {
    super(`worker did not answer within ${Math.round(ms)} ms`);
  }
}

export async function unzipBounded(bytes: Uint8Array, options: UnzipBoundedOptions = {}, deps: UnzipDeps = defaultUnzipDeps): Promise<Record<string, Uint8Array>> {
  const maxWorkers = Math.max(1, Math.floor(options.maxWorkers ?? 2));
  const workerFromBytes = options.workerFromBytes ?? 8 * MIB;
  const sliceBytes = Math.max(1, options.sliceBytes ?? 8 * MIB);
  const baseTimeout = options.workerTimeoutMs ?? 20_000;
  const perMiB = options.workerMsPerMiB ?? 250;
  const emit = options.onEvent ?? (() => undefined);

  const wanted = readZipDirectory(bytes).filter((entry) => (options.filter ? options.filter(entry) : true));
  const small = wanted.filter((entry) => !(entry.method === 8 && entry.expandedSize >= workerFromBytes));
  const large = wanted.filter((entry) => entry.method === 8 && entry.expandedSize >= workerFromBytes);
  const unpacked = new Map<string, Uint8Array>();

  // Large entries first, in the background of the small ones' slices, so the biggest piece of work starts at once.
  const active = new Set<InflateJob>();
  let aborted = false;
  let nextLarge = 0;
  const inflateLarge = async (entry: ZipEntry): Promise<Uint8Array> => {
    const limit = baseTimeout + perMiB * (entry.expandedSize / MIB);
    let job: InflateJob | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      emit({ type: "worker-start", name: entry.name });
      job = deps.inflateInWorker(bytes, entry);
      active.add(job);
      job.promise.catch(() => undefined); // an answer that comes after we gave up is not an unhandled rejection
      const answer = await Promise.race([
        job.promise,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new WorkerTimeout(limit)), limit);
        }),
      ]);
      emit({ type: "worker-done", name: entry.name });
      return answer;
    } catch (error) {
      if (job) job.cancel();
      emit({ type: "fallback", name: entry.name, reason: error instanceof WorkerTimeout ? "timeout" : "error", message: error instanceof Error ? error.message : String(error) });
      // Data that really is damaged fails here too, and that error is the one reported.
      return deps.inflateHere(bytes, new Set([entry.name]))[entry.name];
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      if (job) {
        active.delete(job);
        job.cancel(); // no-op when it finished; frees the Worker when it did not
      }
    }
  };
  const largeLane = async () => {
    try {
      while (!aborted && nextLarge < large.length) {
        const entry = large[nextLarge++];
        unpacked.set(entry.name, await inflateLarge(entry));
      }
    } catch (error) {
      aborted = true; // the other lane and the small entries stop at their next step
      throw error;
    }
  };
  const lanes = Promise.all(Array.from({ length: Math.min(maxWorkers, large.length) }, largeLane));
  lanes.catch(() => undefined);

  try {
    let index = 0;
    while (index < small.length) {
      if (aborted) break;
      const slice: ZipEntry[] = [];
      let bytesInSlice = 0;
      while (index < small.length && slice.length < 512 && (slice.length === 0 || bytesInSlice + small[index].expandedSize <= sliceBytes)) {
        bytesInSlice += small[index].expandedSize;
        slice.push(small[index++]);
      }
      const done = deps.inflateHere(bytes, new Set(slice.map((entry) => entry.name)));
      for (const entry of slice) unpacked.set(entry.name, done[entry.name]);
      if (index < small.length) await deps.yieldThread();
    }
    await lanes;
  } catch (error) {
    aborted = true;
    for (const job of active) job.cancel();
    throw error;
  }

  const files: Record<string, Uint8Array> = {};
  for (const entry of wanted) {
    const data = unpacked.get(entry.name);
    if (!data) throw new Error(`'${entry.name}' was not unpacked`);
    files[entry.name] = data;
  }
  return files;
}
