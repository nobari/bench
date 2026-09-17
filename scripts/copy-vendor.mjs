// Self-host third-party WASM/worker binaries: these packages load their
// binaries from a CDN or relative to the bundle by default, but Bench serves
// everything from its own origin. Runs on postinstall; widgets point at
// /vendor/... URLs. public/vendor/ is gitignored — this script is its source.
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

/** [source (in node_modules), destination (in public/vendor)] */
const FILES = [
  // ZXing barcode/QR decoder — widget sets locateFile to /vendor/zxing_reader.wasm
  ["zxing-wasm/dist/reader/zxing_reader.wasm", "zxing_reader.wasm"],
  // libarchive (CBZ/CBR/7z/TAR extraction) — the worker resolves libarchive.wasm
  // relative to its own URL, so both files must live in the same directory.
  ["libarchive.js/dist/worker-bundle.js", "libarchive/worker-bundle.js"],
  ["libarchive.js/dist/libarchive.wasm", "libarchive/libarchive.wasm"],
  // c2pa-web (Content Credentials reader/signer) — the widget passes wasmSrc: /vendor/c2pa/c2pa_bg.wasm
  ["@contentauth/c2pa-web/dist/resources/c2pa_bg.wasm", "c2pa/c2pa_bg.wasm"],
];

for (const [from, to] of FILES) {
  const src = join(root, "node_modules", from);
  const dest = join(root, "public/vendor", to);
  if (!existsSync(src)) {
    console.error(`copy-vendor: ${from} not found — run pnpm install first`);
    process.exit(1);
  }
  mkdirSync(dirname(dest), { recursive: true });
  copyFileSync(src, dest);
  console.log(`copy-vendor: ${from} -> public/vendor/${to}`);
}
