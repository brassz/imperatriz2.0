import { createWorker } from "tesseract.js";
import { GlobalWorkerOptions, getDocument } from "pdfjs-dist";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

export type ExtractedDocumentText = {
  fileName: string;
  mimeType: string;
  pageCount: number;
  text: string;
  extractionMode: "pdf-text" | "pdf-ocr" | "image-ocr";
};

async function runOcrOnCanvas(
  canvas: HTMLCanvasElement,
  onProgress?: (message: string) => void,
): Promise<string> {
  const worker = await createWorker("por");
  try {
    onProgress?.("Executando OCR...");
    const result = await worker.recognize(canvas);
    return String(result.data.text || "").trim();
  } finally {
    await worker.terminate();
  }
}

async function extractPdfText(buffer: ArrayBuffer, onProgress?: (message: string) => void): Promise<ExtractedDocumentText> {
  onProgress?.("Lendo PDF...");
  const pdf = await getDocument({ data: new Uint8Array(buffer) }).promise;
  const textParts: string[] = [];

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    const pageText = content.items
      .map((item) => ("str" in item ? String(item.str || "") : ""))
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    if (pageText) textParts.push(pageText);
  }

  const joined = textParts.join("\n\n").trim();
  if (joined.length >= 120) {
    return {
      fileName: "",
      mimeType: "application/pdf",
      pageCount: pdf.numPages,
      text: joined,
      extractionMode: "pdf-text",
    };
  }

  const ocrParts: string[] = [];
  const pagesToOcr = pdf.numPages;
  for (let pageNumber = 1; pageNumber <= pagesToOcr; pageNumber += 1) {
    onProgress?.(`Aplicando OCR na página ${pageNumber} de ${pagesToOcr}...`);
    const page = await pdf.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 1.8 });
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Não foi possível preparar o canvas do PDF.");
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    await page.render({ canvasContext: context, viewport }).promise;
    const pageText = await runOcrOnCanvas(canvas, onProgress);
    if (pageText) ocrParts.push(pageText);
  }

  return {
    fileName: "",
    mimeType: "application/pdf",
    pageCount: pdf.numPages,
    text: ocrParts.join("\n\n").trim(),
    extractionMode: "pdf-ocr",
  };
}

async function extractImageText(file: File, onProgress?: (message: string) => void): Promise<ExtractedDocumentText> {
  onProgress?.("Preparando imagem para OCR...");
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Não foi possível ler a imagem enviada."));
    reader.readAsDataURL(file);
  });

  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Não foi possível abrir a imagem enviada."));
    img.src = dataUrl;
  });

  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Não foi possível preparar o canvas da imagem.");

  canvas.width = image.width;
  canvas.height = image.height;
  context.drawImage(image, 0, 0);

  return {
    fileName: file.name,
    mimeType: file.type,
    pageCount: 1,
    text: await runOcrOnCanvas(canvas, onProgress),
    extractionMode: "image-ocr",
  };
}

export async function extractTextFromDocument(
  file: File,
  onProgress?: (message: string) => void,
): Promise<ExtractedDocumentText> {
  const mimeType = String(file.type || "").toLowerCase();
  if (mimeType.includes("pdf") || file.name.toLowerCase().endsWith(".pdf")) {
    const buffer = await file.arrayBuffer();
    const pdfResult = await extractPdfText(buffer, onProgress);
    return { ...pdfResult, fileName: file.name };
  }

  if (mimeType.startsWith("image/")) {
    return extractImageText(file, onProgress);
  }

  throw new Error("Envie um PDF ou imagem para análise.");
}
