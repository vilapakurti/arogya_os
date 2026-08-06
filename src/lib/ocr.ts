import { getDocument, GlobalWorkerOptions, type PDFDocumentProxy } from "pdfjs-dist";
import Tesseract from "tesseract.js/dist/tesseract.esm.min.js";
import type { Worker as TesseractWorker } from "tesseract.js";

/**
 * Medical Report OCR (Feature 2).
 *
 * Runs entirely in the browser: PDFs are rasterized page-by-page with
 * pdf.js, then each page (or image) is recognized with Tesseract.js.
 * No external API key or server is required.
 *
 * NOTE on the tesseract.js import: the package's `main` entry is CommonJS
 * that pulls in the Node worker (which uses `__dirname` and crashes Vite's
 * browser build). We therefore import the browser-native ESM bundle
 * (`dist/tesseract.esm.min.js`) — identical API — and keep the package's own
 * type definitions via a type-only import (erased at runtime). The bundle's
 * worker/core/language assets load from the tesseract.js CDN at runtime.
 *
 * The module is intentionally isolated so a commercial OCR API can be
 * swapped in later without touching the pipeline or the UI.
 */

// Point pdf.js at its bundled worker (Vite resolves this asset URL).
GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url,
).toString();

const { createWorker, PSM } = Tesseract;

export type OcrErrorCode =
  | "timeout"
  | "unsupported"
  | "empty"
  | "network"
  | "download";

export class OcrError extends Error {
  readonly code: OcrErrorCode;

  constructor(code: OcrErrorCode, message: string) {
    super(message);
    this.name = "OcrError";
    this.code = code;
  }
}

export function isOcrError(err: unknown): err is OcrError {
  return err instanceof OcrError;
}

export interface OcrProgress {
  /** Overall progress across the whole document, 0..1. */
  ratio: number;
  /** Human-readable status, e.g. "Extracting text · page 2 of 5…" */
  message: string;
}

export interface OcrResult {
  text: string;
}

const PER_PAGE_TIMEOUT_MS = 90_000;
const MIN_TEXT_LENGTH = 12;
const PDF_RENDER_SCALE = 2.5;

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new OcrError("timeout", message)),
      ms,
    );
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

/** Normalizes any thrown value into a user-facing OcrError. */
function toOcrError(
  err: unknown,
  fallbackCode: OcrErrorCode,
  fallbackMessage: string,
): OcrError {
  if (err instanceof OcrError) return err;
  const message = err instanceof Error ? err.message : String(err);
  if (/timeout|timed out/i.test(message)) {
    return new OcrError(
      "timeout",
      "OCR timed out before it could finish. Try a smaller or clearer document.",
    );
  }
  if (
    /fetch|network|failed to fetch|ENOTFOUND|ERR_INTERNET|traineddata|cors|load tesseract/i.test(
      message,
    )
  ) {
    return new OcrError(
      "network",
      "Network failure — the OCR engine assets could not be loaded. Check your connection and try again.",
    );
  }
  if (/invalid|corrupt|password|encrypted|not a pdf|could not load|empty file/i.test(message)) {
    return new OcrError(
      "unsupported",
      "This document could not be read by the OCR engine. It may be corrupted, password-protected, or in an unsupported format.",
    );
  }
  return new OcrError(fallbackCode, fallbackMessage);
}

async function createOcrWorker(): Promise<TesseractWorker> {
  try {
    const worker = await createWorker("eng", 1, {
      // Keep default logging; progress is reported through our own callback.
      logger: () => {},
    });
    await worker.setParameters({
      tessedit_pageseg_mode: PSM.AUTO,
      preserve_interword_spaces: "1",
    });
    return worker;
  } catch (err) {
    throw toOcrError(
      err,
      "network",
      "The OCR engine could not start. Check your network connection and try again.",
    );
  }
}

async function recognizeBlob(
  worker: TesseractWorker,
  blob: Blob,
  pageLabel: string,
): Promise<string> {
  try {
    const { data } = await withTimeout(
      worker.recognize(blob),
      PER_PAGE_TIMEOUT_MS,
      `OCR timed out while reading ${pageLabel}.`,
    );
    return (data.text ?? "").trim();
  } catch (err) {
    throw toOcrError(err, "unsupported", `The OCR engine could not read ${pageLabel}.`);
  }
}

async function rasterizePage(pdf: PDFDocumentProxy, pageNumber: number): Promise<Blob> {
  const page = await pdf.getPage(pageNumber);
  const viewport = page.getViewport({ scale: PDF_RENDER_SCALE });

  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) {
    throw new OcrError(
      "unsupported",
      "This browser could not render the document for OCR.",
    );
  }

  await page.render({ canvas, canvasContext: context, viewport }).promise;

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/png"),
  );
  if (!blob) {
    throw new OcrError(
      "unsupported",
      "This document could not be rasterized for OCR.",
    );
  }
  return blob;
}

function isPdf(file: File): boolean {
  return file.type === "application/pdf" || /\.pdf$/i.test(file.name);
}

/**
 * Extracts plain text from a PDF / JPG / JPEG / PNG report.
 * Throws OcrError with a structured code on timeout, unsupported document,
 * empty result, or network failure.
 */
export async function runOcr(
  file: File,
  onProgress?: (progress: OcrProgress) => void,
): Promise<OcrResult> {
  const worker = await createOcrWorker();
  try {
    let text: string;

    if (isPdf(file)) {
      let pdf: PDFDocumentProxy;
      let task: ReturnType<typeof getDocument>;
      try {
        const data = await file.arrayBuffer();
        task = getDocument({ data });
        pdf = await task.promise;
      } catch (err) {
        throw toOcrError(
          err,
          "unsupported",
          "The PDF could not be opened for OCR. It may be corrupted or password-protected.",
        );
      }

      const totalPages = pdf.numPages;
      const pageBlobs: Blob[] = [];
      try {
        for (let i = 1; i <= totalPages; i++) {
          onProgress?.({
            ratio: (i - 1) / Math.max(totalPages, 1),
            message: `Rendering page ${i} of ${totalPages}…`,
          });
          pageBlobs.push(await rasterizePage(pdf, i));
        }
      } finally {
        await task.destroy().catch(() => {});
      }

      const parts: string[] = [];
      for (let i = 0; i < pageBlobs.length; i++) {
        onProgress?.({
          ratio: (i + 1) / Math.max(pageBlobs.length, 1),
          message: `Extracting text · page ${i + 1} of ${pageBlobs.length}…`,
        });
        const pageText = await recognizeBlob(worker, pageBlobs[i], `page ${i + 1}`);
        parts.push(
          pageBlobs.length > 1 ? `----- Page ${i + 1} -----\n${pageText}` : pageText,
        );
      }
      text = parts.join("\n\n");
    } else {
      onProgress?.({ ratio: 0.25, message: "Extracting text…" });
      text = await recognizeBlob(worker, file, "the document");
    }

    if (text.replace(/\s+/g, "").length < MIN_TEXT_LENGTH) {
      throw new OcrError(
        "empty",
        "No text could be extracted from this document. It may be an unclear scan, a photo at an angle, or a document with no machine-readable text.",
      );
    }

    return { text };
  } finally {
    await worker.terminate().catch(() => {});
  }
}
