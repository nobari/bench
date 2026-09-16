/**
 * Romaji ⇄ kana transliteration.
 *
 * Romaji → kana follows Japanese IME conventions (Hepburn, Kunrei and
 * Nihon-shiki spellings all accepted): `shi`/`si` → し, `tsu`/`tu` → つ,
 * doubled consonants → っ, `nn` / `n'` / n-before-consonant → ん, macrons and
 * `-` become long vowels, `x`/`l` prefixes give small kana. Kana → romaji
 * produces modified Hepburn (with macrons) or wāpuro-style spelled-out output.
 * Kanji and anything unrecognised pass through untouched.
 */

export type KanaScript = "hiragana" | "katakana";
export type RomajiStyle = "hepburn" | "wapuro";

/* ------------------------------------------------------- romaji → hiragana */

const R2K: Record<string, string> = {
  a: "あ", i: "い", u: "う", e: "え", o: "お",
  ka: "か", ki: "き", ku: "く", ke: "け", ko: "こ",
  kya: "きゃ", kyi: "きぃ", kyu: "きゅ", kye: "きぇ", kyo: "きょ",
  ga: "が", gi: "ぎ", gu: "ぐ", ge: "げ", go: "ご",
  gya: "ぎゃ", gyi: "ぎぃ", gyu: "ぎゅ", gye: "ぎぇ", gyo: "ぎょ",
  sa: "さ", si: "し", shi: "し", su: "す", se: "せ", so: "そ",
  sha: "しゃ", sya: "しゃ", shu: "しゅ", syu: "しゅ", sho: "しょ", syo: "しょ",
  she: "しぇ", sye: "しぇ", syi: "しぃ",
  za: "ざ", zi: "じ", ji: "じ", zu: "ず", ze: "ぜ", zo: "ぞ",
  ja: "じゃ", jya: "じゃ", zya: "じゃ", ju: "じゅ", jyu: "じゅ", zyu: "じゅ",
  jo: "じょ", jyo: "じょ", zyo: "じょ", je: "じぇ", jye: "じぇ", zye: "じぇ",
  jyi: "じぃ", zyi: "じぃ",
  ta: "た", ti: "ち", chi: "ち", tu: "つ", tsu: "つ", te: "て", to: "と",
  cha: "ちゃ", tya: "ちゃ", chu: "ちゅ", tyu: "ちゅ", cho: "ちょ", tyo: "ちょ",
  che: "ちぇ", tye: "ちぇ", cyi: "ちぃ", tyi: "ちぃ",
  cya: "ちゃ", cyu: "ちゅ", cyo: "ちょ", cye: "ちぇ",
  tsa: "つぁ", tsi: "つぃ", tse: "つぇ", tso: "つぉ",
  tha: "てゃ", thi: "てぃ", thu: "てゅ", the: "てぇ", tho: "てょ",
  twa: "とぁ", twi: "とぃ", twu: "とぅ", twe: "とぇ", two: "とぉ",
  da: "だ", di: "ぢ", du: "づ", de: "で", do: "ど",
  dya: "ぢゃ", dyi: "ぢぃ", dyu: "ぢゅ", dye: "ぢぇ", dyo: "ぢょ",
  dha: "でゃ", dhi: "でぃ", dhu: "でゅ", dhe: "でぇ", dho: "でょ",
  dwa: "どぁ", dwi: "どぃ", dwu: "どぅ", dwe: "どぇ", dwo: "どぉ",
  na: "な", ni: "に", nu: "ぬ", ne: "ね", no: "の",
  nya: "にゃ", nyi: "にぃ", nyu: "にゅ", nye: "にぇ", nyo: "にょ",
  ha: "は", hi: "ひ", hu: "ふ", fu: "ふ", he: "へ", ho: "ほ",
  hya: "ひゃ", hyi: "ひぃ", hyu: "ひゅ", hye: "ひぇ", hyo: "ひょ",
  fa: "ふぁ", fi: "ふぃ", fe: "ふぇ", fo: "ふぉ",
  fya: "ふゃ", fyu: "ふゅ", fyo: "ふょ",
  ba: "ば", bi: "び", bu: "ぶ", be: "べ", bo: "ぼ",
  bya: "びゃ", byi: "びぃ", byu: "びゅ", bye: "びぇ", byo: "びょ",
  pa: "ぱ", pi: "ぴ", pu: "ぷ", pe: "ぺ", po: "ぽ",
  pya: "ぴゃ", pyi: "ぴぃ", pyu: "ぴゅ", pye: "ぴぇ", pyo: "ぴょ",
  ma: "ま", mi: "み", mu: "む", me: "め", mo: "も",
  mya: "みゃ", myi: "みぃ", myu: "みゅ", mye: "みぇ", myo: "みょ",
  ya: "や", yi: "い", yu: "ゆ", ye: "いぇ", yo: "よ",
  ra: "ら", ri: "り", ru: "る", re: "れ", ro: "ろ",
  rya: "りゃ", ryi: "りぃ", ryu: "りゅ", rye: "りぇ", ryo: "りょ",
  wa: "わ", wi: "うぃ", wu: "う", we: "うぇ", wo: "を",
  wyi: "ゐ", wye: "ゑ", wha: "うぁ", whi: "うぃ", whu: "う", whe: "うぇ", who: "うぉ",
  va: "ゔぁ", vi: "ゔぃ", vu: "ゔ", ve: "ゔぇ", vo: "ゔぉ",
  vya: "ゔゃ", vyu: "ゔゅ", vyo: "ゔょ",
  kwa: "くぁ", kwi: "くぃ", kwu: "くぅ", kwe: "くぇ", kwo: "くぉ",
  gwa: "ぐぁ", gwi: "ぐぃ", gwu: "ぐぅ", gwe: "ぐぇ", gwo: "ぐぉ",
  qa: "くぁ", qi: "くぃ", qu: "く", qe: "くぇ", qo: "くぉ",
  // small kana
  xa: "ぁ", xi: "ぃ", xu: "ぅ", xe: "ぇ", xo: "ぉ",
  la: "ぁ", li: "ぃ", lu: "ぅ", le: "ぇ", lo: "ぉ",
  xya: "ゃ", xyu: "ゅ", xyo: "ょ", lya: "ゃ", lyu: "ゅ", lyo: "ょ",
  xtu: "っ", xtsu: "っ", ltu: "っ", ltsu: "っ",
  xwa: "ゎ", lwa: "ゎ", xka: "ゕ", lka: "ゕ", xke: "ゖ", lke: "ゖ",
  xn: "ん", "n'": "ん",
};

