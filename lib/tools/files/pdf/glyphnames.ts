/**
 * Glyph names → characters for the encodings simple fonts use (Standard, WinAnsi, MacRoman and their Differences),
 * so a standard font's whole character set can be typed into, not only the characters a page already shows.
 */
const NAMES: Record<string, string> = {
  space: " ", exclam: "!", quotedbl: '"', numbersign: "#", dollar: "$", percent: "%", ampersand: "&", quotesingle: "'", quoteright: "’", parenleft: "(", parenright: ")", asterisk: "*", plus: "+", comma: ",", hyphen: "-", minus: "−", period: ".", slash: "/",
  zero: "0", one: "1", two: "2", three: "3", four: "4", five: "5", six: "6", seven: "7", eight: "8", nine: "9", colon: ":", semicolon: ";", less: "<", equal: "=", greater: ">", question: "?", at: "@",
  bracketleft: "[", backslash: "\\", bracketright: "]", asciicircum: "^", underscore: "_", grave: "`", quoteleft: "‘", braceleft: "{", bar: "|", braceright: "}", asciitilde: "~",
  exclamdown: "¡", cent: "¢", sterling: "£", currency: "¤", yen: "¥", brokenbar: "¦", section: "§", dieresis: "¨", copyright: "©", ordfeminine: "ª", guillemotleft: "«", logicalnot: "¬", registered: "®", macron: "¯", degree: "°", plusminus: "±", twosuperior: "²", threesuperior: "³", acute: "´", mu: "µ", paragraph: "¶", periodcentered: "·", cedilla: "¸", onesuperior: "¹", ordmasculine: "º", guillemotright: "»", onequarter: "¼", onehalf: "½", threequarters: "¾", questiondown: "¿",
  Agrave: "À", Aacute: "Á", Acircumflex: "Â", Atilde: "Ã", Adieresis: "Ä", Aring: "Å", AE: "Æ", Ccedilla: "Ç", Egrave: "È", Eacute: "É", Ecircumflex: "Ê", Edieresis: "Ë", Igrave: "Ì", Iacute: "Í", Icircumflex: "Î", Idieresis: "Ï", Eth: "Ð", Ntilde: "Ñ", Ograve: "Ò", Oacute: "Ó", Ocircumflex: "Ô", Otilde: "Õ", Odieresis: "Ö", multiply: "×", Oslash: "Ø", Ugrave: "Ù", Uacute: "Ú", Ucircumflex: "Û", Udieresis: "Ü", Yacute: "Ý", Thorn: "Þ", germandbls: "ß",
  agrave: "à", aacute: "á", acircumflex: "â", atilde: "ã", adieresis: "ä", aring: "å", ae: "æ", ccedilla: "ç", egrave: "è", eacute: "é", ecircumflex: "ê", edieresis: "ë", igrave: "ì", iacute: "í", icircumflex: "î", idieresis: "ï", eth: "ð", ntilde: "ñ", ograve: "ò", oacute: "ó", ocircumflex: "ô", otilde: "õ", odieresis: "ö", divide: "÷", oslash: "ø", ugrave: "ù", uacute: "ú", ucircumflex: "û", udieresis: "ü", yacute: "ý", thorn: "þ", ydieresis: "ÿ",
  Euro: "€", quotesinglbase: "‚", florin: "ƒ", quotedblbase: "„", ellipsis: "…", dagger: "†", daggerdbl: "‡", circumflex: "ˆ", perthousand: "‰", Scaron: "Š", guilsinglleft: "‹", OE: "Œ", Zcaron: "Ž", quotedblleft: "“", quotedblright: "”", bullet: "•", endash: "–", emdash: "—", tilde: "˜", trademark: "™", scaron: "š", guilsinglright: "›", oe: "œ", zcaron: "ž", Ydieresis: "Ÿ",
  fi: "ﬁ", fl: "ﬂ", ff: "ﬀ", ffi: "ﬃ", ffl: "ﬄ", dotlessi: "ı", Lslash: "Ł", lslash: "ł", fraction: "⁄", caron: "ˇ", breve: "˘", dotaccent: "˙", ring: "˚", ogonek: "˛", hungarumlaut: "˝", nbspace: " ", sfthyphen: "­", softhyphen: "­", apple: "", notequal: "≠", infinity: "∞", lessequal: "≤", greaterequal: "≥", partialdiff: "∂", summation: "∑", product: "∏", pi: "π", integral: "∫", Omega: "Ω", radical: "√", approxequal: "≈", Delta: "∆", lozenge: "◊", dotmath: "⋅", middot: "·",
};

/** The character a glyph name stands for, or null when it is not known. */
export function glyphToUnicode(name: string | undefined | null): string | null {
  if (!name) return null;
  if (name.length === 1) return name;
  const hit = NAMES[name];
  if (hit !== undefined) return hit || null;
  const uni = /^uni([0-9A-Fa-f]{4,6})/.exec(name);
  if (uni) return String.fromCodePoint(parseInt(uni[1].slice(0, 4), 16));
  const u = /^u([0-9A-Fa-f]{4,6})$/.exec(name);
  if (u) return String.fromCodePoint(parseInt(u[1], 16));
  const g = /^g?(\d+)$/.exec(name);
  if (g) return null;
  // Names like "a.sc" or "one.oldstyle": the base glyph.
  const dot = name.indexOf(".");
  if (dot > 0) return glyphToUnicode(name.slice(0, dot));
  return null;
}
