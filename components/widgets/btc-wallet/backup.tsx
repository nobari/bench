"use client";

/** Backup: the phrase behind a tap with a word quiz, the account key, and an encrypted file of every wallet. */
import { useMemo, useState } from "react";
import { Download, Eye, EyeOff, ShieldCheck } from "lucide-react";
import type { WalletRecord } from "@/lib/tools/crypto/btc/store";
import { mnemonicWords } from "@/lib/tools/crypto/btc/keys";
import { cn } from "@/lib/utils";
import { CopyButton } from "@/components/copy-button";
import type { Engine } from "./engine";
import { Btn, Note, Row } from "./ui";

export function BackupPanel({ engine, wallet }: { engine: Engine; wallet: WalletRecord }) {
  const [reveal, setReveal] = useState(false);
  const [quiz, setQuiz] = useState<number[] | null>(null);
  const [answers, setAnswers] = useState<string[]>(["", "", ""]);
  const [passed, setPassed] = useState(false);
  const mnemonic = engine.hasSecrets(wallet.id) ? engine.mnemonicOf(wallet.id) : null;
  const words = useMemo(() => (mnemonic ? mnemonicWords(mnemonic) : []), [mnemonic]);

  const startQuiz = () => {
    const idx = new Set<number>();
    const r = globalThis.crypto.getRandomValues(new Uint32Array(8));
    let i = 0;
    while (idx.size < 3 && i < 8) idx.add(r[i++] % words.length);
    setQuiz([...idx].sort((a, b) => a - b));
    setAnswers(["", "", ""]);
    setPassed(false);
  };
  const check = () => quiz && quiz.every((w, i) => answers[i].trim().toLowerCase() === words[w]);

  return (
    <div className="space-y-4" data-backup-panel>
      {wallet.kind === "hd" && (
        <section>
          <div className="mb-1 flex items-center justify-between">
            <span className="readout">Recovery phrase · {words.length || "?"} words</span>
            {mnemonic && (
              <Btn className="h-7 px-2" onClick={() => setReveal((r) => !r)} data-reveal-phrase>
                {reveal ? <EyeOff size={12} /> : <Eye size={12} />} {reveal ? "Hide" : "Reveal"}
              </Btn>
            )}
          </div>
          {!mnemonic ? (
            <Note tone="warn">The phrase is not available: the vault is locked.</Note>
          ) : (
            <>
              <ol className={cn("grid grid-cols-3 gap-1.5 rounded-[var(--radius)] border border-edge p-3 sm:grid-cols-4", !reveal && "select-none blur-[6px]")} aria-hidden={!reveal} data-phrase-grid>
                {words.map((w, i) => (
                  <li key={i} className="flex items-baseline gap-1.5 font-mono text-[12.5px]">
                    <span className="w-5 text-right text-[10px] text-faint">{i + 1}</span>
                    <span className="text-ink" data-word={reveal ? w : undefined}>{reveal ? w : "••••••"}</span>
                  </li>
                ))}
              </ol>
              {reveal && (
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <CopyButton value={mnemonic} label="Copy phrase" />
                  <Btn onClick={startQuiz} data-start-quiz>
                    <ShieldCheck size={12} /> Check my backup
                  </Btn>
                  <span className="text-[11.5px] text-faint">Write it on paper. Anyone with these words owns the coins; nobody can restore them for you.</span>
                </div>
              )}
              {quiz && (
                <div className="mt-3 rounded-[var(--radius)] border border-edge p-3" data-quiz>
                  <div className="readout mb-2">Type words {quiz.map((q) => q + 1).join(", ")} from your written copy</div>
                  <div className="grid gap-2 sm:grid-cols-3">
                    {quiz.map((q, i) => (
                      <label key={q} className="block">
                        <span className="font-mono text-[11px] text-faint">word {q + 1}</span>
                        <input className="input h-8" value={answers[i]} onChange={(e) => setAnswers((a) => a.map((x, j) => (j === i ? e.target.value : x)))} autoComplete="off" spellCheck={false} data-quiz-input={i} />
                      </label>
                    ))}
                  </div>
                  <div className="mt-2 flex items-center gap-2">
                    <Btn tone="primary" className="h-7" onClick={() => setPassed(!!check())} data-quiz-check>
                      Check
                    </Btn>
                    {passed && <span className="text-[12px] text-positive" data-quiz-pass>Backup verified.</span>}
                    {!passed && answers.some(Boolean) && check() === false && <span className="text-[12px] text-danger" data-quiz-fail>Not quite — compare against your paper copy.</span>}
                  </div>
                </div>
              )}
            </>
          )}
        </section>
      )}
      <section>
        <div className="readout mb-1">Account</div>
        <div className="rounded-[var(--radius)] border border-edge px-3">
          <Row k="Derivation path" v={wallet.path || "—"} />
          {wallet.fingerprint && <Row k="Seed fingerprint" v={wallet.fingerprint} />}
          {wallet.xpub && (
            <Row
              k="Account public key"
              v={
                <span className="inline-flex items-center gap-1.5">
                  <span className="break-all text-[11px]">{wallet.xpub}</span>
                  <CopyButton value={wallet.xpub} label="" className="h-6 px-1.5" />
                </span>
              }
            />
          )}
          {wallet.address && <Row k="Watched address" v={wallet.address} />}
        </div>
        <p className="mt-1 text-[11.5px] text-faint">The account public key reveals every address and balance of this wallet, but cannot spend. Paste it into another Bench tab as a watch-only wallet.</p>
      </section>
      <section>
        <div className="readout mb-1">Backup file</div>
        <div className="flex flex-wrap items-center gap-2">
          <Btn
            tone="primary"
            data-export-backup
            onClick={async () => {
              const text = await engine.exportBackup();
              const blob = new Blob([text], { type: "application/json" });
              const a = document.createElement("a");
              a.href = URL.createObjectURL(blob);
              a.download = `bench-btc-wallets-${engine.network}-${new Date().toISOString().slice(0, 10)}.json`;
              a.click();
              setTimeout(() => URL.revokeObjectURL(a.href), 1000);
            }}
          >
            <Download size={13} /> Export all {engine.network} wallets
          </Btn>
          <span className="text-[11.5px] text-faint">
            {engine.mode === "password" ? "Encrypted with your vault password." : "Not encrypted — your vault has no password. Treat the file like cash."}
          </span>
        </div>
      </section>
    </div>
  );
}
