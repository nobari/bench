/**
 * Loan / mortgage amortization math.
 *
 * Pure & deterministic — given the same inputs it always returns the same
 * schedule, which is what makes results shareable via the URL. SSR-safe: no
 * `window`/`document`/`Date`/`Math.random` at module scope or in the functions.
 *
 * Supports several repayment structures, all defaulting to a standard
 * equal-payment (annuity) amortizing loan so existing results are unchanged.
 */

export type RepaymentType = "annuity" | "equal-principal" | "interest-only";

export interface AmortizationRow {
  /** 1-based payment number. */
  month: number;
  /** Total payment made this month. */
  payment: number;
  /** Portion of this payment applied to principal. */
  principal: number;
  /** Portion of this payment applied to interest. */
  interest: number;
  /** Remaining balance after this payment. */
  balance: number;
}

export interface LoanResult {
  /** Representative scheduled payment: the level annuity payment, or the first
   *  scheduled payment for varying-payment structures. */
  monthlyPayment: number;
  /** First scheduled payment. */
  firstPayment: number;
  /** Final scheduled payment (includes any balloon principal). */
  finalPayment: number;
  /** True when the payment is not constant for the whole term. */
  paymentVaries: boolean;
  /** Sum of every payment actually made over the life of the loan. */
  totalPaid: number;
  /** Total interest paid over the life of the loan. */
  totalInterest: number;
  /** Per-month amortization schedule. */
  schedule: AmortizationRow[];
  /** Number of months until the loan is fully paid off (schedule length). */
  payoffMonths: number;
}

export interface LoanInput {
  /** Amount borrowed (loan principal), in currency units. */
  principal: number;
  /** Annual nominal interest rate, as a percent (e.g. 6.5). */
  annualRatePercent: number;
  /** Number of scheduled monthly payments (e.g. 30 years = 360). */
  termMonths: number;
  /** Optional extra amount paid toward principal every month. */
  extraMonthly?: number;
  /** Repayment structure (default "annuity"). */
  repayment?: RepaymentType;
  /** For the annuity type: pay interest only for the first N months, then
   *  amortize the remaining principal over the rest of the term. Default 0. */
  interestOnlyMonths?: number;
}

const EPS = 1e-7;

/**
 * Compute a loan schedule. Accepts the positional legacy signature (always a
 * standard annuity) or a single options object with the richer controls.
 */
export function computeLoan(input: LoanInput): LoanResult;
export function computeLoan(
  principal: number,
  annualRatePercent: number,
  termMonths: number,
  extraMonthly?: number,
): LoanResult;
export function computeLoan(
  a: LoanInput | number,
  b?: number,
  c?: number,
  d?: number,
): LoanResult {
  const opts: LoanInput =
    typeof a === "object"
      ? a
      : { principal: a, annualRatePercent: b ?? 0, termMonths: c ?? 0, extraMonthly: d };

  const P = Number.isFinite(opts.principal) && opts.principal > 0 ? opts.principal : 0;
  const n = Number.isFinite(opts.termMonths) && opts.termMonths > 0 ? Math.floor(opts.termMonths) : 0;

  const empty: LoanResult = {
    monthlyPayment: 0, firstPayment: 0, finalPayment: 0, paymentVaries: false,
    totalPaid: 0, totalInterest: 0, schedule: [], payoffMonths: 0,
  };
  if (P === 0 || n === 0) return empty;

  const monthlyRate = (Number.isFinite(opts.annualRatePercent) ? opts.annualRatePercent : 0) / 100 / 12;
  const extra = Number.isFinite(opts.extraMonthly) && (opts.extraMonthly ?? 0) > 0 ? (opts.extraMonthly as number) : 0;
  const type: RepaymentType = opts.repayment ?? "annuity";
  const io = Math.max(0, Math.min(n - 1, Math.floor(opts.interestOnlyMonths ?? 0) || 0));

  // Level annuity payment for the amortizing portion (after any IO period).
  const amortN = Math.max(1, n - io);
  const annuityPayment =
    monthlyRate === 0
      ? P / amortN
      : (P * monthlyRate * Math.pow(1 + monthlyRate, amortN)) / (Math.pow(1 + monthlyRate, amortN) - 1);

  const equalPrincipalPart = P / n;

  const schedule: AmortizationRow[] = [];
  let balance = P;
  let totalInterest = 0;
  let totalPaid = 0;

  for (let month = 1; month <= n && balance > EPS; month++) {
    const interest = balance * monthlyRate;
    let payment: number;
    let principalPart: number;

    if (type === "interest-only") {
      // Interest each month; full principal as a balloon on the final payment.
      principalPart = month === n ? balance : 0;
      payment = interest + principalPart;
    } else if (type === "equal-principal") {
      // Fixed principal each month + interest on the balance (declining payment).
      principalPart = equalPrincipalPart;
      payment = principalPart + interest;
    } else if (month <= io) {
      // Annuity with an initial interest-only ("pay interest first") period.
      principalPart = 0;
      payment = interest;
    } else {
      payment = annuityPayment;
      principalPart = payment - interest;
    }

    // Voluntary extra always goes straight to principal.
    principalPart += extra;
    payment += extra;

    // Settle the exact remaining balance so float drift never leaves a fraction
    // outstanding, and the schedule ends cleanly (also handles balloon overpay).
    if (month === n || principalPart >= balance) {
      principalPart = balance;
      payment = balance + interest;
    }

    balance -= principalPart;
    if (balance < 0) balance = 0;
    totalInterest += interest;
    totalPaid += payment;
    schedule.push({ month, payment, principal: principalPart, interest, balance });
  }

  const firstPayment = schedule[0]?.payment ?? 0;
  const finalPayment = schedule[schedule.length - 1]?.payment ?? 0;
  const monthlyPayment = type === "annuity" && io === 0 ? annuityPayment : firstPayment;
  const paymentVaries = type !== "annuity" || io > 0;

  return {
    monthlyPayment,
    firstPayment,
    finalPayment,
    paymentVaries,
    totalPaid,
    totalInterest,
    schedule,
    payoffMonths: schedule.length,
  };
}
