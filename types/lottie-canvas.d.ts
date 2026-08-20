// The canvas-only lottie-web build ships without its own .d.ts — it has the
// same API surface as the main entry.
declare module "lottie-web/build/player/lottie_canvas" {
  import lottie from "lottie-web";
  export * from "lottie-web";
  export default lottie;
}
