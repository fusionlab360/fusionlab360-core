export class RequestBodyTooLargeError extends Error {
  constructor(readonly limitBytes: number) {
    super("Request body exceeds the configured limit.");
    this.name = "RequestBodyTooLargeError";
  }
}

/** Accumulate a request body only while it stays within limitBytes; preserve its exact bytes. */
export async function readBoundedBody(request: Request, limitBytes: number): Promise<Uint8Array> {
  if (!Number.isSafeInteger(limitBytes) || limitBytes < 0) {
    throw new RangeError("Request body limit must be a non-negative safe integer.");
  }
  const contentLength = request.headers.get("content-length");
  if (contentLength !== null) {
    if (!/^\d+$/.test(contentLength)) throw new TypeError("Malformed Content-Length.");
    if (Number(contentLength) > limitBytes) throw new RequestBodyTooLargeError(limitBytes);
  }
  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limitBytes) {
        void reader.cancel().catch(() => undefined);
        throw new RequestBodyTooLargeError(limitBytes);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

export function decodeUtf8Body(bytes: Uint8Array): string {
  return new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes);
}