const R2K_MAX = 4;
const VOWELS = "aiueo";
const CONSONANTS = "bcdfghjklmnpqrstvwxyz";

/** Long-vowel extension in hiragana — ō → おう, ē → ええ (IME/wāpuro style). */
const LONG_H: Record<string, string> = { a: "あ", i: "い", u: "う", e: "え", o: "う" };
const MACRON: Record<string, string> = {
  "ā": "a", "â": "a", "ī": "i", "î": "i", "ū": "u", "û": "u",
  "ē": "e", "ê": "e", "ō": "o", "ô": "o",
};
/** Internal marker inserted after a macron vowel. */
const LONG = "\u0001";

export function hiraganaToKatakana(s: string): string {
  return s.replace(/[ぁ-ゖ]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60));
}
export function katakanaToHiragana(s: string): string {
  return s.replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
}

/**
 * Convert romaji to kana. Everything the parser doesn't recognise (spaces,
 * digits, kanji, existing kana) is passed through.
 */
export function romajiToKana(input: string, script: KanaScript = "hiragana"): string {
  // Lower-case Latin and mark macron/circumflex vowels with a trailing LONG marker.
  let s = "";
  for (const ch of input.normalize("NFC")) {
    const lower = ch.toLowerCase();
    const m = MACRON[lower];
    if (m) s += m + LONG;
    else if (ch >= "A" && ch <= "Z") s += lower;
    else s += ch;
  }

  // Hepburn writes the particles は/へ/を phonetically as wa/e/o; standalone
  // tokens are treated as particles. The two greetings are unambiguous.
  s = s
    .replace(/konnichiwa/g, "konnichiha")
    .replace(/konbanwa/g, "konbanha")
    .replace(/(^|[^a-z'])wa(?=$|[^a-z'\-])/g, "$1は")
    .replace(/(^|[^a-z'])e(?=$|[^a-z'\-])/g, "$1へ")
    .replace(/(^|[^a-z'])o(?=$|[^a-z'\-])/g, "$1を");

  let out = "";
  let i = 0;
  const n = s.length;
  const isVowel = (c: string) => c !== "" && VOWELS.includes(c);
  const isCons = (c: string) => c !== "" && CONSONANTS.includes(c);

  while (i < n) {
    const c = s[i];

    if (c === LONG) {
      out += script === "katakana" ? "ー" : (LONG_H[lastVowel(out)] ?? "");
      i++;
      continue;
    }
    if (c === "-" && lastVowel(out)) {
      out += "ー";
      i++;
      continue;
    }

    // Longest table match. In katakana (loanword) mode, ti/di are ティ/ディ.
    let matched = false;
    for (let len = Math.min(R2K_MAX, n - i); len >= 1; len--) {
      const key = s.slice(i, i + len);
      const kana =
        script === "katakana" && (key === "ti" || key === "di")
          ? key === "ti" ? "てぃ" : "でぃ"
          : R2K[key];
      if (kana !== undefined) {
        out += kana;
        i += len;
        matched = true;
        break;
      }
    }
    if (matched) continue;

    const next = s[i + 1] ?? "";

    // Syllabic n: before a consonant (except y), before a non-letter, or at end.
    // "nn" is ん — but IME-style, "nn" + vowel is ん + な行 (konnichiwa → こんにちは)
    // while "nn" + consonant/end is a single ん (kannji → かんじ).
    if (c === "n") {
      if (next === "n") {
        const after = s[i + 2] ?? "";
        out += "ん";
        i += isVowel(after) || after === "y" ? 1 : 2;
        continue;
      }
      if (!(isVowel(next) || next === "y" || next === "'")) {
        out += "ん";
        i++;
        continue;
      }
    }
    // Traditional Hepburn writes ん as "m" before b/p/m (shimbun → しんぶん).
    if (c === "m" && (next === "b" || next === "p" || next === "m")) {
      out += "ん";
      i++;
      continue;
    }
    // Sokuon: doubled consonant, or "tc" as in matcha → まっちゃ.
    if (isCons(c) && c !== "n" && (next === c || (c === "t" && next === "c"))) {
      out += "っ";
      i++;
      continue;
    }

    // Japanese punctuation for sentence-level ASCII marks (not inside numbers).
    const prev = s[i - 1] ?? "";
    const inNumber = /\d/.test(prev) && /\d/.test(next);
    if (c === "." && !inNumber) { out += "。"; i++; continue; }
    if (c === "," && !inNumber) { out += "、"; i++; continue; }
    if (c === "?") { out += "？"; i++; continue; }
    if (c === "!") { out += "！"; i++; continue; }

    out += c;
    i++;
  }

  if (script === "katakana") out = hiraganaToKatakana(out);
  return out;
}

