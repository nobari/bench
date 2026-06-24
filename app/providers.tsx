"use client";

import { NuqsAdapter } from "nuqs/adapters/next/app";
import { CommandPaletteProvider } from "@/components/command-palette";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <NuqsAdapter>
      <CommandPaletteProvider>{children}</CommandPaletteProvider>
    </NuqsAdapter>
  );
}
