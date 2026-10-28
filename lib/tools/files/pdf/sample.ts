/**
 * The bundled sample: six pages with an outline, body text under existing comments (a highlight with a reply, a
 * resolved note, an underline, a strike-out, a shape), a form, a landscape figure page, links and an attachment —
 * built with pdf-lib on demand, deterministically, so examples, tests and the empty state have something to open.
 */
import { PDFDocument, PDFHexString, PDFName, PDFString, StandardFonts, rgb, type PDFFont, type PDFPage } from "@cantoo/pdf-lib";
import { addNote, addReply, addTextMarkup, setReviewState } from "./annots";
import { pdfDate } from "./dates";

export const SAMPLE_NAME = "pdf-studio-sample.pdf";

const WHEN = new Date(Date.UTC(2026, 9, 20, 9, 30, 0));
const LATER = new Date(Date.UTC(2026, 9, 21, 14, 5, 0));
const INK = rgb(0.12, 0.12, 0.14);
const MUTED = rgb(0.4, 0.42, 0.46);
const LINE = rgb(0.82, 0.83, 0.86);

interface Box {
  x: number;
  y: number;
  w: number;
  size: number;
}

function wrap(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    const next = line ? `${line} ${w}` : w;
    if (font.widthOfTextAtSize(next, size) > maxWidth && line) {
      lines.push(line);
      line = w;
    } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}

/** Draws a paragraph and returns a box per line (for quads). */
function paragraph(page: PDFPage, font: PDFFont, text: string, x: number, y: number, size: number, maxWidth: number, leading = size * 1.45): { boxes: Box[]; y: number } {
  const boxes: Box[] = [];
  let cy = y;
  for (const line of wrap(text, font, size, maxWidth)) {
    page.drawText(line, { x, y: cy, size, font, color: INK });
    boxes.push({ x, y: cy, w: font.widthOfTextAtSize(line, size), size });
    cy -= leading;
  }
  return { boxes, y: cy };
}

const quad = (b: Box): number[] => [b.x, b.y + b.size * 0.82, b.x + b.w, b.y + b.size * 0.82, b.x, b.y - b.size * 0.24, b.x + b.w, b.y - b.size * 0.24];

function heading(page: PDFPage, bold: PDFFont, regular: PDFFont, number: string, title: string, y: number) {
  page.drawText(number, { x: 72, y, size: 11, font: regular, color: MUTED });
  page.drawText(title, { x: 72, y: y - 26, size: 22, font: bold, color: INK });
  page.drawLine({ start: { x: 72, y: y - 38 }, end: { x: 540, y: y - 38 }, thickness: 0.6, color: LINE });
}

function footer(page: PDFPage, font: PDFFont, n: number, total: number) {
  const { width } = page.getSize();
  page.drawText("PDF Studio sample", { x: 72, y: 40, size: 9, font, color: MUTED });
  const label = `${n} / ${total}`;
  page.drawText(label, { x: width - 72 - font.widthOfTextAtSize(label, 9), y: 40, size: 9, font, color: MUTED });
}