/** The romaji vowel that ends the kana emitted so far ("" if none). */
function lastVowel(kana: string): string {
  const last = kana[kana.length - 1] ?? "";
  if (!last) return "";
  const r = K2R_BASE[last] ?? K2R_BASE[katakanaToHiragana(last)];
  if (!r) return "";
  const v = r[r.length - 1];
  return VOWELS.includes(v) ? v : "";
}

/* ------------------------------------------------------- hiragana → romaji */

const K2R_BASE: Record<string, string> = {
  "あ": "a", "い": "i", "う": "u", "え": "e", "お": "o",
  "か": "ka", "き": "ki", "く": "ku", "け": "ke", "こ": "ko",
  "さ": "sa", "し": "shi", "す": "su", "せ": "se", "そ": "so",
  "た": "ta", "ち": "chi", "つ": "tsu", "て": "te", "と": "to",
  "な": "na", "に": "ni", "ぬ": "nu", "ね": "ne", "の": "no",
  "は": "ha", "ひ": "hi", "ふ": "fu", "へ": "he", "ほ": "ho",
  "ま": "ma", "み": "mi", "む": "mu", "め": "me", "も": "mo",
  "や": "ya", "ゆ": "yu", "よ": "yo",
  "ら": "ra", "り": "ri", "る": "ru", "れ": "re", "ろ": "ro",
  "わ": "wa", "ゐ": "wi", "ゑ": "we", "を": "o", "ん": "n",
  "が": "ga", "ぎ": "gi", "ぐ": "gu", "げ": "ge", "ご": "go",
  "ざ": "za", "じ": "ji", "ず": "zu", "ぜ": "ze", "ぞ": "zo",
  "だ": "da", "ぢ": "ji", "づ": "zu", "で": "de", "ど": "do",
  "ば": "ba", "び": "bi", "ぶ": "bu", "べ": "be", "ぼ": "bo",
  "ぱ": "pa", "ぴ": "pi", "ぷ": "pu", "ぺ": "pe", "ぽ": "po",
  "ゔ": "vu",
  "ぁ": "a", "ぃ": "i", "ぅ": "u", "ぇ": "e", "ぉ": "o",
  "ゃ": "ya", "ゅ": "yu", "ょ": "yo", "ゎ": "wa", "ゕ": "ka", "ゖ": "ke",
};

