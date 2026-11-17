// SMA-dip rider for btc-race-24h-20261117-0603: a long-only cbBTC/USDC bot
// trading 1-minute Orca Whirlpool bars, $1,000 paper, no leverage, no shorts.
//
// v2 (rebuild of the submitted "Deep-dip rider", commit f0f0cee8, dev +$13.78).
// The v1 family was beaten on every robustness check by an SMA-anchored
// dip strategy, measured on the kit's own harness via a validated local
// simulator (sim.py reproduces the official grades of all six baselines to
// the micro-USDC, and grade-local reproduced v1 byte for byte):
//   - Entry: close >= 75 bps below the SMA of the last 90 closes
//     (including the current close). The SMA anchor enters a real dip
//     earlier than a 240-bar rolling high, which only fires after the
//     move is mostly over.
//   - Exit: value >= cost * 1.018 (take-profit +180 bps) or value <=
//     cost * 0.99 (hard stop -100 bps from cost, not trailing). TP 150
//     exited too early and wasted round trips; the hard stop bounds the
//     loss on a window that never comes back.
//   - No round-trip cap: the window gives 5 trades at this setting.
//   - Dev window: +$36.63 (5 trades, max drawdown 0.7%, fees $2.46) vs
//     v1 +$13.78. Robustness, same parameters, no re-tuning: first 12h
//     +$23.89, second 12h +$1.39, time-reversed window +$0.22, 2x fees
//     +$32.91. Neighbours are strong too (dip80 TP185 +$36.29, dip85
//     +$33.54): this is a plateau, not a sharp peak.
//   - Deliberately NOT dip80/TP180/SL100 (dev +$35.48): that parameter
//     point is entry #13 on the dev board, and an identical PnL risks a
//     byte-identical action log ("identical behaviour", no prize). dip75
//     grades a different PnL, so its action log differs.
//
// Rules (all integer arithmetic on quote units, no floats, no clock, no
// randomness, no network: two runs on the same bars answer identically):
//   - Reference: the sum of the last 90 closes (89 prior bars plus the
//     current close). Entry, flat only, once at least 90 closes exist:
//     (sum - 90 * close) * 10000 >= 75 * sum. Buy 100% of cash.
//   - Exit, whole position: value >= floor(cost * 10180 / 10000), or
//     value <= floor(cost * 9900 / 10000).
//   - Every order caps slippage at MAX_SLIPPAGE_BPS past the close it was
//     decided on, so a fill into a gap is refused rather than filled badly.

import { BPS, runBars, type BarsState, type BuyInput, type SellInput } from "./vendor/makefun-bars.ts";

const SYMBOL = "CBBTC";
/** Closes in the simple moving average, including the current bar. */
const SMA_SPAN = 90;
/** Entry when the close is this far below the SMA, in bps. */
const DIP_BPS = 75n;
/** Exit when the position is worth this much over its cost, in bps. */
const TAKE_PROFIT_BPS = 180n;
/** Exit when the position is worth this much under its cost, in bps. */
const STOP_LOSS_BPS = 100n;
/** Slippage cap on every order, past the close it was decided on, in bps. */
const MAX_SLIPPAGE_BPS = 100;

/** Closes seen so far, oldest first; the current bar is appended after deciding. */
const closes: bigint[] = [];

/**
 * True when the current close sits at least DIP_BPS below the SMA of the
 * last SMA_SPAN closes (the current close plus the SMA_SPAN - 1 closes
 * before it). Exact integer form of (sma - close) / sma >= DIP_BPS / BPS
 * with sma = sum / SMA_SPAN: (sum - SPAN * close) * BPS >= DIP_BPS * sum.
 * Requires at least SMA_SPAN prior closes, matching the simulator's
 * seq >= span gate (the SMA first exists at seq span - 1, entry opens
 * one bar later).
 */
function isDip(close: bigint): boolean {
  if (closes.length < SMA_SPAN) return false;
  let sum = close;
  for (let i = closes.length - (SMA_SPAN - 1); i < closes.length; i++) {
    sum += closes[i];
  }
  return (sum - BigInt(SMA_SPAN) * close) * BPS >= DIP_BPS * sum;
}

await runBars({
  onBatch(state: BarsState) {
    const bar = state.latest.get(SYMBOL);
    if (bar === undefined) return [];
    const close = BigInt(bar.c);

    if (state.warmingUp) {
      closes.push(close);
      return [];
    }

    const held = state.positions.get(SYMBOL);
    const orders: Array<BuyInput | SellInput> = [];

    if (held !== undefined) {
      const value = state.value(SYMBOL, held.qty);
      const takeProfit = value >= (held.cost * (BPS + TAKE_PROFIT_BPS)) / BPS;
      const stopLoss = value <= (held.cost * (BPS - STOP_LOSS_BPS)) / BPS;
      if (takeProfit || stopLoss) {
        orders.push({ side: "sell", symbol: SYMBOL, qty: held.qty, max_slippage_bps: MAX_SLIPPAGE_BPS });
      }
    } else if (isDip(close) && state.cash > 0n) {
      orders.push({ side: "buy", symbol: SYMBOL, notional_quote_units: state.cash, max_slippage_bps: MAX_SLIPPAGE_BPS });
    }

    closes.push(close);
    return orders;
  },
});