export async function buildSamplePdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create({ updateMetadata: false });
  doc.setTitle("PDF Studio sample", { showInWindowTitleBar: true });
  doc.setAuthor("Bench");
  doc.setSubject("A document to try the viewer, comments, forms and pages on");
  doc.setKeywords(["sample", "pdf", "comments", "forms"]);
  doc.setCreator("Bench PDF Studio");
  doc.setProducer("Bench PDF Studio");
  doc.setCreationDate(WHEN);
  doc.setModificationDate(LATER);
  doc.setLanguage("en");

  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const mono = await doc.embedFont(StandardFonts.Courier);
  const total = 6;

  /* 1 — cover */
  const cover = doc.addPage([612, 792]);
  cover.drawRectangle({ x: 0, y: 612, width: 612, height: 180, color: rgb(0.95, 0.95, 0.96) });
  cover.drawText("PDF Studio", { x: 72, y: 700, size: 34, font: bold, color: INK });
  cover.drawText("A sample document for the viewer, comments, forms and pages", { x: 72, y: 672, size: 12, font: regular, color: MUTED });
  let y = 560;
  cover.drawText("What to try", { x: 72, y, size: 14, font: bold, color: INK });
  y -= 26;
  for (const line of [
    "Open the Comments tab: page 2 carries a highlight with a reply, a resolved note, an underline and a strike-out.",
    "Select text anywhere and highlight it, or leave a note by clicking a page with the Note tool.",
    "Fill the form on page 3 — the values are written into the file when you save.",
    "The Pages tab reorders, rotates, deletes, duplicates and extracts pages, and merges in another PDF.",
    "The Outline tab lists the chapters; Attachments holds a text file that travels with the document.",
  ]) {
    const r = paragraph(cover, regular, `•  ${line}`, 72, y, 11, 460);
    y = r.y - 4;
  }
  cover.drawText("Made with pdf-lib in your browser · nothing here was uploaded", { x: 72, y: 96, size: 9, font: mono, color: MUTED });
  footer(cover, regular, 1, total);

  /* 2 — reading, with comments */
  const reading = doc.addPage([612, 792]);
  heading(reading, bold, regular, "1", "Reading", 720);
  y = 650;
  const p1 = paragraph(
    reading,
    regular,
    "A PDF viewer draws each page from its content stream: text set in embedded or standard fonts, vector paths, and images, all placed in a coordinate space measured in points from the bottom-left corner. Annotations sit above the content in their own layer, which is why a highlight can be added, moved or removed without touching the page beneath it.",
    72,
    y,
    11,
    468,
  );
  y = p1.y - 10;
  const p2 = paragraph(
    reading,
    regular,
    "Comments are annotations too. A sticky note is a Text annotation with a Popup; a reply is another note that points at its parent, and a review state — Completed, say — is recorded the same way. Because every viewer reads the same structures, a comment left here opens in Acrobat, Preview and Firefox alike. This sentence is here only to be struck out.",
    72,
    y,
    11,
    468,
  );
  y = p2.y - 10;
  const p3 = paragraph(
    reading,
    regular,
    "Form fields are annotations of the Widget kind, bound to fields in the document's form; filling one changes the field's value, and flattening draws the value into the page for good. Page structure lives elsewhere, in the page tree, so reordering or rotating pages leaves their content and comments untouched.",
    72,
    y,
    11,
    468,
  );
  footer(reading, regular, 2, total);

  const highlightId = addTextMarkup(doc, { page: 1, subtype: "Highlight", quads: [...quad(p1.boxes[1]), ...quad(p1.boxes[2])], color: [1, 0.93, 0.45], author: "Reviewer", text: "Is this still the right way to put it? Fonts can also be referenced by name alone.", date: WHEN });
  if (highlightId) addReply(doc, { parentId: highlightId, text: "Yes — the standard 14 fonts need no embedding, which is what the next sentence covers.", author: "Author", date: LATER });
  const noteId = addNote(doc, { page: 1, x: 548, y: p1.boxes[0].y + 12, text: "Add a small diagram of the layers here?", author: "Reviewer", color: [1, 0.78, 0.25], date: WHEN });
  setReviewState(doc, { parentId: noteId, resolved: true, author: "Author", date: LATER });
  addTextMarkup(doc, { page: 1, subtype: "Underline", quads: quad(p3.boxes[0]), color: [0.2, 0.5, 0.9], author: "Reviewer", date: WHEN });
  const lastLine = p2.boxes[p2.boxes.length - 1];
  const tail = "This sentence is here only to be struck out.";
  const tailWidth = regular.widthOfTextAtSize(tail, 11);
  addTextMarkup(doc, { page: 1, subtype: "StrikeOut", quads: quad({ x: lastLine.x + lastLine.w - tailWidth, y: lastLine.y, w: tailWidth, size: 11 }), color: [0.85, 0.2, 0.2], author: "Reviewer", text: "Drop this sentence.", date: WHEN });

  /* 3 — forms */
  const forms = doc.addPage([612, 792]);
  heading(forms, bold, regular, "2", "Forms", 720);
  paragraph(forms, regular, "These fields are real AcroForm fields. Type into them, tick, choose — then Save, and the values are in the file.", 72, 650, 11, 468);
  const form = doc.getForm();
  const label = (text: string, ly: number) => forms.drawText(text, { x: 72, y: ly, size: 10.5, font: regular, color: MUTED });
  label("Name", 606);
  const name = form.createTextField("name");
  name.setText("Ada Lovelace");
  name.addToPage(forms, { x: 200, y: 596, width: 260, height: 22, borderWidth: 1, borderColor: LINE, backgroundColor: rgb(0.985, 0.985, 0.99), font: regular });
  label("Email", 570);
  const email = form.createTextField("email");
  email.addToPage(forms, { x: 200, y: 560, width: 260, height: 22, borderWidth: 1, borderColor: LINE, backgroundColor: rgb(0.985, 0.985, 0.99), font: regular });
  label("Size", 534);
  const size = form.createRadioGroup("size");
  const sizes = ["S", "M", "L"];
  sizes.forEach((s, i) => {
    size.addOptionToPage(s, forms, { x: 200 + i * 70, y: 526, width: 14, height: 14, borderWidth: 1, borderColor: LINE });
    forms.drawText(s, { x: 220 + i * 70, y: 529, size: 10.5, font: regular, color: INK });
  });
  size.select("M");
  label("Country", 498);
  const country = form.createDropdown("country");
  country.addOptions(["Japan", "India", "Iran", "Germany", "Elsewhere"]);
  country.select("Japan");
  country.addToPage(forms, { x: 200, y: 488, width: 160, height: 22, borderWidth: 1, borderColor: LINE, backgroundColor: rgb(0.985, 0.985, 0.99), font: regular });
  label("Keep me posted", 462);
  const agree = form.createCheckBox("updates");
  agree.check();
  agree.addToPage(forms, { x: 200, y: 454, width: 14, height: 14, borderWidth: 1, borderColor: LINE });
  label("Notes", 426);
  const notes = form.createTextField("notes");
  notes.enableMultiline();
  notes.addToPage(forms, { x: 200, y: 340, width: 260, height: 92, borderWidth: 1, borderColor: LINE, backgroundColor: rgb(0.985, 0.985, 0.99), font: regular });
  footer(forms, regular, 3, total);

  /* 4 — figures, landscape */
  const figures = doc.addPage([792, 612]);
  heading(figures, bold, regular, "3", "Figures", 540);
  paragraph(figures, regular, "A landscape page, to see rotation and two-up layouts behave. The boxes below are plain vector paths.", 72, 470, 11, 648);
  const colors = [rgb(0.86, 0.33, 0.3), rgb(0.95, 0.68, 0.22), rgb(0.26, 0.55, 0.85), rgb(0.36, 0.68, 0.44)];
  ["Content", "Annotations", "Form", "Page tree"].forEach((t, i) => {
    const x = 72 + i * 165;
    figures.drawRectangle({ x, y: 250, width: 140, height: 150, color: colors[i], opacity: 0.18, borderColor: colors[i], borderWidth: 1.5 });
    figures.drawText(t, { x: x + 12, y: 372, size: 12, font: bold, color: INK });
    figures.drawCircle({ x: x + 70, y: 310, size: 28, borderColor: colors[i], borderWidth: 1.5 });
  });
  footer(figures, regular, 4, total);

  /* 5 — attachments & links */
  const extras = doc.addPage([612, 792]);
  heading(extras, bold, regular, "4", "Attachments & links", 720);
  const l1 = paragraph(extras, regular, "This document carries a small text file as an attachment — open the Attachments tab to download it. Links work too:", 72, 650, 11, 468);
  extras.drawText("Back to the cover", { x: 72, y: l1.y - 10, size: 11, font: regular, color: rgb(0.14, 0.34, 0.84) });
  extras.drawText("bench.bozmoz.com", { x: 72, y: l1.y - 30, size: 11, font: regular, color: rgb(0.14, 0.34, 0.84) });
  const linkW = regular.widthOfTextAtSize("Back to the cover", 11);
  extras.node.addAnnot(doc.context.register(doc.context.obj({ Type: "Annot", Subtype: "Link", Rect: [72, l1.y - 13, 72 + linkW, l1.y + 1], Border: [0, 0, 0], Dest: [cover.ref, "Fit"] })));
  const urlW = regular.widthOfTextAtSize("bench.bozmoz.com", 11);
  extras.node.addAnnot(doc.context.register(doc.context.obj({ Type: "Annot", Subtype: "Link", Rect: [72, l1.y - 33, 72 + urlW, l1.y - 19], Border: [0, 0, 0], A: { Type: "Action", S: "URI", URI: PDFString.of("https://bench.bozmoz.com/files/pdf") } })));
  const attachment = new TextEncoder().encode("Reading notes\n\n- Page 2: the highlight and its reply\n- Page 3: the form\n- Page 4: the landscape figure\n");
  await doc.attach(attachment, "reading-notes.txt", { mimeType: "text/plain", description: "Notes that travel with the file", creationDate: WHEN, modificationDate: WHEN });
  footer(extras, regular, 5, total);

  /* 6 — appendix with a shape comment */
  const appendix = doc.addPage([612, 792]);
  heading(appendix, bold, regular, "A", "Appendix", 720);
  const a1 = paragraph(appendix, regular, "Shapes are comments as well: the box around this paragraph is a Square annotation with a note attached. Delete it from the Comments tab, or draw over it with the pen.", 72, 650, 11, 468);
  const boxTop = 650 + 14, boxBottom = a1.y + 4;
  const squareRef = doc.context.nextRef();
  const popupRef = doc.context.register(doc.context.obj({ Type: "Annot", Subtype: "Popup", Rect: [548, boxBottom, 728, boxTop], Parent: squareRef, Open: false }));
  doc.context.assign(
    squareRef,
    doc.context.obj({
      Type: "Annot",
      Subtype: "Square",
      Rect: [64, boxBottom, 548, boxTop],
      C: [0.86, 0.33, 0.3],
      CA: 1,
      BS: { W: 1.5, S: "S" },
      F: 4,
      T: PDFHexString.fromText("Reviewer"),
      Contents: PDFHexString.fromText("Keep this paragraph; it explains the shape tools."),
      M: PDFString.of(pdfDate(WHEN)),
      CreationDate: PDFString.of(pdfDate(WHEN)),
      NM: PDFString.of("bench-sample-square"),
      P: appendix.ref,
      Popup: popupRef,
    }),
  );
  appendix.node.addAnnot(squareRef);
  appendix.node.addAnnot(popupRef);
  appendix.drawText("End of sample.", { x: 72, y: a1.y - 40, size: 11, font: mono, color: MUTED });
  footer(appendix, regular, 6, total);

  /* outline */
  const outlinesRef = doc.context.nextRef();
  const items = [
    { title: "1  Reading", page: reading },
    { title: "2  Forms", page: forms },
    { title: "3  Figures", page: figures, children: [{ title: "4  Attachments & links", page: extras }] },
    { title: "A  Appendix", page: appendix },
  ];
  const refs = items.map(() => doc.context.nextRef());
  items.forEach((item, i) => {
    const entry = doc.context.obj({
      Title: PDFHexString.fromText(item.title),
      Parent: outlinesRef,
      Dest: [item.page.ref, "XYZ", null, item.page.getSize().height, null],
    });
    if (i > 0) entry.set(PDFName.of("Prev"), refs[i - 1]);
    if (i + 1 < refs.length) entry.set(PDFName.of("Next"), refs[i + 1]);
    if (item.children?.length) {
      const childRefs = item.children.map(() => doc.context.nextRef());
      item.children.forEach((child, k) => {
        const c = doc.context.obj({ Title: PDFHexString.fromText(child.title), Parent: refs[i], Dest: [child.page.ref, "XYZ", null, child.page.getSize().height, null] });
        if (k > 0) c.set(PDFName.of("Prev"), childRefs[k - 1]);
        if (k + 1 < childRefs.length) c.set(PDFName.of("Next"), childRefs[k + 1]);
        doc.context.assign(childRefs[k], c);
      });
      entry.set(PDFName.of("First"), childRefs[0]);
      entry.set(PDFName.of("Last"), childRefs[childRefs.length - 1]);
      entry.set(PDFName.of("Count"), doc.context.obj(item.children.length));
    }
    doc.context.assign(refs[i], entry);
  });
  doc.context.assign(outlinesRef, doc.context.obj({ Type: "Outlines", First: refs[0], Last: refs[refs.length - 1], Count: items.length + 1 }));
  doc.catalog.set(PDFName.of("Outlines"), outlinesRef);
  doc.catalog.set(PDFName.of("PageMode"), PDFName.of("UseOutlines"));

  return doc.save({ updateFieldAppearances: true });
}
