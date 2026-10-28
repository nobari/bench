/** The document information dictionary with pdf-lib (pdf.js reads it for the Info panel). */
import type { PDFDocument } from "@cantoo/pdf-lib";

export interface PdfInfo {
  title: string;
  author: string;
  subject: string;
  keywords: string;
  creator: string;
  producer: string;
}

export function readInfo(doc: PDFDocument): PdfInfo {
  return {
    title: doc.getTitle() ?? "",
    author: doc.getAuthor() ?? "",
    subject: doc.getSubject() ?? "",
    keywords: doc.getKeywords() ?? "",
    creator: doc.getCreator() ?? "",
    producer: doc.getProducer() ?? "",
  };
}

/** Writes the fields given (an empty string clears one) and stamps the modification date. */
export function writeInfo(doc: PDFDocument, patch: Partial<PdfInfo>, when = new Date()): void {
  if (patch.title !== undefined) doc.setTitle(patch.title, { showInWindowTitleBar: true });
  if (patch.author !== undefined) doc.setAuthor(patch.author);
  if (patch.subject !== undefined) doc.setSubject(patch.subject);
  // pdf-lib joins a list with spaces; the Keywords entry is one free string, so it is written as typed.
  if (patch.keywords !== undefined) doc.setKeywords(patch.keywords.trim() ? [patch.keywords.trim()] : []);
  if (patch.creator !== undefined) doc.setCreator(patch.creator);
  if (patch.producer !== undefined) doc.setProducer(patch.producer);
  doc.setModificationDate(when);
}
