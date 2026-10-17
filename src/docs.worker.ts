/* Worker entry for document text extraction.
 *
 * Everything CPU-bound about attachments (PDF text layers, Office XML,
 * inflating archives) runs here so a large file cannot freeze the tab. The
 * extraction functions themselves live in docs.ts and are shared with the
 * in-process fallback in `extractOffThread`. */

import { runExtraction, type DocWorkerReply, type DocWorkerRequest } from './docs'

/* Minimal worker-global typing: the app's tsconfig targets the DOM lib, where
 * `DedicatedWorkerGlobalScope` is not declared. */
type WorkerGlobal = {
  onmessage: ((e: MessageEvent<DocWorkerRequest>) => void) | null
  postMessage: (message: DocWorkerReply) => void
}

const ctx = self as unknown as WorkerGlobal

ctx.onmessage = (e: MessageEvent<DocWorkerRequest>) => {
  const { id, kind, bytes, arg } = e.data
  let reply: DocWorkerReply
  try {
    reply = { id, ok: true, value: runExtraction(kind, bytes, arg) }
  } catch (x) {
    reply = { id, ok: false, error: x instanceof Error ? x.message : String(x) }
  }
  ctx.postMessage(reply)
}
