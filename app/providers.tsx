"use client";

import { NuqsAdapter } from "nuqs/adapters/next/app";
import { CommandPaletteProvider } from "@/components/command-palette";
import { LeaveGuard } from "@/components/leave-guard";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <NuqsAdapter>
      <CommandPaletteProvider>
        <LeaveGuard />
        {children}
      </CommandPaletteProvider>
    </NuqsAdapter>
  );
}
