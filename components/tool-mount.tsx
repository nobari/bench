"use client";

import dynamic from "next/dynamic";
import type { WidgetKey } from "@/lib/tools/types";

function Skeleton() {
  return (
    <div className="panel animate-pulse p-6">
      <div className="h-5 w-40 rounded bg-raised" />
      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        <div className="h-48 rounded bg-raised" />
        <div className="h-48 rounded bg-raised" />
      </div>
    </div>
  );
}

const WIDGETS: Record<WidgetKey, React.ComponentType<Record<string, unknown>>> = {
  "text-transform": dynamic(
    () => import("@/components/widgets/text-transform").then((m) => m.TextTransformWidget),
    { ssr: false, loading: Skeleton },
  ),
  "finglish-converter": dynamic(
    () => import("@/components/widgets/finglish-converter").then((m) => m.FinglishConverterWidget),
    { ssr: false, loading: Skeleton },
  ),
  "romaji-converter": dynamic(
    () => import("@/components/widgets/romaji-converter").then((m) => m.RomajiConverterWidget),
    { ssr: false, loading: Skeleton },
  ),
  "short-url": dynamic(
    () => import("@/components/widgets/short-url").then((m) => m.ShortUrlWidget),
    { ssr: false, loading: Skeleton },
  ),
  "json-viewer": dynamic(
    () => import("@/components/widgets/json-viewer").then((m) => m.JsonViewerWidget),
    { ssr: false, loading: Skeleton },
  ),
  "json-schema": dynamic(
    () => import("@/components/widgets/json-schema").then((m) => m.JsonSchemaWidget),
    { ssr: false, loading: Skeleton },
  ),
  "gif-maker": dynamic(
    () => import("@/components/widgets/gif-maker").then((m) => m.GifMakerWidget),
    { ssr: false, loading: Skeleton },
  ),
  "hash-generator": dynamic(
    () => import("@/components/widgets/hash-generator").then((m) => m.HashGeneratorWidget),
    { ssr: false, loading: Skeleton },
  ),
  "id-generator": dynamic(
    () => import("@/components/widgets/id-generator").then((m) => m.IdGeneratorWidget),
    { ssr: false, loading: Skeleton },
  ),
  "timestamp-converter": dynamic(
    () => import("@/components/widgets/timestamp-converter").then((m) => m.TimestampConverterWidget),
    { ssr: false, loading: Skeleton },
  ),
  "color-converter": dynamic(
    () => import("@/components/widgets/color-converter").then((m) => m.ColorConverterWidget),
    { ssr: false, loading: Skeleton },
  ),
  "image-converter": dynamic(
    () => import("@/components/widgets/image-converter").then((m) => m.ImageConverterWidget),
    { ssr: false, loading: Skeleton },
  ),
  "slow-mo": dynamic(
    () => import("@/components/widgets/slow-mo").then((m) => m.SlowMoWidget),
    { ssr: false, loading: Skeleton },
  ),
  "diff-checker": dynamic(
    () => import("@/components/widgets/diff-checker").then((m) => m.DiffCheckerWidget),
    { ssr: false, loading: Skeleton },
  ),
  "regex-tester": dynamic(
    () => import("@/components/widgets/regex-tester").then((m) => m.RegexTesterWidget),
    { ssr: false, loading: Skeleton },
  ),
  jwt: dynamic(
    () => import("@/components/widgets/jwt").then((m) => m.JwtWidget),
    { ssr: false, loading: Skeleton },
  ),
  "qr-code": dynamic(
    () => import("@/components/widgets/qr-code").then((m) => m.QrCodeWidget),
    { ssr: false, loading: Skeleton },
  ),
  "qr-scanner": dynamic(
    () => import("@/components/widgets/qr-scanner").then((m) => m.QrScannerWidget),
    { ssr: false, loading: Skeleton },
  ),
  "comic-reader": dynamic(
    () => import("@/components/widgets/comic-reader").then((m) => m.ComicReaderWidget),
    { ssr: false, loading: Skeleton },
  ),
  "tgs-studio": dynamic(
    () => import("@/components/widgets/tgs-studio").then((m) => m.TgsStudioWidget),
    { ssr: false, loading: Skeleton },
  ),
  "text-compress": dynamic(
    () => import("@/components/widgets/text-compress").then((m) => m.TextCompressWidget),
    { ssr: false, loading: Skeleton },
  ),
  "archive-extract": dynamic(
    () => import("@/components/widgets/archive-tool").then((m) => m.ArchiveExtractWidget),
    { ssr: false, loading: Skeleton },
  ),
  "archive-create": dynamic(
    () => import("@/components/widgets/archive-tool").then((m) => m.ArchiveCreateWidget),
    { ssr: false, loading: Skeleton },
  ),
  "date-converter": dynamic(
    () => import("@/components/widgets/date-converter").then((m) => m.DateConverterWidget),
    { ssr: false, loading: Skeleton },
  ),
  "day-calculator": dynamic(
    () => import("@/components/widgets/day-calculator").then((m) => m.DayCalculatorWidget),
    { ssr: false, loading: Skeleton },
  ),
  "password-generator": dynamic(
    () => import("@/components/widgets/password-generator").then((m) => m.PasswordGeneratorWidget),
    { ssr: false, loading: Skeleton },
  ),
  ecdsa: dynamic(
    () => import("@/components/widgets/ecdsa").then((m) => m.EcdsaWidget),
    { ssr: false, loading: Skeleton },
  ),
  "loan-simulator": dynamic(
    () => import("@/components/widgets/loan-simulator").then((m) => m.LoanSimulatorWidget),
    { ssr: false, loading: Skeleton },
  ),
  "lucky-draw": dynamic(
    () => import("@/components/widgets/lucky-draw").then((m) => m.LuckyDrawWidget),
    { ssr: false, loading: Skeleton },
  ),
  "random-generator": dynamic(
    () => import("@/components/widgets/random-generator").then((m) => m.RandomGeneratorWidget),
    { ssr: false, loading: Skeleton },
  ),
  "base-converter": dynamic(
    () => import("@/components/widgets/base-converter").then((m) => m.BaseConverterWidget),
    { ssr: false, loading: Skeleton },
  ),
  "unit-converter": dynamic(
    () => import("@/components/widgets/unit-converter").then((m) => m.UnitConverterWidget),
    { ssr: false, loading: Skeleton },
  ),
  "ascii-generator": dynamic(
    () => import("@/components/widgets/ascii-generator").then((m) => m.AsciiGeneratorWidget),
    { ssr: false, loading: Skeleton },
  ),
  "wallet-generator": dynamic(
    () => import("@/components/widgets/wallet-generator").then((m) => m.WalletGeneratorWidget),
    { ssr: false, loading: Skeleton },
  ),
};

export function ToolMount({
  widget,
  widgetProps,
}: {
  widget: WidgetKey;
  widgetProps?: Record<string, unknown>;
}) {
  const Widget = WIDGETS[widget];
  return <Widget {...(widgetProps ?? {})} />;
}
