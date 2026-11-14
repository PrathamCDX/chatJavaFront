import { api, ApiError } from "./api";

/** Each part is uploaded in its own request. */
export const IMAGE_PART_BYTES = 1024 * 1024;
export const MAX_IMAGE_BYTES = 50 * 1024 * 1024;
/** 5 GB is 5120 parts. file.slice reads each part from disk as it's sent, so size doesn't cost memory. */
export const MAX_DOCUMENT_BYTES = 5 * 1024 * 1024 * 1024;
export const CONCURRENT_PARTS = 3;
const MAX_ATTEMPTS = 3;

// The backend only accepts these. It checks the extension, not the bytes
const EXTENSIONS: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png" };
export const IMAGE_ACCEPT = Object.keys(EXTENSIONS).join(",");

function extensionOf(file: File) {
  // Some phones leave the type empty, so fall back to the name
  return EXTENSIONS[file.type] ?? file.name.match(/\.(jpe?g|png)$/i)?.[1].toLowerCase();
}

/** Why this file can't be sent, or null if it can. */
export function imageProblem(file: File) {
  if (!extensionOf(file)) return "Only JPEG and PNG images can be sent";
  if (file.size === 0) return "That image is empty";
  if (file.size > MAX_IMAGE_BYTES) return `Images can be at most ${MAX_IMAGE_BYTES / 1024 / 1024} MB`;
  return null;
}

/** Documents can be any file. */
export function documentProblem(file: File) {
  if (file.size === 0) return "That file is empty";
  if (file.size > MAX_DOCUMENT_BYTES) return `Files can be at most ${MAX_DOCUMENT_BYTES / 1024 ** 3} GB`;
  return null;
}

/**
 * The extension a document is uploaded with. The backend takes 1 to 10 letters and digits, so a
 * name without one (or with an odd one, like ".tar-gz") is sent as "bin".
 */
export function documentExtension(file: File) {
  return file.name.match(/\.([A-Za-z0-9]{1,10})$/)?.[1].toLowerCase() ?? "bin";
}

/** What the backend records as the file's size. */
export function sizeKbOf(file: File) {
  return Math.ceil(file.size / 1024);
}

/**
 * Uploads the image under the message's id, so it can then be sent as an "image" frame. Every
 * step is safe to repeat, and only the parts the backend doesn't have yet are sent, so a stopped
 * (paused or failed) upload continues where it left off when started again.
 *
 * v1: one part at a time, in order. The app uses {@link uploadImageV2}.
 */
export async function uploadImage(
  token: string,
  messageId: string,
  file: File,
  { signal, onProgress, extension }: UploadOptions = {},
) {
  const { parts, missing } = await prepare(token, messageId, file, extension, signal);
  let done = parts - missing.length;
  onProgress?.(done / parts);
  for (const partNo of missing) {
    await withRetry(signal, () => api.putFilePart(token, messageId, partNo, partOf(file, partNo), signal));
    onProgress?.(++done / parts);
  }
}

/** How many parts {@link uploadImageV2} uploads at once. */

/**
 * v2 of {@link uploadImage}: same steps and guarantees, but uploads up to {@link CONCURRENT_PARTS}
 * parts at once, so a slow connection waits on fewer round trips. Parts can finish in any order;
 * progress counts finished parts. Once a part fails for good, the parts in flight are stopped,
 * no new ones start, and that first error is thrown.
 */
export async function uploadImageV2(
  token: string,
  messageId: string,
  file: File,
  { signal, onProgress, extension, concurrency = CONCURRENT_PARTS }: UploadOptions & { concurrency?: number } = {},
) {
  const { parts, missing } = await prepare(token, messageId, file, extension, signal);
  let done = parts - missing.length;
  onProgress?.(done / parts);

  // Stops every part in flight: when one fails for good, or when the caller aborts (pause, leaving)
  const stop = new AbortController();
  const forward = () => stop.abort(signal?.reason);
  signal?.addEventListener("abort", forward, { once: true });
  const queue = [...missing];
  let failure: { error: unknown } | null = null;

  async function worker() {
    while (!failure && queue.length > 0) {
      const partNo = queue.shift()!;
      try {
        await withRetry(stop.signal, () =>
          api.putFilePart(token, messageId, partNo, partOf(file, partNo), stop.signal),
        );
      } catch (error) {
        // Only the first: the others are just the aborts it caused
        if (!failure) {
          failure = { error };
          stop.abort();
        }
        return;
      }
      onProgress?.(++done / parts);
    }
  }

  try {
    await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, worker));
  } finally {
    signal?.removeEventListener("abort", forward);
  }
  if (failure) throw (failure as { error: unknown }).error;
}

type UploadOptions = {
  signal?: AbortSignal;
  onProgress?: (done: number) => void;
  /** Defaults to the image's; documents pass {@link documentExtension}. */
  extension?: string;
};

// Creates the file's details, then finds which parts still need sending
async function prepare(
  token: string,
  messageId: string,
  file: File,
  extension: string | undefined,
  signal?: AbortSignal,
) {
  const parts = Math.ceil(file.size / IMAGE_PART_BYTES);
  await withRetry(signal, () =>
    api.initiateFile(
      token,
      { extension: extension ?? extensionOf(file)!, sizeKb: sizeKbOf(file), messageId, parts },
      signal,
    ),
  );
  const missing = await withRetry(signal, () => missingParts(token, messageId, parts, signal));
  return { parts, missing };
}

function partOf(file: File, partNo: number) {
  return file.slice(partNo * IMAGE_PART_BYTES, (partNo + 1) * IMAGE_PART_BYTES);
}

async function missingParts(token: string, messageId: string, parts: number, signal?: AbortSignal) {
  try {
    return (await api.fileParts(token, messageId, signal)).missing;
  } catch (error) {
    // A backend without the parts endpoint: send every part
    if (error instanceof ApiError && (error.status === 404 || error.status === 405)) {
      return Array.from({ length: parts }, (_, partNo) => partNo);
    }
    throw error;
  }
}

// Retries network failures and server errors. A 4xx won't change by asking again
async function withRetry<T>(signal: AbortSignal | undefined, attempt: () => Promise<T>) {
  for (let tries = 1; ; tries++) {
    try {
      return await attempt();
    } catch (error) {
      const retryable = error instanceof ApiError && (error.status === 0 || error.status >= 500);
      if (!retryable || tries === MAX_ATTEMPTS || signal?.aborted) throw error;
      await new Promise((resolve) => setTimeout(resolve, 500 * tries));
    }
  }
}
