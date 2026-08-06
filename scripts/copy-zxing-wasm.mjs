// Self-host the ZXing WASM binary: zxing-wasm loads it from a CDN by default,
// but Bench serves everything from its own origin. Runs on postinstall; the
// widget points locateFile at /vendor/zxing_reader.wasm.
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(root, "node_modules/zxing-wasm/dist/reader/zxing_reader.wasm");
const dest = join(root, "public/vendor/zxing_reader.wasm");

if (!existsSync(src)) {
  console.error("copy-zxing-wasm: source wasm not found — is zxing-wasm installed?");
  process.exit(1);
}
mkdirSync(dirname(dest), { recursive: true });
copyFileSync(src, dest);
console.log("copy-zxing-wasm: copied zxing_reader.wasm -> public/vendor/");