const K2R_DIGRAPH: Record<string, string> = {
  "きゃ": "kya", "きゅ": "kyu", "きょ": "kyo", "きぇ": "kye",
  "ぎゃ": "gya", "ぎゅ": "gyu", "ぎょ": "gyo", "ぎぇ": "gye",
  "しゃ": "sha", "しゅ": "shu", "しょ": "sho", "しぇ": "she",
  "じゃ": "ja", "じゅ": "ju", "じょ": "jo", "じぇ": "je",
  "ちゃ": "cha", "ちゅ": "chu", "ちょ": "cho", "ちぇ": "che",
  "ぢゃ": "ja", "ぢゅ": "ju", "ぢょ": "jo",
  "にゃ": "nya", "にゅ": "nyu", "にょ": "nyo", "にぇ": "nye",
  "ひゃ": "hya", "ひゅ": "hyu", "ひょ": "hyo", "ひぇ": "hye",
  "びゃ": "bya", "びゅ": "byu", "びょ": "byo", "びぇ": "bye",
  "ぴゃ": "pya", "ぴゅ": "pyu", "ぴょ": "pyo", "ぴぇ": "pye",
  "みゃ": "mya", "みゅ": "myu", "みょ": "myo", "みぇ": "mye",
  "りゃ": "rya", "りゅ": "ryu", "りょ": "ryo", "りぇ": "rye",
  "てぃ": "ti", "てゅ": "tyu", "でぃ": "di", "でゅ": "dyu",
  "とぅ": "tu", "どぅ": "du",
  "つぁ": "tsa", "つぃ": "tsi", "つぇ": "tse", "つぉ": "tso",
  "ふぁ": "fa", "ふぃ": "fi", "ふぇ": "fe", "ふぉ": "fo", "ふゅ": "fyu",
  "ゔぁ": "va", "ゔぃ": "vi", "ゔぇ": "ve", "ゔぉ": "vo", "ゔゅ": "vyu",
  "うぃ": "wi", "うぇ": "we", "うぉ": "wo", "いぇ": "ye",
  "くぁ": "kwa", "くぃ": "kwi", "くぇ": "kwe", "くぉ": "kwo",
  "ぐぁ": "gwa", "ぐぃ": "gwi", "ぐぇ": "gwe", "ぐぉ": "gwo",
};

const MACRON_OF: Record<string, string> = { a: "ā", i: "ī", u: "ū", e: "ē", o: "ō" };

/**
 * Convert hiragana / katakana to romaji. `hepburn` (default) uses macrons for
 * long vowels (とうきょう → tōkyō); `wapuro` spells them out as typed
 * (toukyou) and keeps ー as "-".
 */
