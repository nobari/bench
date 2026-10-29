/**
 * The task pages around PDF Studio (merge, split, sign, compress…): each is the same widget opened for one job, with
 * its own search-facing copy. Registered from lib/tools/registry.ts.
 */
import { Crop, Droplets, EyeOff, FileImage, Hash, Images, Lock, Merge, PenLine, RotateCw, Scissors, Shrink, TextCursorInput } from "lucide-react";
import type { ToolDef } from "../../types";

const ADDED = "2026-10-29";
const PRIVACY = { q: "Is my file uploaded?", a: "No. Everything runs in your browser — pdf.js draws the document and pdf-lib rewrites it in a background thread — and Save writes to your disk or downloads a copy. Nothing leaves your device." };
const SAVE = { q: "Where does the result go?", a: "Save writes the file in place when the browser allows it (Chrome and Edge, after you pick the file); elsewhere, or with Save as…, the result downloads. Every change can be undone before you save." };

interface Seed {
  slug: string;
  preset: string;
  title: string;
  short: string;
  tagline: string;
  description: string;
  keywords: string[];
  icon: ToolDef["icon"];
  howItWorks: string;
  faq: { q: string; a: string }[];
  aliases: string[];
  related: string[];
}

const SEEDS: Seed[] = [
  {
    slug: "pdf-merge",
    preset: "merge",
    title: "Merge PDF",
    short: "Merge PDF",
    tagline: "Combine several PDFs into one, in any page order — in your browser",
    description: "Merge PDF files into one document: open the first, add the others, drag pages into order, drop pages you do not need, and save. Comments, form fields and links come along; nothing is uploaded.",
    keywords: ["merge pdf", "combine pdf", "join pdf files", "pdf merger online", "merge pdf free", "combine pdf pages", "pdf 結合"],
    icon: Merge,
    howItWorks:
      "Drop every PDF on the page at once — the first opens and the rest are appended — or open one and use Insert another PDF in the Organise tab to add files at any position. The pages appear as tiles: drag them into order, rotate or delete the ones you do not need, and Save writes the merged document. Pages are copied with their comments, form fields and links, and page labels and the outline of the first file are kept. Pictures dropped alongside become pages too.",
    faq: [
      { q: "Can I choose which pages of each file to keep?", a: "Yes. Insert the whole file, then delete the pages you do not want in the Organise tab, or extract a selection to a new file. Pages can be dragged into any order across files." },
      { q: "Do forms and comments survive the merge?", a: "Yes — pages are copied with their annotations and form widgets. Two forms with fields of the same name keep both fields." },
      PRIVACY,
    ],
    aliases: ["merge pdfs", "combine pdfs", "pdf joiner", "concatenate pdf"],
    related: ["files/pdf", "files/pdf-split", "files/pdf-rotate", "files/images-to-pdf"],
  },
  {
    slug: "pdf-split",
    preset: "split",
    title: "Split PDF",
    short: "Split PDF",
    tagline: "Cut a PDF every N pages, by ranges or by chapter — a zip of the parts, made in your browser",
    description: "Split a PDF into several files: every page, every N pages, the ranges you type (1-3, 4-6, 9), or one file per chapter of its outline. The parts download as a zip; nothing is uploaded.",
    keywords: ["split pdf", "split pdf pages", "separate pdf pages", "pdf splitter online", "extract pages from pdf", "split pdf by chapter", "pdf 分割"],
    icon: Scissors,
    howItWorks:
      "Open the PDF and the Split dialog asks how: every N pages (one file per page with N = 1), by ranges with one file per line, or by the outline's top-level chapters when the document has one. Each part is a complete PDF with its pages' comments and form values; several parts download together as a zip named after the document. To pull out a handful of pages instead, select them in the Organise tab and press Extract.",
    faq: [
      { q: "How do I split a PDF into single pages?", a: "Choose “Every 1 page”. A 40-page document gives 40 files, numbered and named by page, in one zip." },
      { q: "Can I split by bookmarks?", a: "Yes, when the PDF has an outline: “By the outline's top-level chapters” starts a new file at each chapter's first page." },
      PRIVACY,
    ],
    aliases: ["split pdf", "pdf splitter", "divide pdf", "pdf pages to files"],
    related: ["files/pdf", "files/pdf-merge", "files/pdf-to-images", "files/zip"],
  },
  {
    slug: "pdf-rotate",
    preset: "rotate",
    title: "Rotate PDF",
    short: "Rotate PDF",
    tagline: "Turn pages for good — one, a selection or all — and save",
    description: "Rotate PDF pages by 90° either way or 180°, for a single page, a range or the whole document, and save the file with the rotation written in. Reorder, delete and crop in the same place; nothing is uploaded.",
    keywords: ["rotate pdf", "rotate pdf pages", "rotate pdf and save", "turn pdf page", "pdf landscape to portrait", "rotate scanned pdf", "pdf 回転"],
    icon: RotateCw,
    howItWorks:
      "Open the PDF; the Organise tab shows every page as a tile. Click a page (shift-click a run, ⌘-click to add, or type a range like 1-3, 5) and press rotate left or right; press twice for 180°. The rotation is written into the page's /Rotate entry, which every reader honours, so the file opens the right way up everywhere. The toolbar's rotate button, by contrast, only turns the view while you read.",
    faq: [
      { q: "Will the rotation stick when I open the file elsewhere?", a: "Yes. The page's rotation attribute is changed in the file itself, which Acrobat, Preview, browsers and printers all respect." },
      { q: "Can I rotate only the landscape pages?", a: "Select them in the Organise tab (the size under each tile shows which are landscape) and rotate the selection." },
      SAVE,
    ],
    aliases: ["rotate pdf", "turn pdf", "pdf orientation"],
    related: ["files/pdf", "files/pdf-crop", "files/pdf-merge", "files/pdf-split"],
  },
  {
    slug: "pdf-compress",
    preset: "compress",
    title: "Compress PDF",
    short: "Compress PDF",
    tagline: "Make a PDF smaller without changing what it says — pictures re-encoded, waste removed",
    description: "Compress a PDF in your browser: pictures are re-encoded as JPEG at the resolution they are shown at, streams stored uncompressed are deflated, objects nothing points at are dropped, metadata can go. Text stays sharp; nothing is uploaded.",
    keywords: ["compress pdf", "reduce pdf size", "shrink pdf", "pdf compressor online", "make pdf smaller", "compress pdf for email", "pdf 圧縮"],
    icon: Shrink,
    howItWorks:
      "Open the PDF and choose a preset: Light keeps every picture as it is and only tidies the file; Balanced re-encodes pictures to at most 150 pixels per inch at JPEG quality 80 %; Strong goes to 96 ppi and quality 60 % and removes metadata. Each picture's target size comes from how large it is drawn on the page, so a 4000-pixel photo shown two inches wide loses what no screen or printer would show. Pictures already small, and those in JPEG 2000, JBIG2 or fax encodings, are left alone. The status line reports the before and after sizes and what was done; undo brings the original back. Text, vector drawings, forms and comments are untouched.",
    faq: [
      { q: "Why did my file barely shrink?", a: "It was probably mostly text, which is already compressed, with few or no pictures. Compression gains come from pictures; a Word or LaTeX export with none will shrink only by the tidying steps." },
      { q: "Does compressing lose quality?", a: "Pictures are resampled and re-encoded as JPEG, so some detail goes — at 150 ppi nothing visible on screen, at 96 ppi a little in print. Text and drawings are vector and lose nothing." },
      PRIVACY,
    ],
    aliases: ["compress pdf", "shrink pdf", "reduce pdf", "pdf size"],
    related: ["files/pdf", "files/pdf-to-images", "media/converter", "files/zip"],
  },
  {
    slug: "pdf-sign",
    preset: "sign",
    title: "Sign PDF",
    short: "Sign PDF",
    tagline: "Draw, type or upload your signature and place it on the page — kept in your browser, never uploaded",
    description: "Sign a PDF in your browser: draw with a mouse, finger or pen, type your name in a script face, or upload a picture with its background removed; place the signature, resize it, add a date stamp, and save. Nothing is uploaded.",
    keywords: ["sign pdf", "sign pdf online free", "e-sign pdf", "add signature to pdf", "draw signature pdf", "electronic signature pdf", "pdf 署名"],
    icon: PenLine,
    howItWorks:
      "Open the PDF, press Sign and draw your signature (pressure is honoured on a pen), type your name in one of four faces, or upload a photo of your signature and let the white background drop out. Place it: it lands in the middle of the page as a stamp you drag into position and resize by its corners. Tick Remember and the signature is kept in this browser's storage for next time — up to four. Stamp adds APPROVED, RECEIVED or your own words with today's date beside it. Save writes the file; the signature is a standard stamp annotation that every reader shows and prints, and Flatten the comments (More menu) bakes it into the page content so it can no longer be moved.",
    faq: [
      { q: "Is this a legally valid electronic signature?", a: "It is an image of your signature placed on the document, which is what most e-sign tools produce and what many agreements accept; it is not a certificate-based digital signature. Whether it binds depends on your jurisdiction and the counterparty." },
      { q: "Can others move or remove my signature?", a: "As a stamp annotation, yes, in an editor. Flatten the comments into the pages before sending, and the signature becomes part of the page like any other ink." },
      PRIVACY,
    ],
    aliases: ["sign pdf", "esign", "signature pdf", "stamp pdf", "initial pdf"],
    related: ["files/pdf", "files/pdf-edit-text", "files/pdf-protect", "files/pdf-watermark"],
  },
  {
    slug: "pdf-edit-text",
    preset: "edit-text",
    title: "Edit PDF Text",
    short: "Edit PDF Text",
    tagline: "Change the words on the page — in the page's own font — and add new text, in your browser",
    description: "Edit the text of a PDF in place: click a line, retype it, press Enter. The line is rewritten in the document's own font when it carries the characters, else in a matching stand-in; kerning and columns are kept. Add text anywhere. Nothing is uploaded.",
    keywords: ["edit pdf text", "edit pdf online free", "change text in pdf", "pdf text editor", "fix typo in pdf", "add text to pdf", "replace text in pdf", "pdf テキスト 編集"],
    icon: TextCursorInput,
    howItWorks:
      "Open the PDF and press Edit text (E). Every line of the page's own text gets an outline; click one and an input opens over it in the same size and face. Change the words and press Enter: the glyphs are rewritten inside the page's content stream — the unchanged start and end of the line keep their original glyphs and kerning, the changed middle is set in the document's own font when that font has the characters (always for the standard fonts; for embedded subsets, whenever the characters appear somewhere in the document), otherwise in a matching stand-in (Helvetica, Times, Courier, or Liberation Sans for Greek and Cyrillic). Text to the right in the same line, such as a table's next column, stays exactly where it was; a line that grows runs on to the right. Click empty space to add a new line of text in the size, colour and face from the options bar. Invisible OCR text, vertical text and Type 3 fonts are shown but not editable.",
    faq: [
      { q: "Why does my edited line not reflow the paragraph?", a: "A PDF has no paragraphs — only lines placed at positions. Editing changes a line in place; the lines below do not move. For a long change, edit each affected line, or add a line of text where it is needed." },
      { q: "The new letters look slightly different. Why?", a: "The page's font is a subset that lacks those letters, so a stand-in font of the same family was used for the changed part. Letters the document already uses anywhere are set in the original font." },
      { q: "Can I change the font size or colour of existing text?", a: "Not yet — an edited line keeps its size and colour. New text takes the size, colour and face you choose in the options bar." },
      PRIVACY,
    ],
    aliases: ["edit pdf", "pdf text editor", "change pdf text", "fix pdf typo", "modify pdf"],
    related: ["files/pdf", "files/pdf-redact", "files/pdf-sign", "web/track-changes"],
  },
  {
    slug: "pdf-redact",
    preset: "redact",
    title: "Redact PDF",
    short: "Redact PDF",
    tagline: "Black out text and pictures — and remove the words underneath from the file, not just cover them",
    description: "Redact a PDF in your browser: mark areas or select text, press Apply, and the glyphs under each mark are deleted from the page's content, comments there are removed and a black box is drawn. Flatten pages to remove pictures too. Nothing is uploaded.",
    keywords: ["redact pdf", "redact pdf online free", "black out text in pdf", "remove text from pdf permanently", "pdf redaction tool", "sanitize pdf", "pdf 黒塗り"],
    icon: EyeOff,
    howItWorks:
      "Open the PDF and press Redact (X). Drag over anything that must go, on as many pages as needed, or select text and press Mark the selection; marks show as red-edged black boxes and can be removed with their × until you apply. Apply redactions rewrites each marked page: every glyph whose box meets a mark is removed from the content stream (what is left keeps its position), comments and form fields in the area are deleted, and a black rectangle is drawn. Pictures and vector drawings under a mark are covered, not removed, unless you tick Flatten marked pages to pictures, which replaces each marked page with a rendered image at 200 pixels per inch — then nothing underneath survives, at the cost of that page's selectable text. Hidden OCR text layers are redacted too. Save under a new name and check the result with Copy all the text.",
    faq: [
      { q: "Is the text really gone, or just hidden under a box?", a: "Gone from the page's content: the glyphs are deleted, not covered. You can verify with More → Copy all the text, or by searching the saved file. Pictures need the flatten option to be removed rather than covered." },
      { q: "What about metadata and comments?", a: "Comments in a marked area are deleted with it. Document information (author, title, keywords) is separate: remove it in the Info tab or with Compress → Remove metadata." },
      PRIVACY,
    ],
    aliases: ["redact pdf", "black out pdf", "censor pdf", "remove text pdf", "sanitise pdf"],
    related: ["files/pdf", "files/pdf-edit-text", "files/pdf-protect", "files/pdf-compress"],
  },
  {
    slug: "pdf-watermark",
    preset: "watermark",
    title: "Watermark PDF",
    short: "Watermark PDF",
    tagline: "CONFIDENTIAL, DRAFT or your own words across every page — in your browser",
    description: "Add a text watermark to a PDF: your words diagonally or straight across the pages you choose, in the size, colour, opacity and font you set, once per page or tiled. Nothing is uploaded.",
    keywords: ["watermark pdf", "add watermark to pdf", "pdf watermark online free", "confidential watermark pdf", "draft watermark", "pdf 透かし"],
    icon: Droplets,
    howItWorks:
      "Open the PDF; the Watermark dialog takes the text (CONFIDENTIAL by default), a size or “fit the page”, a colour, the opacity, the angle (diagonal up or down, or horizontal), once centred or tiled, a font family and weight, and which pages. The watermark is drawn into each page's content with the opacity you chose, so every reader shows and prints it; it sits above the page's content. Headers, footers and page numbers are added from the same menu.",
    faq: [
      { q: "Can I put the watermark behind the text?", a: "It is drawn above the content at the opacity you choose; at 20 % the text beneath stays readable. Drawing beneath would hide it under scans and filled backgrounds." },
      { q: "Can I remove a watermark later?", a: "One added here can be undone before saving. Afterwards, Edit text can rewrite its words, and Redact can remove it from a page." },
      SAVE,
    ],
    aliases: ["watermark pdf", "stamp confidential", "draft pdf"],
    related: ["files/pdf", "files/pdf-page-numbers", "files/pdf-sign", "files/pdf-protect"],
  },
  {
    slug: "pdf-page-numbers",
    preset: "page-numbers",
    title: "Add Page Numbers to PDF",
    short: "Page numbers",
    tagline: "Page n of N, headers and footers, Bates numbers — on the pages you choose",
    description: "Add page numbers, headers and footers to a PDF: {n} of {N}, zero-padded Bates stamps, the title, date or file name, in six positions, any size and colour, starting from any number. Nothing is uploaded.",
    keywords: ["add page numbers to pdf", "pdf page numbers", "number pdf pages", "pdf header footer", "bates numbering pdf", "pdf ページ番号"],
    icon: Hash,
    howItWorks:
      "Open the PDF and fill any of the six positions — top and bottom, left, centre and right — with text; {n} is the page number, {N} the count, {n:6} a six-digit zero-padded number for Bates stamps, and {title}, {author}, {date} and {file} fill themselves in. Presets cover the usual cases. Set the size, colour, font, margins in millimetres, the number the first page carries, and which pages get it. The text is drawn into each page's content, upright on rotated pages, and prints everywhere.",
    faq: [
      { q: "Can numbering start at a page other than the first?", a: "Choose the page range (say 3-) and set “First page is” so the numbers read as you want; {N} counts the whole document unless you set the pages." },
      { q: "What is Bates numbering?", a: "Sequential, fixed-width identifiers stamped on legal documents, such as DOC-000123. Use a prefix with {n:6} in a bottom corner." },
      SAVE,
    ],
    aliases: ["page numbers pdf", "bates numbering", "pdf header", "pdf footer", "number pages"],
    related: ["files/pdf", "files/pdf-watermark", "files/pdf-merge"],
  },
  {
    slug: "pdf-to-images",
    preset: "to-images",
    title: "PDF to JPG or PNG",
    short: "PDF → images",
    tagline: "Render pages as PNG or JPEG at the resolution you choose — one file or a zip",
    description: "Convert PDF pages to images in your browser: PNG or JPEG, 72 to 300 pixels per inch, one page or all, downloaded as a file or a zip. Nothing is uploaded.",
    keywords: ["pdf to jpg", "pdf to png", "convert pdf to image", "pdf to image online free", "pdf page to picture", "pdf jpg 変換"],
    icon: Images,
    howItWorks:
      "Open the PDF; the dialog takes the pages (all, the current one or a range), PNG or JPEG with a quality, and a resolution from 72 to 300 pixels per inch. Each page is rendered by pdf.js, the engine inside Firefox, with its comments and form values drawn in, and downloads as a file — several as a zip named after the document. Pictures go the other way too: drop PNG, JPEG, WebP or HEIC files on PDF Studio and each becomes a page.",
    faq: [
      { q: "Which resolution should I pick?", a: "96 or 150 ppi for screens and slides, 200 to 300 for print or OCR. An A4 page at 300 ppi is about 2480 × 3508 pixels." },
      { q: "PNG or JPEG?", a: "PNG for text and drawings (sharp, lossless, larger); JPEG for scans and photos (smaller)." },
      PRIVACY,
    ],
    aliases: ["pdf to jpg", "pdf to png", "pdf to image", "render pdf"],
    related: ["files/pdf", "files/images-to-pdf", "media/converter", "files/zip"],
  },
  {
    slug: "images-to-pdf",
    preset: "from-images",
    title: "JPG to PDF",
    short: "Images → PDF",
    tagline: "Pictures to a PDF, one per page, in the order you drop them — in your browser",
    description: "Convert JPG, PNG, WebP, HEIC and other images to a PDF: drop the pictures, each becomes a page at its own size, reorder in the Organise tab, and save. Nothing is uploaded.",
    keywords: ["jpg to pdf", "png to pdf", "image to pdf", "convert images to pdf", "photos to pdf", "webp to pdf", "heic to pdf", "画像 pdf 変換"],
    icon: FileImage,
    howItWorks:
      "Drop one or many pictures on the page or choose them with the button; PNG and JPEG are embedded as they are, other formats (WebP, HEIC, GIF, BMP, AVIF, TIFF where the browser decodes them) are converted to PNG first. Each picture becomes a page sized to the picture at 96 pixels per inch; the Organise tab then reorders, rotates or deletes pages, and more pictures or PDFs can be added. Save writes the PDF. Pictures dropped on an open PDF are appended as pages.",
    faq: [
      { q: "Can I fit the pictures to A4 pages instead?", a: "Pages take each picture's own size, which keeps the pixels as they are; printing fits them to paper. A paper-size option with margins is on the list." },
      { q: "Does it keep the picture quality?", a: "JPEG and PNG files are embedded unchanged — no re-encoding. Other formats are converted to PNG losslessly." },
      PRIVACY,
    ],
    aliases: ["jpg to pdf", "png to pdf", "image to pdf", "photo to pdf", "scan to pdf"],
    related: ["files/pdf", "files/pdf-to-images", "files/pdf-merge", "media/converter"],
  },
  {
    slug: "pdf-protect",
    preset: "protect",
    title: "Protect or Unlock PDF",
    short: "Protect PDF",
    tagline: "Add a password and permissions with AES-256, or remove a password you know — in your browser",
    description: "Password-protect a PDF with AES-256 encryption and permissions (printing, copying, editing), or open a protected PDF with its password and save it without one. Nothing is uploaded; the password never leaves your device.",
    keywords: ["password protect pdf", "encrypt pdf", "unlock pdf", "remove pdf password", "pdf permissions", "secure pdf online free", "pdf パスワード"],
    icon: Lock,
    howItWorks:
      "Open the PDF; the dialog takes a password to open, an optional owner password, and whether to restrict printing, copying, changing, commenting, form filling and page assembly. The file is encrypted with AES-256 and stays protected while you work and when you save. To unlock, open the protected file with its password and choose Remove the password from the More menu; Save writes an unencrypted copy. Restrictions are enforced by readers that respect them — most do — and lifted with the owner password.",
    faq: [
      { q: "Can it remove a password I do not know?", a: "No. The file must be opened with its password first; this tool does not break encryption." },
      { q: "What do the permissions do?", a: "They tell readers what to allow without the owner password: print (at high resolution), copy text and pictures, change the document, comment, fill forms, assemble pages. Acrobat, Preview and browsers honour them; the owner password overrides them." },
      PRIVACY,
    ],
    aliases: ["protect pdf", "encrypt pdf", "unlock pdf", "pdf password", "decrypt pdf"],
    related: ["files/pdf", "files/pdf-redact", "files/pdf-sign", "crypto/hash"],
  },
  {
    slug: "pdf-crop",
    preset: "crop",
    title: "Crop PDF",
    short: "Crop PDF",
    tagline: "Draw the area to keep, or trim margins by the millimetre — one page or all",
    description: "Crop a PDF in your browser: draw the area to keep on a page and apply it to that page or all of them, or trim each edge by millimetres. The crop box is what readers show and can be removed again. Nothing is uploaded.",
    keywords: ["crop pdf", "crop pdf pages", "trim pdf margins", "cut pdf page", "pdf cropper online", "remove white space pdf", "pdf トリミング"],
    icon: Crop,
    howItWorks:
      "Open the PDF and press Crop (C): drag over a page to choose the area to keep — the size in millimetres is shown — and press Crop page or All pages. The Organise tab's Crop trims each edge by a number of millimetres instead. Both set the page's crop box, the rectangle readers display and print; the content outside is not deleted, so Remove crop brings it back. To make the crop permanent, save pages as images and build a PDF from them.",
    faq: [
      { q: "Is the cropped-off content gone?", a: "No — it is outside the crop box, which readers do not show, but still in the file. That is reversible (Remove crop) and keeps the file intact; for a destructive crop, render to images and rebuild." },
      { q: "Can I crop every page the same way?", a: "Yes: draw the area on one page and press All pages, or use the Organise tab's margins with all pages selected." },
      SAVE,
    ],
    aliases: ["crop pdf", "trim pdf", "pdf margins", "cut pdf"],
    related: ["files/pdf", "files/pdf-rotate", "files/pdf-to-images", "files/pdf-split"],
  },
];

export function pdfSatellites(): ToolDef[] {
  return SEEDS.map((s) => ({
    slug: s.slug,
    category: "files",
    group: "documents",
    title: s.title,
    short: s.short,
    tagline: s.tagline,
    description: s.description,
    keywords: s.keywords,
    icon: s.icon,
    status: "beta",
    widget: "pdf-studio",
    widgetProps: { preset: s.preset },
    howItWorks: s.howItWorks,
    faq: s.faq,
    examples: [],
    related: s.related,
    aliases: s.aliases,
    added: ADDED,
  }));
}
