import type { Metadata } from "next";
import { Suspense } from "react";
import { BistroApp } from "./bistro-app";
import "./bistro.css";
export const metadata: Metadata = {
  title: { absolute: "My Bistro · Your bread-making companion" },
  description:
    "An independent, source-linked personal companion for the Panasonic Bistro SD-MDX4. Recipes, guided baking and care.",
  alternates: { canonical: "/bistro" },
};
export default function BistroPage() {
  return (
    <Suspense
      fallback={<main className="bistro-loading">Opening My Bistro…</main>}
    >
      <BistroApp />
    </Suspense>
  );
}
