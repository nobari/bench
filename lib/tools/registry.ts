import {
  Binary,
  BookOpen,
  Braces,
  FolderArchive,
  PackageOpen,
  Shrink,
  Sticker,
  CalendarClock,
  CalendarDays,
  CaseSensitive,
  Clock,
  Code2,
  Dices,
  Film,
  Fingerprint,
  GitCompare,
  Hash,
  Images,
  Landmark,
  Languages,
  Link,
  Link2,
  Lock,
  Pipette,
  QrCode,
  Replace,
  ScanQrCode,
  Ruler,
  Shuffle,
  Signature,
  Superscript,
  Table,
  Wallet,
} from "lucide-react";
import type { CategorySlug, ToolDef } from "./types";

/**
 * THE REGISTRY — single source of truth for every tool.
 *
 * Adding a tool: append an entry here. Routes (`generateStaticParams`), nav,
 * command palette, sitemap, robots, llms.txt, JSON-LD and OG images all derive
 * from this array. Many entries can reuse one `widget` via `widgetProps`.
 */
export const TOOLS: ToolDef[] = [
  /* ============================ TEXT & ENCODING ============================ */
  {
    slug: "transform",
    category: "text",
    title: "Text Transformer",
    tagline: "45+ encoders, case converters and text utilities in one place",
    description:
      "A unified text transformer: Base64, URL and HTML encoding, hex, binary, case conversion, full-width/half-width, slugify, Morse, ROT13 and more. Runs entirely in your browser.",
    keywords: ["text transformer", "string converter", "encode", "decode", "convert text"],
    icon: Replace,
    status: "stable",
    widget: "text-transform",
    howItWorks:
      "Pick a transform, paste your text, and the result updates instantly. Every transform is a pure function that runs locally in your browser — your text is never uploaded. The selected transform and input are stored in the URL, so any result is one copy-paste away from being reproduced.",
    faq: [
      { q: "Is my text uploaded anywhere?", a: "No. Every transform runs locally in your browser using JavaScript. Nothing is sent to a server." },
      { q: "Can I share a result?", a: "Yes. The transform and input are encoded in the page URL, so copying the address bar (or the Share button) reproduces your exact result." },
      { q: "Which transforms are supported?", a: "Over 45, including Base64, URL, HTML entities, hex, binary, Unicode escapes, all common case styles, full-width/half-width, line operations, Ethereum EIP-55 checksums, Keccak-256, Morse and ROT13." },
    ],
    examples: [
      { label: "Base64 encode “Hello, world”", query: "t=base64-encode&i=Hello%2C+world" },
      { label: "Convert to snake_case", query: "t=snake-case&i=Hello+World+Example" },
    ],
    related: ["text/base64", "text/case-converter", "json/viewer"],
    aliases: ["string utilities", "text tools"],
  },
  {
    slug: "base64",
    category: "text",
    title: "Base64 Encode & Decode",
    tagline: "Convert text and data to and from Base64 (and Base64URL)",
    description:
      "Encode text to Base64 or decode Base64 back to text, including URL-safe Base64URL. UTF-8 aware and fully client-side — paste, convert, copy.",
    keywords: ["base64 encode", "base64 decode", "base64url", "base64 converter", "atob btoa"],
    icon: Binary,
    status: "stable",
    widget: "text-transform",
    widgetProps: {
      preset: "base64-encode",
      featured: ["base64-encode", "base64-decode", "base64url-encode", "base64url-decode"],
    },
    howItWorks:
      "Base64 represents binary data using 64 ASCII characters, commonly used to embed data in URLs, JSON, data URIs and email. This tool is UTF-8 aware, so emoji and non-Latin scripts encode and decode correctly. Base64URL swaps + and / for - and _ and drops padding so the result is safe inside URLs.",
    faq: [
      { q: "What is the difference between Base64 and Base64URL?", a: "Base64URL is a URL- and filename-safe variant: it replaces '+' with '-', '/' with '_', and omits '=' padding, so it can be used in query strings and paths without escaping." },
      { q: "Does it handle Unicode?", a: "Yes. Text is encoded as UTF-8 before Base64, so emoji and non-Latin characters round-trip correctly." },
      { q: "Is it safe to paste sensitive data?", a: "Encoding happens entirely in your browser; nothing is uploaded. That said, Base64 is encoding, not encryption — it is not a way to keep data secret." },
    ],
    examples: [
      { label: "Encode “Hello, world”", query: "t=base64-encode&i=Hello%2C+world" },
      { label: "Decode “aGVsbG8=”", query: "t=base64-decode&i=aGVsbG8%3D" },
    ],
    related: ["text/url-encode", "text/html-entities", "crypto", "text/transform"],
    aliases: ["b64"],
  },
  {
    slug: "url-encode",
    category: "text",
    title: "URL Encode & Decode",
    tagline: "Percent-encode and decode text for safe use in URLs",
    description:
      "Encode text for query strings and URLs (percent-encoding) or decode an encoded URL back to readable text. Handles UTF-8 and runs locally.",
    keywords: ["url encode", "url decode", "percent encoding", "encodeuricomponent", "query string encode"],
    icon: Link2,
    status: "stable",
    widget: "text-transform",
    widgetProps: { preset: "url-encode", featured: ["url-encode", "url-decode"] },
    howItWorks:
      "URLs may only contain a limited set of characters, so spaces, punctuation and non-ASCII text must be percent-encoded (for example a space becomes %20). This tool uses the same rules as the browser's encodeURIComponent/decodeURIComponent and is UTF-8 aware.",
    faq: [
      { q: "What does %20 mean?", a: "%20 is the percent-encoded form of a space character. Percent-encoding represents reserved or non-ASCII characters as a % followed by their hexadecimal byte value." },
      { q: "Why didn’t my slashes get encoded?", a: "This tool encodes a value as a single URL component, so reserved characters like / and ? are escaped. Use it for query-string values rather than whole URLs." },
    ],
    examples: [
      { label: "Encode a query value", query: "t=url-encode&i=name%3DAda+%26+co" },
      { label: "Decode %2F%3Ftest", query: "t=url-decode&i=%252F%253Ftest" },
    ],
    related: ["text/base64", "text/html-entities", "text/transform"],
  },
  {
    slug: "html-entities",
    category: "text",
    title: "HTML Entity Encode & Decode",
    tagline: "Escape and unescape HTML special characters",
    description:
      "Encode characters like <, >, & and quotes into HTML entities, or decode named and numeric entities back to text. Prevent broken markup and XSS.",
    keywords: ["html encode", "html entity", "escape html", "unescape html", "html entities decoder"],
    icon: Code2,
    status: "stable",
    widget: "text-transform",
    widgetProps: { preset: "html-encode", featured: ["html-encode", "html-decode"] },
    howItWorks:
      "Certain characters have special meaning in HTML. Encoding &, <, >, \" and ' as entities (like &amp; and &lt;) lets you display them literally and helps prevent cross-site scripting when injecting user content. Decoding converts named and numeric entities back to characters.",
    faq: [
      { q: "Which characters get encoded?", a: "The five HTML-significant characters: & < > \" and '. Decoding also understands numeric entities such as &#169; and &#x1F600;." },
      { q: "Does this prevent XSS by itself?", a: "Entity-encoding untrusted text before inserting it into HTML is an important defense, but full XSS protection depends on context (attributes, scripts, URLs). Use a framework's escaping where possible." },
    ],
    examples: [
      { label: "Encode a <div> snippet", query: "t=html-encode&i=%3Cdiv+class%3D%22a%22%3E%3C%2Fdiv%3E" },
      { label: "Decode &amp;lt;b&amp;gt;", query: "t=html-decode&i=%26lt%3Bb%26gt%3B" },
    ],
    related: ["text/url-encode", "text/base64", "text/transform"],
  },
  {
    slug: "case-converter",
    category: "text",
    title: "Case Converter",
    tagline: "camelCase, snake_case, kebab-case, Title Case and more",
    description:
      "Convert text between camelCase, PascalCase, snake_case, kebab-case, CONSTANT_CASE, Title Case, sentence case and other styles. Great for variable and slug naming.",
    keywords: ["case converter", "camelcase", "snake case", "kebab case", "title case", "pascalcase"],
    icon: CaseSensitive,
    status: "stable",
    widget: "text-transform",
    widgetProps: {
      preset: "camel-case",
      featured: ["camel-case", "pascal-case", "snake-case", "kebab-case", "constant-case", "title-case", "sentence-case", "uppercase", "lowercase"],
    },
    howItWorks:
      "The converter intelligently splits your input into words — handling existing camelCase, snake_case, kebab-case and spaces — then re-joins them in the style you pick. This makes it easy to rename variables, build URL slugs or normalize headings.",
    faq: [
      { q: "How does it detect word boundaries?", a: "It splits on spaces, underscores, hyphens and dots, and also on camelCase boundaries (a lowercase letter followed by an uppercase one), so 'getHTTPResponse' becomes the words get, HTTP, Response." },
      { q: "What is CONSTANT_CASE?", a: "Uppercase words joined by underscores (also called SCREAMING_SNAKE_CASE), commonly used for constants and environment variables." },
    ],
    examples: [
      { label: "“user profile id” → camelCase", query: "t=camel-case&i=user+profile+id" },
      { label: "“MyComponent” → kebab-case", query: "t=kebab-case&i=MyComponent" },
    ],
    related: ["text/transform", "text/base64"],
  },
  {
    slug: "eip55-checksum",
    category: "text",
    title: "Ethereum Address Checksum (EIP-55)",
    tagline: "Apply the EIP-55 mixed-case checksum to an Ethereum address",
    description:
      "Convert a lowercase Ethereum address to its EIP-55 checksummed (mixed-case) form, normalize to lowercase, or compute a Keccak-256 hash — all client-side.",
    keywords: ["eip-55", "ethereum address checksum", "checksum address", "keccak256", "ethereum address validator"],
    icon: Wallet,
    status: "stable",
    widget: "text-transform",
    widgetProps: {
      preset: "eip55-checksum",
      featured: ["eip55-checksum", "address-lowercase", "keccak256"],
    },
    howItWorks:
      "EIP-55 adds a checksum to Ethereum addresses by selectively capitalizing the hex digits based on the Keccak-256 hash of the lowercase address. Wallets use the resulting mixed-case form to catch typos. Paste any address (with or without the 0x prefix) to get its checksummed version.",
    faq: [
      { q: "What is an EIP-55 checksum?", a: "It encodes a checksum into the capitalization of an Ethereum address's hex characters. Each letter is uppercased when the corresponding Keccak-256 hash nibble is 8 or higher, allowing wallets to detect mistyped addresses." },
      { q: "Does this verify the address on-chain?", a: "No. It computes the canonical mixed-case form locally. It does not check whether the address exists or holds a balance." },
      { q: "Keccak-256 or SHA-3?", a: "Ethereum uses the original Keccak-256 (pre-standardization), which differs from NIST SHA3-256. This tool uses Keccak-256, as the EIP-55 specification requires." },
    ],
    examples: [
      { label: "Checksum a sample address", query: "t=eip55-checksum&i=0x5aaeb6053f3e94c9b9a09f33669435e7ef1beaed" },
    ],
    related: ["text/transform", "crypto"],
    aliases: ["ethereum checksum", "web3 address"],
  },
  {
    slug: "full-width",
    category: "text",
    title: "Full-width ↔ Half-width Converter (Zenkaku / Hankaku)",
    tagline: "Convert between full-width (全角) and half-width (半角) Japanese & Latin characters",
    description:
      "Convert ASCII and katakana to full-width (zenkaku) or back to half-width (hankaku), including half-width katakana ↔ full-width katakana. Normalize Japanese text and form input instantly, in your browser.",
    keywords: [
      "full width converter",
      "half width converter",
      "zenkaku hankaku",
      "全角 半角 変換",
      "half-width katakana",
      "full-width katakana",
      "katakana converter",
      "japanese text normalizer",
      "fullwidth to halfwidth",
      "hankaku katakana to zenkaku",
    ],
    icon: Languages,
    status: "stable",
    widget: "text-transform",
    widgetProps: {
      preset: "to-fullwidth",
      featured: [
        "to-fullwidth",
        "to-halfwidth",
        "hiragana-to-katakana",
        "katakana-to-hiragana",
      ],
    },
    howItWorks:
      "In Japanese typography, Latin letters, digits and katakana exist in both full-width (zenkaku, occupying a full em square) and half-width (hankaku) forms. This converter maps ASCII to its full-width range and back, and converts half-width katakana (ｱｲｳ) to and from full-width katakana (アイウ). It also converts between hiragana and katakana. These conversions are essential when normalizing user input before storing, searching or comparing Japanese text — for example, unifying ﾊﾝｶｸ and ハンカク so they match.",
    faq: [
      { q: "What are zenkaku (全角) and hankaku (半角)?", a: "Zenkaku are full-width characters that occupy one em square; hankaku are half-width. The same letter or katakana can appear in either form, and Japanese systems often normalize one to the other before storage or comparison." },
      { q: "Does it convert half-width katakana?", a: "Yes. Half-width katakana like ｱｲｳ (hankaku) convert to full-width アイウ (zenkaku) and back, alongside ASCII letters, digits and punctuation." },
      { q: "Can it convert hiragana to katakana?", a: "Yes — use the Hiragana → Katakana and Katakana → Hiragana modes to switch between the two kana scripts (ひらがな ⇄ カタカナ)." },
      { q: "Why normalize full-width and half-width text?", a: "Mixed widths cause string comparisons and searches to fail (e.g. ABC vs ＡＢＣ, or ﾊﾝｶｸ vs ハンカク). Normalizing to a single width makes data consistent and searchable." },
    ],
    examples: [
      { label: "ABC123 → full-width (全角)", query: "t=to-fullwidth&i=ABC123" },
      { label: "Ｈｅｌｌｏ → half-width", query: "t=to-halfwidth&i=%EF%BC%A8%EF%BD%85%EF%BD%8C%EF%BD%8C%EF%BD%8F" },
      { label: "ﾊﾝｶｸ → full-width katakana", query: "t=to-fullwidth&i=%EF%BE%8A%EF%BE%9D%EF%BD%B6%EF%BD%B8" },
    ],
    related: ["text/kana-converter", "text/romaji", "text/case-converter", "text/transform"],
    aliases: ["zenkaku hankaku converter", "japanese width converter", "全角半角変換"],
  },
  {
    slug: "kana-converter",
    category: "text",
    title: "Katakana ↔ Hiragana Converter",
    tagline: "Convert Japanese kana between katakana (カタカナ) and hiragana (ひらがな)",
    description:
      "Convert hiragana to katakana or katakana to hiragana instantly, and switch half-width katakana to full-width. A fast, private Japanese kana converter that runs in your browser.",
    keywords: [
      "katakana converter",
      "hiragana to katakana",
      "katakana to hiragana",
      "convert kana",
      "kana converter",
      "ひらがな カタカナ 変換",
      "japanese kana",
      "hiragana katakana converter",
      "convert katakana",
    ],
    icon: Languages,
    status: "stable",
    widget: "text-transform",
    widgetProps: {
      preset: "hiragana-to-katakana",
      featured: [
        "hiragana-to-katakana",
        "katakana-to-hiragana",
        "to-fullwidth",
        "to-halfwidth",
      ],
    },
    howItWorks:
      "Japanese uses two kana scripts: hiragana (ひらがな) for native words and grammar, and katakana (カタカナ) for loanwords and emphasis. The two map one-to-one, so converting between them is a direct character shift. Paste any kana text to convert it; you can also switch half-width katakana to full-width. Everything runs locally — your text is never uploaded.",
    faq: [
      { q: "How do I convert hiragana to katakana?", a: "Select the Hiragana → Katakana mode and paste your hiragana text (e.g. あいうえお). It is converted to katakana (アイウエオ) instantly." },
      { q: "Does it convert katakana back to hiragana?", a: "Yes. Use Katakana → Hiragana to turn カタカナ into かたかな. The mapping is one-to-one for standard kana." },
      { q: "What about half-width (hankaku) katakana?", a: "Use the full-width / half-width modes to convert half-width katakana ｶﾀｶﾅ to full-width カタカナ and back." },
      { q: "Is romaji supported?", a: "Not here — this tool converts between the kana scripts and character widths. Use the Romaji ↔ Kana converter to turn romaji into hiragana or katakana, or kana into Hepburn romaji." },
    ],
    examples: [
      { label: "あいうえお → katakana", query: "t=hiragana-to-katakana&i=%E3%81%82%E3%81%84%E3%81%86%E3%81%88%E3%81%8A" },
      { label: "カタカナ → hiragana", query: "t=katakana-to-hiragana&i=%E3%82%AB%E3%82%BF%E3%82%AB%E3%83%8A" },
    ],
    related: ["text/romaji", "text/full-width", "text/transform"],
    aliases: ["japanese converter", "kana script converter"],
  },
  {
    slug: "finglish",
    category: "text",
    title: "Finglish to Farsi Converter",
    tagline: "Type Persian with Latin letters (Pinglish) and get Persian script — tap any word to fix its spelling",
    description:
      "Convert Finglish / Pinglish (Persian typed in English letters) to Persian script instantly. A 1,000+ word dictionary, a verb conjugation engine and phonetic rules handle chat-style Farsi, with tap-to-fix alternatives for ص ض ط ظ ث ح ع ق غ. Runs in your browser.",
    keywords: [
      "finglish to farsi",
      "finglish to persian",
      "pinglish to farsi",
      "finglish converter",
      "finglish translator",
      "persian transliteration",
      "latin to persian",
      "type farsi with english keyboard",
      "فینگلیش به فارسی",
      "تبدیل فینگلیش به فارسی",
      "مبدل فینگلیش",
    ],
    icon: Languages,
    status: "beta",
    widget: "finglish-converter",
    howItWorks:
      "Finglish (also called Pinglish) is Persian typed with Latin letters — salam, chetori, khoobam. Turning it back into Persian script is ambiguous: short vowels are not written in Persian, and one Latin letter can stand for several letters (s for س/ص/ث, z for ز/ذ/ض/ظ, t for ت/ط, h for ه/ح, gh for غ/ق). This converter resolves each word in four passes: a dictionary of over a thousand common words, phrases and names; a verb engine that understands prefixes (mi-, nemi-, be-, na-), present and past stems and personal endings, so nemidoonam becomes نمی‌دونم and barmigardam becomes برمی‌گردم; affix rules for plurals, possessives and comparatives (ketabha, khunam, bozorgtar); and finally a phonetic fallback for anything unknown. Words that were not recognised are underlined — tap one to pick a different spelling, and your choices are kept in the shareable URL. Zero-width non-joiners (نیم‌فاصله), Persian digits and punctuation are optional. Everything runs in your browser.",
    faq: [
      { q: "What is Finglish?", a: "Finglish (Pinglish, Penglish) is Persian written in the Latin alphabet, common in chats, SMS and on keyboards without a Persian layout: “salam, khoobi?” for سلام، خوبی؟. There is no official standard, so kh/x, gh/q, oo/u and aa/â spellings are all accepted here." },
      { q: "Why is a word underlined or spelled wrong?", a: "Finglish does not say which of س ص ث, ز ذ ض ظ, ت ط, ه ح or ق غ a sound is, and a single a can be a short vowel (unwritten) or a long â (ا). Words outside the dictionary are guessed phonetically and shown with a dotted underline. Tap the word to choose from its alternatives; picks are stored in the URL so a shared link keeps them." },
      { q: "How should I write long vowels?", a: "Write long â as aa or â (bazaar → بازار), oo or u for و (khoob → خوب) and ee or i for ی (irani → ایرانی). A single a, e or o is treated as a short vowel, which Persian leaves unwritten (man → من). Common words with long vowels are in the dictionary anyway (ketab → کتاب, salam → سلام)." },
      { q: "Does it handle verbs?", a: "Yes. It conjugates hundreds of common verbs from their stems with mi-/nemi-/be-/na- prefixes, personal endings and object clitics: miram, nemidoonam, bebakhshid, mikonamesh, naraftam, barmigardam. Colloquial forms (miam, mikham, oomadam) are covered alongside formal ones." },
      { q: "What is نیم‌فاصله (ZWNJ) and should I keep it on?", a: "The zero-width non-joiner keeps prefixes and suffixes attached without joining letter shapes — می‌رم rather than میرم, کتاب‌ها rather than کتابها. It is the correct orthography and is recommended; switch it off if you are pasting somewhere that mishandles the character." },
      { q: "Is my text uploaded?", a: "No. The dictionary, verb engine and rules are all in the page; nothing is sent to a server." },
    ],
    examples: [
      { label: "salam, khoobi? man khoobam, mersi", query: "i=salam%2C+khoobi%3F+man+khoobam%2C+mersi" },
      { label: "emrooz miram daneshgah, baad miam khune", query: "i=emrooz+miram+daneshgah%2C+baad+miam+khune" },
      { label: "delam barat tang shode azizam", query: "i=delam+barat+tang+shode+azizam" },
    ],
    related: ["text/romaji", "text/kana-converter", "text/transform"],
    aliases: ["pinglish", "fingilish", "penglish", "farsi converter", "persian script converter", "فینگلیش"],
    added: "2026-08-27",
  },
  {
    slug: "romaji",
    category: "text",
    title: "Romaji to Hiragana & Katakana Converter",
    tagline: "Convert romaji to hiragana or katakana — and kana back to Hepburn romaji",
    description:
      "Convert romaji to hiragana or katakana the way a Japanese IME does (shi/si, tsu/tu, nn, doubled consonants, ō/ou/-), or turn hiragana and katakana into Hepburn or wāpuro romaji. Instant, private, in your browser.",
    keywords: [
      "romaji to hiragana",
      "romaji to katakana",
      "romaji to japanese",
      "romaji converter",
      "hiragana to romaji",
      "katakana to romaji",
      "kana to romaji",
      "japanese romaji converter",
      "hepburn romaji",
      "ローマ字 変換",
      "ローマ字 ひらがな 変換",
      "ローマ字 カタカナ 変換",
    ],
    icon: Languages,
    status: "stable",
    widget: "romaji-converter",
    howItWorks:
      "Type romaji and it is converted to kana exactly as a Japanese IME would: Hepburn (shi, chi, tsu, fu, ji), Kunrei (si, ti, tu, hu, zi) and Nihon-shiki spellings all work, doubled consonants become っ (kitte → きって, matcha → まっちゃ), n before a consonant, nn or n' become ん (kanji → かんじ, shin'ya → しんや), and long vowels can be written with macrons, doubled letters or a hyphen (Tōkyō, toukyou, to-kyo-). Standalone wa, e and o are treated as the particles は, へ and を. Small kana use the x or l prefix (xtsu → っ, xa → ぁ), and in katakana mode ti/di become ティ/ディ for loanwords. Kana → Romaji produces modified Hepburn with macrons (とうきょう → tōkyō, しんや → shin'ya) or wāpuro style spelled out as you would type it. Kanji and other characters pass through unchanged.",
    faq: [
      { q: "Which romaji systems are accepted?", a: "Hepburn, Kunrei-shiki and Nihon-shiki, mixed freely — shi/si, chi/ti, tsu/tu, fu/hu, ji/zi/di, sha/sya, ja/jya/zya all produce the same kana, the same as typing into a Japanese IME." },
      { q: "How do I type ん, っ and small kana?", a: "ん: nn, n' or just n before a consonant (kanji, shinbun). っ: double the following consonant (kitte, matcha) or type xtsu/ltu. Small vowels and ゃゅょ: prefix with x or l (xa → ぁ, xyu → ゅ)." },
      { q: "How are long vowels handled?", a: "Macrons or circumflexes (ō, ô), doubled vowels (ou, oo, uu) and a hyphen (ko-hi-) all work. In hiragana ō becomes おう and ē becomes ええ; in katakana every long vowel becomes ー. Converting kana back to Hepburn merges おう/おお/うう/ああ/ええ into macrons, while いい and えい are kept as ii and ei." },
      { q: "Why did “wa” become は?", a: "Hepburn writes the particles は, へ and を as wa, e and o. A standalone wa, e or o is treated as a particle (watashi wa → わたし は); type ha or wo to get the literal kana. The greetings konnichiwa and konbanwa are also spelled with は." },
      { q: "Can it convert kanji to romaji?", a: "No. Reading kanji needs a dictionary and context (生 alone has a dozen readings), which is beyond a rule-based converter. Kanji pass through unchanged; paste hiragana or katakana (furigana) for a full romaji reading." },
      { q: "Is my text uploaded?", a: "No. The conversion tables run entirely in your browser." },
    ],
    examples: [
      { label: "konnichiwa → こんにちは", query: "m=hira&i=konnichiwa" },
      { label: "ko-hi- → コーヒー", query: "m=kata&i=ko-hi-" },
      { label: "とうきょう → tōkyō", query: "m=romaji&i=%E3%81%A8%E3%81%86%E3%81%8D%E3%82%87%E3%81%86" },
    ],
    related: ["text/kana-converter", "text/full-width", "text/finglish"],
    aliases: ["romaji", "rōmaji", "hiragana converter", "katakana converter", "japanese ime", "wapuro", "ローマ字"],
    added: "2026-08-27",
  },
  {
    slug: "gzip",
    category: "text",
    title: "Gzip / Deflate Compressor",
    tagline: "Compress and decompress text with gzip, zlib and raw deflate",
    description:
      "Compress text to gzip, zlib (deflate) or raw deflate and get Base64 output — or paste Base64/hex of compressed data and decompress it. Runs on the browser's native compression engine, nothing is uploaded.",
    keywords: [
      "gzip online",
      "gzip compress online",
      "gzip decompress online",
      "zlib decompress online",
      "deflate online",
      "inflate online",
      "zlib inflate",
      "base64 gzip decode",
      "gzip to text",
      "compress string online",
      "decompress base64",
    ],
    icon: Shrink,
    status: "stable",
    widget: "text-compress",
    howItWorks:
      "In Compress mode, your text is UTF-8 encoded and compressed with the browser's native CompressionStream — choose gzip (RFC 1952, the .gz / Content-Encoding: gzip format), deflate (RFC 1950, the zlib wrapper) or deflate-raw (RFC 1951, a bare stream) — and the result is shown as Base64 with exact before/after byte counts and the compression ratio. In Decompress mode, paste Base64 (standard or URL-safe) or a hex string of compressed data: the container is auto-detected from its magic bytes (1f 8b for gzip, 78 xx for zlib) with raw deflate as the fallback, and the decompressed text appears instantly — or, if the payload isn't UTF-8 text, you can download the raw bytes. Everything runs locally; gzip output can also be saved as a .gz file.",
    faq: [
      { q: "Is my data uploaded anywhere?", a: "No. Compression and decompression use the browser's built-in CompressionStream / DecompressionStream APIs and run entirely on your device." },
      { q: "What's the difference between gzip, deflate and deflate-raw?", a: "All three use the same DEFLATE algorithm. gzip (RFC 1952) adds a header and CRC and is used for .gz files and HTTP Content-Encoding: gzip; deflate (RFC 1950) is the lighter zlib wrapper with an Adler-32 checksum; deflate-raw (RFC 1951) is the bare stream with no header at all." },
      { q: "How does decompression know which format I pasted?", a: "It sniffs the magic bytes — 1f 8b means gzip and 0x78 with a valid check byte means zlib — then falls back to trying raw deflate. The detected format is shown with the result." },
      { q: "Can I decompress a hex string instead of Base64?", a: "Yes. Input that looks like hex (only 0-9 a-f, even length) is parsed as hex; anything else is treated as Base64, including URL-safe Base64." },
      { q: "Why is the Base64 output longer than the compressed size?", a: "Base64 encodes 3 bytes into 4 characters, adding about 33% on top of the compressed byte count. The stats line shows the true compressed size in bytes; use Save to download the raw .gz bytes." },
      { q: "Is Brotli or Zstandard supported?", a: "Not yet — browsers don't expose Brotli or zstd through CompressionStream. This tool supports what the platform provides natively: gzip, deflate (zlib) and deflate-raw." },
    ],
    examples: [
      { label: "Compress “Hello, world” with gzip", query: "m=c&f=gzip&i=Hello%2C+world" },
      { label: "Decompress a Base64 gzip payload", query: "m=d&i=H4sIAAAAAAACE%2FNIzcnJ11Eozy%2FKSQEAwqma5wwAAAA%3D" },
    ],
    related: ["text/base64", "files/zip", "files/unzip", "text/transform"],
    aliases: ["gzip", "gunzip online", "zlib", "deflate", "inflate", "compress text", "decompress text", "ungzip"],
    added: "2026-08-20",
  },

  /* ============================== JSON & DATA ============================== */
  {
    slug: "viewer",
    category: "json",
    title: "JSON Viewer & Formatter",
    tagline: "Inspect, format, validate and query JSON — fast",
    description:
      "A professional JSON viewer: pretty-print or minify, validate with precise error locations, explore an interactive collapsible tree, search by key or JSONPath, and copy any path or value. Handles large documents.",
    keywords: ["json viewer", "json formatter", "json beautifier", "json validator", "json tree", "format json"],
    icon: Braces,
    status: "stable",
    widget: "json-viewer",
    howItWorks:
      "Paste or type JSON and it is parsed instantly in your browser. Switch between a formatted text view and an interactive tree: expand and collapse nodes, see type badges, search keys and values, and copy the dotted path to any node. Invalid JSON is reported with the line and column of the problem. Nothing is uploaded.",
    faq: [
      { q: "How large a file can it handle?", a: "The tree view renders only what is visible, so multi-megabyte documents stay responsive. Extremely large files depend on your device's available memory." },
      { q: "Can I find a value deep in the structure?", a: "Yes. Use the search box to match keys or values; matches are highlighted and the tree expands to reveal them. You can also copy the path to any node." },
      { q: "Is my data private?", a: "Completely. Parsing and formatting happen locally in your browser; no JSON is ever sent to a server." },
    ],
    examples: [
      { label: "Format a sample object", query: "i=%7B%22name%22%3A%22Ada%22%2C%22langs%22%3A%5B%22js%22%2C%22ts%22%5D%2C%22active%22%3Atrue%7D" },
    ],
    related: ["text/transform", "text/base64"],
    aliases: ["json beautifier", "json pretty print", "json lint"],
  },

  /* ============================= IMAGE & MEDIA ============================= */
  {
    slug: "gif-maker",
    category: "image",
    title: "GIF Maker",
    tagline: "Turn a set of images into an animated GIF — in your browser",
    description:
      "Combine images into an animated GIF with full control over frame order, speed, size, looping, dithering and quality. Reverse or boomerang the sequence. Everything is processed locally — no uploads.",
    keywords: ["gif maker", "images to gif", "animated gif", "create gif", "gif generator", "photos to gif"],
    icon: Film,
    status: "stable",
    widget: "gif-maker",
    howItWorks:
      "Drop in a series of images, reorder them by dragging, and set the playback speed, output size and color quality. The GIF is encoded in your browser using a Web Worker, so the interface stays responsive and your images never leave your device. Preview the animation, then download the finished GIF.",
    faq: [
      { q: "Are my images uploaded?", a: "No. Encoding runs entirely in your browser via a Web Worker. Your images are never sent anywhere." },
      { q: "What controls do I get?", a: "Frame order, per-frame and global delay (speed), output dimensions, loop count, maximum colors, dithering quality, and reverse or boomerang playback." },
      { q: "Why is my GIF large?", a: "GIFs grow with dimensions, frame count and color count. Reduce the output size, lower the maximum colors, or remove frames to shrink the file. The tool shows an estimated size as you adjust settings." },
    ],
    examples: [],
    related: ["json/viewer", "image/converter", "text/transform"],
    aliases: ["make a gif", "image sequence to gif"],
  },
  {
    slug: "converter",
    category: "image",
    title: "Image Converter",
    tagline: "Convert and resize images between PNG, JPG and WebP",
    description:
      "Convert images between PNG, JPG and WebP, adjust quality and resize — all in your browser. Batch-convert multiple files at once with no uploads.",
    keywords: ["image converter", "png to webp", "jpg to png", "convert image", "webp converter", "resize image"],
    icon: Images,
    status: "stable",
    widget: "image-converter",
    howItWorks:
      "Drop in one or more images and choose an output format — PNG (lossless), JPG or WebP (with a quality slider). Optionally cap the width to resize while keeping the aspect ratio. Conversion runs on a canvas in your browser, so nothing is uploaded; download each result individually.",
    faq: [
      { q: "Which formats are supported?", a: "Input: any image your browser can decode (PNG, JPG, WebP, AVIF, GIF). Output: PNG, JPG or WebP." },
      { q: "Are my images uploaded?", a: "No. Decoding and re-encoding happen locally via the Canvas API; your files never leave your device." },
      { q: "How do I make a smaller file?", a: "Choose WebP or JPG and lower the quality, and/or set a maximum width to downscale. The converted size is shown for each image." },
    ],
    examples: [],
    related: ["image/gif-maker", "color/converter"],
    aliases: ["png to jpg", "convert to webp", "image format converter"],
  },
  {
    slug: "qr-scanner",
    category: "image",
    title: "QR Code & Barcode Scanner",
    tagline: "Scan QR codes and barcodes — camera or image, every code at once",
    description:
      "Scan QR codes and barcodes (EAN, UPC, Code 128 …) with your camera or from an image — every code in the frame is found and decoded locally in your browser. Nothing is uploaded.",
    keywords: [
      "qr code scanner",
      "qr code reader",
      "barcode scanner",
      "barcode reader online",
      "scan qr code",
      "read qr code from image",
      "read barcode from image",
      "decode qr code",
      "ean-13 scanner",
      "upc scanner",
      "scan multiple qr codes",
      "qr scanner online",
      "wifi qr code reader",
      "qr code reader from screenshot",
    ],
    icon: ScanQrCode,
    status: "stable",
    widget: "qr-scanner",
    howItWorks:
      "Point your camera at a code, or drop in a screenshot or photo — you can also paste an image straight from the clipboard. Frames are decoded locally by the ZXing decoder compiled to WebAssembly (served from this site, not a CDN), so no image or video ever leaves your device. It reads QR codes (plus Micro QR, rMQR, Data Matrix, Aztec and PDF417) and 1D barcodes (EAN-13, EAN-8, UPC-A/E, Code 128, Code 39, Code 93, ITF, Codabar, DataBar) — and when several codes appear in one image, every one is detected, outlined and numbered on the preview and listed separately. Decoded payloads are classified automatically: URLs become clickable links, Wi-Fi codes reveal the network name and password, contact cards, calendar events, email, phone, SMS and geo payloads are split into labeled copyable fields, and EAN/UPC numbers are recognized as product codes — ISBNs even link to the book. One click turns any result back into a new QR code with the generator.",
    faq: [
      { q: "Is my camera feed or image uploaded?", a: "No. Decoding runs entirely in your browser via WebAssembly — camera frames and images are processed locally and never sent to a server." },
      { q: "Which barcode formats are supported?", a: "2D: QR Code, Micro QR, rMQR, Data Matrix, Aztec and PDF417. 1D: EAN-13, EAN-8, UPC-A, UPC-E, Code 128, Code 39, Code 93, ITF, Codabar and GS1 DataBar." },
      { q: "Can it read multiple codes in one image?", a: "Yes. Every QR code and barcode visible in the image or camera frame is detected at once — each is outlined and numbered on the preview and decoded separately, with a copy-all option." },
      { q: "Why doesn't the camera start?", a: "Your browser asks for camera permission the first time; if it was denied, re-enable it in the site settings for this page. Camera access also requires a secure HTTPS connection. You can always scan from a screenshot instead." },
      { q: "Which QR contents are recognized?", a: "URLs, Wi-Fi credentials (WIFI:), contact cards (vCard and MECARD), calendar events, email (mailto: and MATMSG), phone numbers, SMS, geo coordinates, product numbers (EAN/UPC/ISBN) and plain text." },
      { q: "Can I read a QR code from a screenshot?", a: "Yes — click Image to browse, drag and drop a file onto the tool, or paste an image from your clipboard with Ctrl/Cmd+V." },
    ],
    examples: [],
    related: ["generators/qr-code", "image/converter"],
    aliases: ["qr reader", "barcode reader", "read qr code", "decode qr", "qr code decoder", "wifi qr reader", "ean reader", "multi qr scanner"],
    added: "2026-08-06",
  },
  {
    slug: "comic-reader",
    category: "image",
    title: "CBR / CBZ Comic Reader",
    tagline: "Open and read comic book archives right in your browser",
    description:
      "Read CBR, CBZ, CB7 and CBT comic book archives online — pages are extracted locally in your browser with WebAssembly, with keyboard navigation, thumbnails, fit modes and fullscreen. No uploads.",
    keywords: [
      "cbr reader",
      "cbz reader",
      "cbr viewer online",
      "cbz viewer online",
      "open cbr file",
      "open cbz file",
      "comic book reader online",
      "comic book archive viewer",
      "read cbr online",
      "read cbz online",
      "cb7 reader",
      "cbt reader",
      "manga reader online",
      "rar comic reader",
    ],
    icon: BookOpen,
    status: "stable",
    widget: "comic-reader",
    howItWorks:
      "Drop in a comic book archive — CBZ (ZIP), CBR (RAR, including RAR5), CB7 (7-Zip) or CBT (TAR), or any plain archive of images. The file is unpacked directly in your browser by libarchive compiled to WebAssembly (served from this site, not a CDN), so the comic never leaves your device. Pages are sorted in natural reading order (page 2 before page 10) and non-image entries like ComicInfo.xml or macOS metadata are skipped. Read with the arrow keys, space bar, on-page arrows, the page scrubber or the thumbnail strip; switch between fit-to-screen, fit-to-width and actual-size views; go fullscreen for a distraction-free read; and download any single page as an image. Password-protected CBZ (ZIP) archives are supported — you'll be prompted for the password, which is only used locally.",
    faq: [
      { q: "Is my comic uploaded anywhere?", a: "No. The archive is extracted entirely in your browser using libarchive compiled to WebAssembly. Pages are held in memory on your device and are gone when you close the tab." },
      { q: "Which formats are supported?", a: "CBZ (ZIP), CBR (RAR 4 and RAR 5), CB7 (7-Zip) and CBT (TAR) — plus plain .zip, .rar, .7z and .tar archives of images. Pages can be JPG, PNG, GIF, WebP, AVIF or BMP." },
      { q: "How do I turn pages?", a: "Use the ← and → arrow keys (or space, PageUp/PageDown, Home/End), click the on-page arrows, drag the page slider, or click a thumbnail. A fullscreen mode is one click away." },
      { q: "Can it open password-protected archives?", a: "Password-protected CBZ (ZIP) archives work: you'll be asked for the password, which is used only by the local WebAssembly extractor and never transmitted. Encrypted RAR archives are not supported." },
      { q: "Why are pages in the wrong order?", a: "Pages are sorted in natural order by filename (page2 before page10), the same way desktop comic readers sort them. If a comic still reads oddly, the files inside the archive are likely misnamed." },
      { q: "What's the difference between CBR and CBZ?", a: "Both are ordinary archives of images renamed with a comic extension: CBZ is a ZIP file, CBR is a RAR file (CB7 is 7-Zip, CBT is TAR). This reader opens all of them the same way." },
    ],
    examples: [],
    related: ["image/converter", "image/gif-maker", "image/qr-scanner"],
    aliases: ["comic reader", "cbr", "cbz", "comic viewer", "read comics", "manga viewer", "comic book archive"],
    added: "2026-08-20",
  },
  {
    slug: "hash",
    category: "crypto",
    title: "Hash Generator",
    tagline: "MD5, SHA-1, SHA-256/512, SHA-3 and Keccak-256 — instantly",
    description:
      "Generate MD5, SHA-1, SHA-256, SHA-384, SHA-512, SHA3-256, SHA3-512 and Keccak-256 hashes from any text. Computed in your browser as you type.",
    keywords: ["hash generator", "md5", "sha256", "sha512", "sha-1", "keccak256", "sha3", "checksum"],
    icon: Hash,
    status: "stable",
    widget: "hash-generator",
    howItWorks:
      "Type or paste text and every supported digest is computed live using the Web Crypto API (SHA family) and pure-JS implementations (MD5, SHA-3, Keccak-256). Results are shown in hexadecimal, with an uppercase toggle. Nothing is sent to a server — hashing happens entirely in your browser.",
    faq: [
      { q: "Which hash algorithms are supported?", a: "MD5, SHA-1, SHA-256, SHA-384, SHA-512, SHA3-256, SHA3-512 and Keccak-256." },
      { q: "Is the input uploaded?", a: "No. SHA hashes use the browser's built-in Web Crypto API and the rest are computed in JavaScript locally." },
      { q: "What's the difference between SHA3-256 and Keccak-256?", a: "Keccak-256 is the original pre-standardization algorithm (used by Ethereum); SHA3-256 is the NIST-standardized variant. They produce different outputs." },
    ],
    examples: [
      { label: "Hash “hello”", query: "i=hello" },
    ],
    related: ["text/eip55-checksum", "generators/uuid"],
    aliases: ["md5 generator", "sha256 generator", "checksum tool"],
  },
  {
    slug: "uuid",
    category: "generators",
    title: "UUID & NanoID Generator",
    tagline: "Generate UUID v4, UUID v7 and NanoID in bulk",
    description:
      "Generate random UUID v4, time-ordered UUID v7, or compact NanoID values in bulk. Configure count, length and formatting, then copy them all — generated client-side.",
    keywords: ["uuid generator", "uuid v4", "uuid v7", "nanoid", "guid generator", "unique id"],
    icon: Fingerprint,
    status: "stable",
    widget: "id-generator",
    howItWorks:
      "Pick an ID type — UUID v4 (random), UUID v7 (time-ordered, sortable), or NanoID (short, URL-safe) — set how many you need, and they're generated using the browser's cryptographic random source. Toggle uppercase or hyphens, adjust NanoID length, and copy individual IDs or the whole list.",
    faq: [
      { q: "What is UUID v7?", a: "A newer UUID format whose first bits encode a millisecond timestamp, making the IDs sortable by creation time while staying globally unique — useful as database keys." },
      { q: "Are the IDs cryptographically random?", a: "Yes. They use crypto.getRandomValues / crypto.randomUUID, the browser's secure random source." },
      { q: "What is NanoID?", a: "A compact, URL-safe unique ID (21 characters by default) — shorter than a UUID with a similar collision resistance." },
    ],
    examples: [
      { label: "10 UUID v7s", query: "kind=uuid-v7&n=10" },
      { label: "5 NanoIDs", query: "kind=nanoid&n=5" },
    ],
    related: ["crypto/hash", "generators/qr-code"],
    aliases: ["guid", "id generator", "random id"],
  },
  {
    slug: "timestamp",
    category: "time",
    title: "Unix Timestamp Converter",
    tagline: "Convert Unix epoch time to dates and back",
    description:
      "Convert Unix timestamps (seconds or milliseconds) to human-readable dates in ISO 8601, UTC and local time — or convert a date to epoch. Includes relative time and a live clock.",
    keywords: ["unix timestamp converter", "epoch converter", "timestamp to date", "unix time", "epoch time", "iso 8601"],
    icon: Clock,
    status: "stable",
    widget: "timestamp-converter",
    howItWorks:
      "Enter a Unix timestamp in seconds or milliseconds (auto-detected) or any date string, and it's broken down into epoch seconds, epoch milliseconds, ISO 8601, UTC, your local time, and a relative description. Leave it empty to see the current time tick live. The “Now” button fills in the current epoch.",
    faq: [
      { q: "Seconds or milliseconds?", a: "Both — the tool auto-detects: values of 13+ digits are treated as milliseconds, shorter values as seconds." },
      { q: "What is a Unix timestamp?", a: "The number of seconds (or milliseconds) elapsed since 00:00:00 UTC on 1 January 1970, the Unix epoch — a compact, timezone-independent way to store time." },
      { q: "What date formats can I paste?", a: "Any string the browser can parse, including ISO 8601 (2026-06-23T00:00:00Z) and common date formats." },
    ],
    examples: [
      { label: "Convert 1719100800", query: "t=1719100800" },
    ],
    related: ["text/transform", "generators/uuid"],
    aliases: ["epoch converter", "date to timestamp"],
  },
  {
    slug: "converter",
    category: "color",
    title: "Color Converter",
    tagline: "Convert between HEX, RGB, HSL and OKLCH with contrast",
    description:
      "Convert any CSS color between HEX, RGB, HSL and OKLCH, preview it, and check WCAG contrast against black and white. Supports named colors and modern color syntax.",
    keywords: ["color converter", "hex to rgb", "rgb to hex", "hsl converter", "oklch converter", "color contrast"],
    icon: Pipette,
    status: "stable",
    widget: "color-converter",
    howItWorks:
      "Type any CSS color — a hex code, rgb()/hsl()/oklch() value, or a named color like 'tomato' — or use the picker. It's parsed by the browser and converted to HEX, RGB, HSL and OKLCH, each ready to copy. The contrast panel shows WCAG ratios against white and black so you can check legibility.",
    faq: [
      { q: "What is OKLCH?", a: "A modern, perceptually-uniform color space (Lightness, Chroma, Hue) supported in CSS. It makes lightness and hue adjustments look more consistent to the eye than HSL." },
      { q: "Which inputs are accepted?", a: "Anything the browser understands: hex (#rgb / #rrggbb / #rrggbbaa), rgb()/rgba(), hsl()/hsla(), oklch(), and named colors." },
      { q: "How is contrast calculated?", a: "Using the WCAG relative-luminance formula. A ratio of 4.5:1 meets AA for normal text; 3:1 meets AA for large text." },
    ],
    examples: [
      { label: "Convert tomato", query: "c=tomato" },
      { label: "Convert #c8f135", query: "c=%23c8f135" },
    ],
    related: ["image/converter", "text/transform"],
    aliases: ["hex rgb hsl", "css color converter"],
  },
  {
    slug: "diff",
    category: "web",
    title: "Diff Checker",
    tagline: "Compare two blocks of text line by line",
    description:
      "Compare two versions of text and see added and removed lines highlighted, with counts. A fast, private text diff that runs entirely in your browser and shares via URL.",
    keywords: ["diff checker", "text diff", "compare text", "diff tool", "text compare", "find differences"],
    icon: GitCompare,
    status: "stable",
    widget: "diff-checker",
    howItWorks:
      "Paste an original and a changed version of any text. A line-level diff (using a longest-common-subsequence algorithm) highlights additions in green and removals in red, with line numbers and totals. Both inputs are stored in the URL so you can share an exact comparison.",
    faq: [
      { q: "Is it a line diff or character diff?", a: "Line by line: each line is treated as a unit, which is ideal for comparing code, config and prose." },
      { q: "Is my text private?", a: "Yes — the comparison runs entirely in your browser. Text is only ever placed in your own URL if you choose to share it." },
      { q: "Can I swap the two sides?", a: "Yes, the Swap button exchanges the original and changed inputs." },
    ],
    examples: [],
    related: ["json/viewer", "text/transform"],
    aliases: ["compare two texts", "text comparison"],
  },
  {
    slug: "qr-code",
    category: "generators",
    title: "QR Code Generator",
    tagline: "Create QR codes from URLs and text, download PNG or SVG",
    description:
      "Generate a QR code from any URL or text with adjustable error correction, quiet zone and colors. Download as PNG or scalable SVG — generated entirely in your browser.",
    keywords: ["qr code generator", "create qr code", "url to qr", "qr code maker", "qr png svg"],
    icon: QrCode,
    status: "stable",
    widget: "qr-code",
    howItWorks:
      "Enter a URL or any text and a QR code is generated instantly. Choose an error-correction level (higher levels survive more damage but are denser), adjust the quiet-zone margin, and set the foreground and background colors. Download a high-resolution PNG or a crisp, scalable SVG.",
    faq: [
      { q: "What do the error-correction levels mean?", a: "L, M, Q and H allow roughly 7%, 15%, 25% and 30% of the code to be damaged while still scanning. Higher levels make the code denser." },
      { q: "Can I download a vector?", a: "Yes — export as SVG for print or further editing, or PNG for quick use." },
      { q: "Is the content sent anywhere?", a: "No. The QR code is rendered locally in your browser." },
    ],
    examples: [
      { label: "QR for a URL", query: "i=https%3A%2F%2Fbench.tools&ec=M" },
    ],
    related: ["image/qr-scanner", "generators/uuid", "text/url-encode"],
    aliases: ["qr generator", "make qr code"],
  },

  {
    slug: "tgs",
    category: "image",
    title: "TGS Sticker Viewer & Editor",
    tagline: "Preview, recolor and convert Telegram stickers — right in your browser",
    description:
      "Open .tgs Telegram stickers and Lottie animations: play them, check Telegram's sticker rules, recolor the palette, and convert to TGS, Lottie JSON, GIF or PNG. Everything runs locally, no uploads.",
    keywords: [
      "tgs viewer",
      "tgs file opener",
      "open tgs file",
      "telegram sticker viewer",
      "tgs to gif",
      "tgs to json",
      "json to tgs",
      "lottie to tgs converter",
      "tgs converter online",
      "tgs editor",
      "telegram animated sticker maker",
      "lottie viewer online",
      "lottie player",
      "recolor lottie",
      "dotlottie viewer",
    ],
    icon: Sticker,
    status: "stable",
    widget: "tgs-studio",
    howItWorks:
      "A .tgs Telegram sticker is a gzip-compressed Lottie (Bodymovin) animation, so the studio unpacks it with the browser's native decompression, parses the JSON and plays it on a canvas with the Lottie player — with scrubbing, loop and speed controls. It also opens plain Lottie .json files and .lottie (dotLottie) containers. An automatic checklist verifies Telegram's animated-sticker rules: 512×512 canvas, at most 3 seconds, at most 60 fps, vector-only (no bitmap images or text layers) and the 64 KB size cap. The editor lists every solid fill and stroke color in the animation as swatches — pick a new color to recolor the sticker live (gradients are left untouched), with one-click reset. Export the result as a .tgs (re-gzipped with the tgs marker, size-checked against the 64 KB limit), as pretty-printed Lottie JSON, as a PNG of the current frame, or as an animated GIF encoded in a Web Worker. Nothing ever leaves your device.",
    faq: [
      { q: "What is a .tgs file?", a: "Telegram's animated sticker format: a Lottie/Bodymovin vector animation JSON compressed with gzip. This tool unpacks, previews, edits and repacks it entirely in your browser." },
      { q: "Is my sticker uploaded anywhere?", a: "No. Decompression, playback, recoloring and every export run locally — .tgs files never touch a server." },
      { q: "How do I convert TGS to GIF?", a: "Open the .tgs and click GIF. Frames are rendered on a canvas at up to 30 fps, composited on white (GIF has no smooth transparency) and encoded with a Web Worker so the page stays responsive." },
      { q: "How do I convert Lottie JSON to TGS?", a: "Open the .json and click .tgs — the JSON is gzipped with the tgs marker added. The checklist and export note tell you if the result breaks Telegram's rules (512×512, ≤3 s, ≤60 fps, ≤64 KB, vector-only)." },
      { q: "Can I edit the sticker?", a: "You can recolor it: every solid fill and stroke color appears as a swatch — pick a replacement and the preview updates live. Gradients and bitmap content are not modified. For structural edits, export the Lottie JSON and edit it in After Effects or a Lottie editor." },
      { q: "Why doesn't Telegram accept my exported sticker?", a: "Check the built-in checklist: the canvas must be exactly 512×512, duration at most 3 seconds, frame rate at most 60 fps, the file at most 64 KB, and it must be vector-only. Importing still requires Telegram's @Stickers bot." },
      { q: "Does it play regular Lottie files too?", a: "Yes — plain Lottie .json and .lottie (dotLottie) files open the same way, so it doubles as a local Lottie previewer and Lottie-to-GIF converter." },
    ],
    examples: [],
    related: ["image/gif-maker", "image/converter", "text/gzip", "files/unzip"],
    aliases: ["tgs", "telegram sticker", "lottie", "sticker viewer", "sticker converter", "animated sticker", "bodymovin viewer", "tgs player"],
    added: "2026-08-20",
  },

  /* ============================ FILES & ARCHIVES =========================== */
  {
    slug: "unzip",
    category: "files",
    title: "Archive Extractor",
    tagline: "Unzip ZIP, RAR, 7z, TAR and GZ archives in your browser",
    description:
      "Open and extract ZIP, RAR, 7z, TAR (.gz/.bz2/.xz), GZ and ISO archives online — browse the contents, download single files or repack everything as ZIP. Extraction runs locally via WebAssembly, no uploads.",
    keywords: [
      "unzip online",
      "unrar online",
      "extract zip online",
      "extract rar online",
      "7z extractor online",
      "open rar file",
      "open 7z file",
      "untar online",
      "extract tar.gz online",
      "rar to zip converter",
      "archive extractor",
      "zip file opener",
      "gz decompress file",
    ],
    icon: PackageOpen,
    status: "stable",
    widget: "archive-extract",
    howItWorks:
      "Drop in an archive — ZIP, RAR (4 and 5), 7z, TAR and compressed tarballs (.tar.gz/.tgz, .tar.bz2, .tar.xz), single .gz files, ISO images and comic archives (CBZ/CBR). It is opened by libarchive compiled to WebAssembly, served from this site and running in a Web Worker, so the file never leaves your device. The contents are listed instantly with per-file sizes (in natural order, without extracting everything first); download any single file on demand, or use “All as ZIP” to extract the whole archive and repack it as a standard ZIP — which also makes this a RAR-to-ZIP or 7z-to-ZIP converter. Password-protected ZIP archives are supported: you'll be prompted and the password never leaves the local extractor.",
    faq: [
      { q: "Is my archive uploaded anywhere?", a: "No. Listing and extraction run entirely in your browser via libarchive compiled to WebAssembly. Files exist only in your tab's memory." },
      { q: "Which archive formats can it open?", a: "ZIP, RAR (v4 and v5), 7z, TAR, TAR.GZ/TGZ, TAR.BZ2, TAR.XZ, bare .gz files, ISO images, and comic book archives (CBZ, CBR, CB7, CBT)." },
      { q: "Can it convert RAR to ZIP?", a: "Yes — open the RAR and click “All as ZIP”. The contents are extracted locally and repacked into a standard ZIP with folder structure preserved. The same works for 7z and TAR." },
      { q: "Can it open password-protected archives?", a: "Password-protected ZIP archives work — you'll be asked for the password, which is used only by the local extractor. Encrypted RAR archives are not supported." },
      { q: "Do I have to extract the whole archive?", a: "No. The contents are listed without extracting anything; each file is decompressed individually only when you download it." },
      { q: "Is there a size limit?", a: "No fixed limit, but everything happens in your browser's memory — very large archives (multiple GB) may be slow or fail depending on your device." },
    ],
    examples: [],
    related: ["files/zip", "text/gzip", "image/comic-reader"],
    aliases: ["unzip", "unrar", "un7z", "extract archive", "open zip", "zip extractor", "rar extractor", "tar extractor", "iso extractor", "decompress file"],
    added: "2026-08-20",
  },
  {
    slug: "zip",
    category: "files",
    title: "Archive Creator",
    tagline: "Make ZIP or TAR.GZ archives from your files — no uploads",
    description:
      "Create ZIP or TAR.GZ archives from any files, compressed entirely in your browser with the native compression engine. Pick a format, name the archive, download it — nothing is uploaded.",
    keywords: [
      "create zip online",
      "zip files online",
      "make zip file",
      "compress files online",
      "zip creator",
      "tar.gz creator online",
      "create tar gz",
      "file compressor online",
      "combine files into zip",
    ],
    icon: FolderArchive,
    status: "stable",
    widget: "archive-create",
    howItWorks:
      "Add any files — drag and drop or browse, any type and any number. Choose the output container: ZIP (deflate-compressed entries, opens everywhere, falls back to stored entries when deflate wouldn't help) or TAR.GZ (a ustar tarball gzipped whole, the Unix standard). Both are assembled directly in your browser: compression uses the browser's native CompressionStream, so your files never leave your device. Name the archive, click Create, and download the result — the before/after size and compression ratio are shown for every build.",
    faq: [
      { q: "Are my files uploaded anywhere?", a: "No. The archive is assembled entirely in your browser and compressed with the browser's built-in compression engine. Your files never touch a server." },
      { q: "Which formats can it create?", a: "ZIP (deflate-compressed) and TAR.GZ. ZIP is the most compatible; TAR.GZ is standard on Linux and macOS." },
      { q: "Which format compresses best?", a: "Both use the same DEFLATE algorithm, so ratios are similar. TAR.GZ compresses the files as one stream, which helps with many small similar files; ZIP compresses each file separately but allows extracting single files quickly." },
      { q: "Can I password-protect the archive?", a: "No — classic ZIP encryption is insecure and modern AES zips aren't widely supported, so it's not offered. Your files stay on your device anyway, since nothing is uploaded." },
      { q: "Does it keep folder structure?", a: "Files are stored flat under the names they were added with. To preserve a folder tree, open an existing archive in the extractor and repack it — that keeps its paths." },
      { q: "Is there a size limit?", a: "ZIP output is capped at the format's 4 GB (non-ZIP64) limit; in practice browser memory is the real constraint for multi-gigabyte inputs." },
    ],
    examples: [{ label: "Create a TAR.GZ", query: "fmt=tgz" }],
    related: ["files/unzip", "text/gzip", "image/converter"],
    aliases: ["zip", "make archive", "tar creator", "tgz", "compress to zip", "file archiver", "bundle files"],
    added: "2026-08-20",
  },

  /* ============================== TIME & DATE ============================= */
  {
    slug: "date-converter",
    category: "time",
    title: "Date Converter — Formats, Calendars & Timezones",
    tagline: "Convert dates across formats, world calendars and timezones",
    description:
      "Convert any date to ISO 8601, RFC 2822, Unix time and locale formats — and into the Hijri (Islamic), Hebrew, Persian, Indian, Buddhist, Japanese, Chinese, Coptic, Ethiopic and Minguo calendars. Plus Julian Day, zodiac, season and 400+ timezones.",
    keywords: [
      "date converter",
      "hijri date converter",
      "islamic calendar converter",
      "gregorian to hijri",
      "hebrew date converter",
      "persian calendar converter",
      "julian day",
      "date format converter",
      "timezone converter",
      "iso 8601 date",
    ],
    icon: CalendarClock,
    status: "stable",
    widget: "date-converter",
    howItWorks:
      "Enter a date in almost any form — ISO, a locale string, or a Unix timestamp — and it's rendered every way at once. Standard formats include ISO 8601 (UTC and local), RFC 2822, Unix seconds/milliseconds, US/European locale, day of week, day of year, ISO week, quarter, leap year, Julian Date and more. The date is also converted into a dozen calendar systems — Gregorian, Hijri (Umm al-Qura and Civil), Persian (Solar Hijri), Hebrew, Indian National, Buddhist, Japanese imperial era, Chinese, Coptic, Ethiopic and Minguo — and shown across 400+ timezones with offsets. Leave the field empty to watch the current time live.",
    faq: [
      { q: "Can it convert Gregorian dates to Hijri (Islamic)?", a: "Yes. Every date is shown in the Hijri calendar in both the Umm al-Qura (Saudi official) and tabular Civil variants, alongside the Persian, Hebrew and other calendars — using your browser's Intl calendar support." },
      { q: "Which calendar systems are supported?", a: "Gregorian, Islamic/Hijri (Umm al-Qura and Civil), Persian (Solar Hijri), Hebrew, Indian National (Śaka), Buddhist (Thai), Japanese imperial era, Chinese lunisolar, Coptic, Ethiopic and Minguo (ROC)." },
      { q: "What date formats can I paste?", a: "Anything the browser can parse, including ISO 8601 (2026-06-23T00:00:00Z), locale date strings, and Unix timestamps in seconds or milliseconds." },
      { q: "Does it handle timezones?", a: "Yes — pick from over 400 timezones to see the date there with its UTC offset, plus a built-in list of major world cities." },
    ],
    examples: [
      { label: "Convert a UTC date", query: "d=2026-06-23T12:00:00Z" },
      { label: "Today in every calendar", query: "d=2026-01-01" },
    ],
    related: ["time/timestamp", "time/day-calculator"],
    aliases: ["hijri converter", "islamic date converter", "calendar converter", "gregorian to hijri"],
  },
  {
    slug: "day-calculator",
    category: "time",
    title: "Day Calculator",
    tagline: "Days between dates, date math and age",
    description:
      "Count the days, weeks and business days between two dates, add or subtract time from a date, or calculate an exact age. A fast, shareable date calculator.",
    keywords: ["day calculator", "days between dates", "date calculator", "add days to date", "age calculator", "business days"],
    icon: CalendarDays,
    status: "stable",
    widget: "day-calculator",
    howItWorks:
      "Three modes in one tool. ‘Between’ counts the total days, weeks, months and business days between two dates. ‘Add / Subtract’ shifts a date by a number of days, weeks, months or years and shows the resulting date and weekday. ‘Age’ turns a birthdate into an exact age in years, months and days, total days lived, and a countdown to the next birthday.",
    faq: [
      { q: "How do I count days between two dates?", a: "Use the ‘Between’ mode, pick a start and end date, and you'll get the total days plus a weeks/months breakdown and the number of business days." },
      { q: "Can it add or subtract days from a date?", a: "Yes. In ‘Add / Subtract’ mode, enter a date and a signed amount with a unit (days, weeks, months or years) to get the resulting date." },
    ],
    examples: [
      { label: "Days in H1 2026", query: "m=between&a=2026-01-01&b=2026-06-23" },
    ],
    related: ["time/date-converter", "time/timestamp"],
    aliases: ["date difference", "days until", "age calculator"],
  },

  /* ============================== GENERATORS ============================= */
  {
    slug: "password",
    category: "generators",
    title: "Password Generator",
    tagline: "Strong random passwords and passphrases",
    description:
      "Generate strong, random passwords or memorable passphrases with full control over length, character sets and word count. Cryptographically secure and 100% local.",
    keywords: ["password generator", "random password", "strong password", "passphrase generator", "secure password"],
    icon: Lock,
    status: "stable",
    widget: "password-generator",
    howItWorks:
      "Choose ‘Characters’ for a classic random password — set the length and toggle lowercase, uppercase, digits and symbols, optionally excluding ambiguous characters — or ‘Passphrase’ for a memorable sequence of words. Everything uses the browser's cryptographically secure random source (crypto.getRandomValues), and a live strength meter estimates the entropy. Nothing is transmitted or stored.",
    faq: [
      { q: "Are the passwords cryptographically secure?", a: "Yes. They're generated with crypto.getRandomValues using unbiased sampling, entirely in your browser — no password is ever sent anywhere." },
      { q: "What is a passphrase?", a: "A password made of several random words (e.g. amber-tiger-cabin-09). Passphrases are easier to remember and can be very strong when long enough." },
      { q: "How long should my password be?", a: "Aim for at least 16 characters with mixed character types, or a 4+ word passphrase. The strength meter shows the estimated entropy in bits." },
    ],
    examples: [
      { label: "20-character password", query: "len=20" },
    ],
    related: ["generators/uuid", "crypto/hash"],
    aliases: ["random password generator", "passphrase"],
  },
  {
    slug: "random",
    category: "generators",
    title: "Random Generator",
    tagline: "Random numbers, strings, bytes, dice and coins",
    description:
      "Generate random integers, decimals, strings, hex bytes, dice rolls and coin flips with cryptographically secure randomness — configurable and shareable.",
    keywords: ["random number generator", "random generator", "rng", "random string", "dice roller", "coin flip"],
    icon: Shuffle,
    status: "stable",
    widget: "random-generator",
    howItWorks:
      "Pick a mode — integers, decimals, strings, raw bytes, dice (NdM) or coin flips — set the parameters, and generate. All randomness comes from the browser's cryptographically secure generator, so results are unpredictable. Copy individual results or the whole batch.",
    faq: [
      { q: "Is the randomness secure?", a: "Yes — it uses crypto.getRandomValues, the browser's cryptographically secure random source, not Math.random." },
      { q: "Can I generate unique numbers?", a: "Yes. In integer mode, enable ‘unique’ to draw without repetition within the requested range." },
    ],
    examples: [
      { label: "Random integers", query: "mode=integers" },
      { label: "Roll dice", query: "mode=dice" },
    ],
    related: ["generators/lucky-draw", "generators/uuid"],
    aliases: ["rng", "random number", "dice roller"],
  },
  {
    slug: "lucky-draw",
    category: "generators",
    title: "Lucky Draw / Random Picker",
    tagline: "Pick random winners from a list",
    description:
      "Paste a list of names or entries and draw random winners with a fair, cryptographic shuffle. Pick one or many, with or without repeats — a free raffle and random picker.",
    keywords: ["lucky draw", "random picker", "random name picker", "raffle", "winner generator", "pick a random name"],
    icon: Dices,
    status: "stable",
    widget: "lucky-draw",
    howItWorks:
      "Paste your entries one per line, choose how many winners to draw and whether to allow repeats, then hit Draw. A cryptographic Fisher–Yates shuffle picks the winners fairly, with a quick reveal animation. Everything stays in your browser — perfect for raffles, giveaways and picking who goes first.",
    faq: [
      { q: "Is the draw fair?", a: "Yes. It uses a Fisher–Yates shuffle seeded by the browser's cryptographically secure random source, giving every entry an equal chance." },
      { q: "Can I draw multiple winners?", a: "Yes — set the number of winners. You can draw without replacement (no repeats) or allow the same entry to win more than once." },
    ],
    examples: [],
    related: ["generators/random", "generators/uuid"],
    aliases: ["raffle", "random name picker", "winner picker"],
  },

  /* ============================== CRYPTO ================================= */
  {
    slug: "ecdsa",
    category: "crypto",
    title: "ECDSA Sign & Verify",
    tagline: "Generate keys, sign messages and verify signatures",
    description:
      "Generate ECDSA key pairs (P-256/P-384/P-521), sign messages and verify signatures in your browser using the Web Crypto API. Keys and signatures never leave your device.",
    keywords: ["ecdsa", "sign message", "verify signature", "digital signature", "ec key pair", "p-256 sign"],
    icon: Signature,
    status: "stable",
    widget: "ecdsa",
    howItWorks:
      "Generate an elliptic-curve key pair on the P-256, P-384 or P-521 curve, then sign any message with the private key and verify it with the public key — all using the browser's built-in Web Crypto API. Keys are shown as JWK so you can copy and reuse them. Because everything runs locally, your private keys and messages are never transmitted.",
    faq: [
      { q: "What is ECDSA?", a: "The Elliptic Curve Digital Signature Algorithm — a widely used scheme for signing data so others can verify it came from the holder of the private key and was not altered." },
      { q: "Are my keys safe here?", a: "Yes. Key generation, signing and verification all happen in your browser via Web Crypto. Nothing is uploaded." },
      { q: "Which curves are supported?", a: "P-256 (default), P-384 and P-521, paired with SHA-256/384/512 hashing." },
    ],
    examples: [],
    related: ["crypto/hash", "text/eip55-checksum"],
    aliases: ["digital signature", "sign and verify", "elliptic curve signature"],
  },
  {
    slug: "wallet",
    category: "crypto",
    title: "Crypto Wallet Generator",
    tagline: "Ethereum HD wallets, BIP39 mnemonics and addresses",
    description:
      "Generate an Ethereum wallet in your browser: a BIP39 recovery phrase, derived addresses (BIP44 m/44'/60'/0'/0/i) and keys — or a single random key. Fully client-side, for development and learning.",
    keywords: ["wallet generator", "ethereum wallet", "bip39 mnemonic", "seed phrase generator", "eth address generator", "hd wallet"],
    icon: Wallet,
    status: "stable",
    widget: "wallet-generator",
    howItWorks:
      "Generate a BIP39 recovery phrase (12 or 24 words) and the tool deterministically derives Ethereum accounts along the standard BIP44 path m/44'/60'/0'/0/i — each with its checksummed (EIP-55) address, public key and private key. You can also paste an existing mnemonic to view its addresses, or generate a single standalone random key. Everything is computed locally with audited libraries; nothing is transmitted, and keys are never placed in the URL.",
    faq: [
      { q: "Is this safe to use for a real wallet?", a: "No — treat it as a development, testing and learning tool only. Never store funds in a wallet generated in a web page. Use a hardware wallet or an audited application for real assets." },
      { q: "Are the keys generated locally?", a: "Yes. Generation and derivation run entirely in your browser using the browser's secure random source and audited @noble / @scure libraries. No key is ever uploaded, and keys are never put in the shareable URL." },
      { q: "What derivation path is used?", a: "The standard Ethereum BIP44 path m/44'/60'/0'/0/i, the same one used by MetaMask and most wallets, so the derived addresses match." },
      { q: "Can I import an existing seed phrase?", a: "Yes — paste a valid BIP39 mnemonic into the phrase field to view its derived addresses. It stays in your browser." },
    ],
    examples: [],
    related: ["crypto/ecdsa", "text/eip55-checksum", "crypto/hash"],
    aliases: ["seed phrase generator", "eth wallet", "mnemonic generator"],
  },

  /* ============================== MATH & UNITS ========================== */
  {
    slug: "loan-simulator",
    category: "math",
    title: "Loan & Mortgage Simulator",
    tagline: "Payments, interest, repayment types and amortization schedule",
    description:
      "Calculate monthly payments, total interest and a full amortization schedule for any loan or mortgage. Compare repayment types — equal-payment, equal-principal and interest-only (balloon) — add a down payment, extra payments, an interest-only period and a start date.",
    keywords: ["loan calculator", "mortgage calculator", "amortization schedule", "monthly payment", "interest-only loan", "balloon payment", "equal principal", "extra payment calculator"],
    icon: Landmark,
    status: "stable",
    widget: "loan-simulator",
    howItWorks:
      "Enter the amount, annual rate and term, then tune any detail: pick a repayment type (equal-payment annuity, equal-principal with declining payments, or interest-only with a balloon at the end), pay interest only for an initial period, add a down payment or extra monthly payments, choose a currency and a past or future start date. The tool computes the payment(s), total interest and total cost, draws the remaining-balance curve, and lays out a year-grouped amortization schedule with real calendar dates. Everything defaults to a standard fixed-rate mortgage and updates instantly.",
    faq: [
      { q: "Which repayment types are supported?", a: "Equal-payment (annuity) — a fixed monthly payment; equal-principal — a fixed principal portion each month with a declining payment; and interest-only — pay only interest with the full principal due as a balloon at the end. You can also make an annuity loan interest-only for an initial period." },
      { q: "Can I model extra payments?", a: "Yes. Add an extra monthly amount and the tool shows the months and interest saved versus the baseline schedule and the earlier payoff date." },
      { q: "Can the start date be in the future?", a: "Yes — pick any past or future start month; the amortization schedule and payoff are labeled with the corresponding calendar dates." },
      { q: "How is the monthly payment calculated?", a: "With the standard fixed-rate amortization formula based on the principal, the monthly interest rate and the number of months. A 0% rate divides the principal evenly across the term." },
    ],
    examples: [
      { label: "$300k at 6.5% / 30yr", query: "p=300000&r=6.5&y=30" },
    ],
    related: ["math/unit-converter", "math/base-converter"],
    aliases: ["mortgage calculator", "amortization", "loan payment"],
  },
  {
    slug: "base-converter",
    category: "math",
    title: "Number Base Converter",
    tagline: "Convert between binary, octal, decimal, hex and any base",
    description:
      "Convert numbers between binary, octal, decimal, hexadecimal and any base from 2 to 36. Handles arbitrarily large integers with BigInt — instant and client-side.",
    keywords: ["base converter", "binary to decimal", "decimal to hex", "hex to binary", "number base converter", "radix converter"],
    icon: Superscript,
    status: "stable",
    widget: "base-converter",
    howItWorks:
      "Enter a number and its current base, and it's shown simultaneously in binary (grouped into nibbles), octal, decimal and hexadecimal, plus any custom base from 2 to 36. All arithmetic uses BigInt, so even very large integers convert exactly without precision loss.",
    faq: [
      { q: "What's the largest number it can convert?", a: "Effectively unlimited for integers — conversions use JavaScript BigInt, so there's no 64-bit ceiling or floating-point rounding." },
      { q: "Which bases are supported?", a: "Any base from 2 to 36 (digits 0–9 then A–Z), in addition to the standard binary, octal, decimal and hexadecimal views." },
    ],
    examples: [
      { label: "255 in every base", query: "v=255&from=10" },
      { label: "Binary 10110 to others", query: "v=10110&from=2" },
    ],
    related: ["math/unit-converter", "text/transform"],
    aliases: ["radix converter", "binary hex decimal"],
  },
  {
    slug: "unit-converter",
    category: "math",
    title: "Unit Converter",
    tagline: "Length, mass, temperature, volume, speed and more",
    description:
      "Convert between units of length, mass, temperature, area, volume, speed, time and digital storage. Enter a value and see every other unit at once — fast and offline.",
    keywords: ["unit converter", "metric converter", "length converter", "weight converter", "temperature converter", "celsius to fahrenheit"],
    icon: Ruler,
    status: "stable",
    widget: "unit-converter",
    howItWorks:
      "Pick a category — length, mass, temperature, area, volume, speed, time or digital storage — enter a value and choose its unit, and every other unit in that category updates at once. Temperature uses exact formulas (so 100°C = 212°F = 373.15 K); the rest convert through a common base unit.",
    faq: [
      { q: "Which categories are covered?", a: "Length, mass/weight, temperature, area, volume, speed, time and digital storage, with both metric and imperial units." },
      { q: "Does it convert temperature correctly?", a: "Yes — Celsius, Fahrenheit and Kelvin use their exact formulas rather than a simple multiplier." },
    ],
    examples: [
      { label: "100 m to other units", query: "cat=length&from=m&val=100" },
      { label: "100 °C to °F and K", query: "cat=temperature&from=C&val=100" },
    ],
    related: ["math/base-converter", "math/loan-simulator"],
    aliases: ["metric converter", "measurement converter"],
  },

  /* ============================== TEXT (more) =========================== */
  {
    slug: "ascii-generator",
    category: "text",
    title: "ASCII Table & Character Codes",
    tagline: "ASCII reference plus text ⇄ codes in many formats",
    description:
      "A full ASCII table reference and a character-code converter: turn text into decimal, hex, octal, binary or HTML-entity codes and back. Many representations, one tool.",
    keywords: ["ascii table", "ascii code", "character codes", "text to ascii", "ascii converter", "char to hex", "ascii to text"],
    icon: Table,
    status: "stable",
    widget: "ascii-generator",
    howItWorks:
      "Three modes: a searchable ASCII table (0–127 or 0–255) showing each character's decimal, hex, octal, binary, HTML entity and control-code name; an Encode mode that converts text to per-character codes in your chosen format and separator; and a Decode mode that turns codes back into text. Useful for debugging encodings, building escape sequences and learning the ASCII set.",
    faq: [
      { q: "What representations does it show?", a: "For every character: decimal, hexadecimal, octal, 8-bit binary, HTML numeric entity, and (for control characters) the standard name like NUL, TAB, LF or DEL." },
      { q: "Can it convert text to ASCII codes and back?", a: "Yes. Encode mode turns text into codes (decimal, hex, octal, binary, HTML entity or \\x/\\u escapes); Decode mode reconstructs the original text from codes." },
    ],
    examples: [
      { label: "Encode “Hi” to codes", query: "mode=encode&i=Hi" },
      { label: "Browse the ASCII table", query: "mode=table" },
    ],
    related: ["text/transform", "text/base64"],
    aliases: ["ascii chart", "character code converter", "text to hex"],
  },
  {
    slug: "short-url",
    category: "web",
    title: "URL Shortener",
    tagline: "Turn a URL of up to 10,000 characters into a short link — best-effort, made for handing off, not forever",
    description:
      "Shorten very long URLs (up to 10,000 characters) into a short bench.tools link. Links are stored on Vercel's free tier and cleared oldest-and-largest first when space runs out — ideal for sharing a huge URL briefly, not for permanent references.",
    keywords: [
      "url shortener",
      "shorten long url",
      "long url shortener",
      "shorten url free",
      "short link generator",
      "url shortener no signup",
      "shorten 10000 character url",
      "temporary short link",
      "tinyurl alternative",
    ],
    icon: Link,
    status: "beta",
    widget: "short-url",
    howItWorks:
      "Paste any http(s) URL up to 10,000 characters and press Shorten. This is the one Bench tool that talks to a server: the destination is saved in a private Vercel Blob store (the code is a fingerprint of the URL, so the same URL always gets the same link) and /s/<code> answers with a 302 redirect. Storage is capped well inside Vercel's free allowance; when the cap is reached, links are evicted first-in-first-out weighted by size — an old, large link is cleared before a recent, small one. There is no guarantee that any link lives forever; that is the trade-off for a free, no-signup shortener. Use it to hand a giant URL to someone today, not as a permanent reference. The long URL never enters this page's address bar, and nothing is logged beyond what Vercel keeps for the request.",
    faq: [
      { q: "How long does a short link last?", a: "As long as there is room. The store is capped below Vercel's free Blob quota; once it fills, links are removed oldest-and-largest first (ranked by bytes × age). A small link may live a long time, a 10,000-character link will go sooner. Nothing is guaranteed — do not rely on these links in published documents or code." },
      { q: "Why the 10,000-character limit?", a: "Most browsers and servers handle URLs of around 2,000 characters comfortably and start failing somewhere between 8,000 and 32,000. A 10,000-character ceiling covers huge query strings, data-heavy deep links and share URLs from other Bench tools while keeping every stored link small." },
      { q: "Is it private?", a: "The destination URL is stored server-side in a private Vercel Blob store — it is not publicly listable, but anyone holding the short link can follow it. Do not shorten URLs that contain secrets or tokens you would not paste into a chat." },
      { q: "What happens if I shorten the same URL twice?", a: "You get the same short link. The code is derived from a SHA-256 fingerprint of the URL, so repeating a request never creates duplicates." },
      { q: "Why does the redirect use 302?", a: "Because links can expire. A temporary (302) redirect tells browsers and crawlers not to cache the mapping permanently, and the redirect responses are marked noindex." },
      { q: "Can I delete a link?", a: "Not yet. Links are cleared automatically as the store fills. If you need one gone sooner, open an issue on GitHub with the code." },
      { q: "Do the Share buttons use it?", a: "Yes. When a tool's share link is longer than 2,000 characters, Share copies a short link instead of the full URL (shift-click to copy the full URL). Short links are best-effort, so the full URL — which still carries the entire state — remains the durable form." },
    ],
    examples: [
      { label: "Shorten a Bench deep link", query: "i=https%3A%2F%2Fbench.tools%2Ftext%2Ftransform%3Ft%3Dbase64-encode%26i%3DHello%252C%2Bworld" },
    ],
    related: ["generators/qr-code", "text/url-encode", "text/gzip"],
    aliases: ["link shortener", "shorten link", "short url", "tinyurl", "bitly alternative"],
    added: "2026-09-16",
  },
];

/* ------------------------------------------------------------------ indexes */

const BY_ID = new Map(TOOLS.map((t) => [`${t.category}/${t.slug}`, t]));

export function getTool(category: string, slug: string): ToolDef | undefined {
  return BY_ID.get(`${category}/${slug}`);
}

export function getToolById(id: string): ToolDef | undefined {
  return BY_ID.get(id);
}

export function getToolsByCategory(category: CategorySlug): ToolDef[] {
  return TOOLS.filter((t) => t.category === category);
}

/** All `{ category, slug }` pairs for `generateStaticParams`. */
export function allToolParams(): { category: string; tool: string }[] {
  return TOOLS.map((t) => ({ category: t.category, tool: t.slug }));
}

export function getRelatedTools(tool: ToolDef): ToolDef[] {
  const out: ToolDef[] = [];
  for (const id of tool.related ?? []) {
    // related may reference a category (e.g. "crypto") — skip those here.
    const t = BY_ID.get(id);
    if (t && t !== tool) out.push(t);
  }
  return out;
}