export function kanaToRomaji(input: string, style: RomajiStyle = "hepburn"): string {
  // Particles: standalone は/へ read wa/e; the greetings are unambiguous.
  const s = katakanaToHiragana(input.normalize("NFC"))
    .replace(/こんにちは/g, "こんにちわ")
    .replace(/こんばんは/g, "こんばんわ")
    .replace(/(^|[\s、。！？])は(?=$|[\s、。！？])/g, "$1わ")
    .replace(/(^|[\s、。！？])へ(?=$|[\s、。！？])/g, "$1え");
  const n = s.length;
  // One entry per syllable (or pass-through char); `kana` marks real syllables
  // so long-vowel merging never crosses into pass-through text.
  const parts: { text: string; kana: boolean }[] = [];
  let i = 0;
  let pendingSokuon = 0;

  const pushSyllable = (r: string) => {
    let text = r;
    if (pendingSokuon > 0) {
      const c0 = r[0];
      const dbl = c0 === "c" ? "t" : c0; // っち → tchi
      text = dbl.repeat(pendingSokuon) + r;
      pendingSokuon = 0;
    }
    parts.push({ text, kana: true });
  };
  const flushSokuon = () => {
    if (pendingSokuon) {
      parts.push({ text: "'".repeat(pendingSokuon), kana: false });
      pendingSokuon = 0;
    }
  };

  while (i < n) {
    const c = s[i];
    const two = s.slice(i, i + 2);

    if (c === "っ") {
      pendingSokuon++;
      i++;
      continue;
    }
    if (c === "ー") {
      flushSokuon();
      const prev = parts[parts.length - 1];
      const v = prev?.kana ? prev.text[prev.text.length - 1] : "";
      if (v && VOWELS.includes(v)) {
        if (style === "hepburn") prev.text = prev.text.slice(0, -1) + MACRON_OF[v];
        else prev.text += "-";
      } else parts.push({ text: "-", kana: false });
      i++;
      continue;
    }
    const d = K2R_DIGRAPH[two];
    if (d) {
      pushSyllable(d);
      i += 2;
      continue;
    }
    const b = K2R_BASE[c];
    if (b !== undefined) {
      if (c === "ん") {
        flushSokuon();
        // n' before a vowel or y so しんや (shin'ya) ≠ しにゃ (shinya).
        const nr = K2R_DIGRAPH[s.slice(i + 1, i + 3)] ?? K2R_BASE[s[i + 1] ?? ""] ?? "";
        parts.push({ text: nr && (VOWELS.includes(nr[0]) || nr[0] === "y") ? "n'" : "n", kana: true });
        i++;
        continue;
      }
      pushSyllable(b);
      i++;
      continue;
    }

    flushSokuon();
    if (c === "。") parts.push({ text: ".", kana: false });
    else if (c === "、") parts.push({ text: ",", kana: false });
    else if (c === "？") parts.push({ text: "?", kana: false });
    else if (c === "！") parts.push({ text: "!", kana: false });
    else if (c === "　" || c === "・") parts.push({ text: " ", kana: false });
    else parts.push({ text: c, kana: false });
    i++;
  }
  flushSokuon();

  if (style === "hepburn") {
    // Merge long vowels across adjacent syllables: おう/おお → ō, うう → ū,
    // ああ → ā, ええ → ē. (いい stays ii and えい stays ei, per modified Hepburn.)
    const LONG_PAIRS: Record<string, string> = { ou: "ō", oo: "ō", uu: "ū", aa: "ā", ee: "ē" };
    for (let k = 1; k < parts.length; k++) {
      const prev = parts[k - 1];
      const cur = parts[k];
      if (!prev.kana || !cur.kana) continue;
      if (cur.text.length !== 1 || !VOWELS.includes(cur.text)) continue;
      const v = prev.text[prev.text.length - 1];
      const merged = LONG_PAIRS[v + cur.text];
      if (!merged) continue;
      prev.text = prev.text.slice(0, -1) + merged;
      parts.splice(k, 1);
      k--;
    }
  }

  let out = parts.map((p) => p.text).join("");
  // Space after sentence punctuation when text continues.
  out = out.replace(/([.,?!])(?=[^\s.,?!])/g, "$1 ");
  return out;
}
