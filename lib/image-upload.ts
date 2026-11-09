import { api, ApiError } from "./api";

/** Each part is uploaded in its own request. */
export const IMAGE_PART_BYTES = 1024 * 1024;
export const MAX_IMAGE_BYTES = 50 * 1024 * 1024;
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

/**
 * Uploads the image under the message's id, so it can then be sent as an "image" frame. Every
 * step is safe to repeat, and only the parts the backend doesn't have yet are sent, so a stopped
 * (paused or failed) upload continues where it left off when started again.
 */
export async function uploadImage(
  token: string,
  messageId: string,
  file: File,
  { signal, onProgress }: { signal?: AbortSignal; onProgress?: (done: number) => void } = {},
) {
  const parts = Math.ceil(file.size / IMAGE_PART_BYTES);
  await withRetry(signal, () =>
    api.initiateFile(
      token,
      { extension: extensionOf(file)!, sizeKb: Math.ceil(file.size / 1024), messageId, parts },
      signal,
    ),
  );
  const missing = await withRetry(signal, () => missingParts(token, messageId, parts, signal));
  let done = parts - missing.length;
  onProgress?.(done / parts);
  for (const partNo of missing) {
    const bytes = file.slice(partNo * IMAGE_PART_BYTES, (partNo + 1) * IMAGE_PART_BYTES);
    await withRetry(signal, () => api.putFilePart(token, messageId, partNo, bytes, signal));
    onProgress?.(++done / parts);
  }
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
