// Deep-dip rider for btc-race-24h-20261117-0603: a long-only cbBTC/USDC bot
// trading 1-minute Orca Whirlpool bars, $1,000 paper, no leverage, no shorts.
//
// What the dev window (24h, 1,440 bars) taught, measured on the kit's own
// harness (local grade of every baseline reproduced byte for byte):
//   - 1-minute moves average 4.3 bps; a full round trip costs ~35 bps in fee,
//     slippage and pool impact. Fast trend signals (EMA 8/21: -$106) and
//     mean-reversion scalps (-$22..-$60) all bleed to death on costs.
//   - The window's money sits in a few multi-hour swings (up to 249 bps from
//     a running low to the next high). The only winning family is: buy a deep
//     dip, then hold for the swing, with a tight exit.
//   - Buy-and-hold makes +$1.07, the house momentum bot +$2.45. A single
//     dip-buy-and-hold makes +$9.35. This bot adds selective re-entry plus a
//     take-profit and a trailing stop, and grades +$13.78 on the dev window
//     (4 round trips, max drawdown 1.5%).
//
// Rules (all integer arithmetic on quote units, no floats, no clock, no
// randomness, no network: two runs on the same bars answer identically):
//   - Reference: the highest close of the last 240 bars (4 hours).
//   - Entry, flat only: the close is at least DIP_BPS below that high.
//     Buy 100% of cash. At most MAX_ROUND_TRIPS round trips per window.
//   - Exit, whole position: value >= cost * (1 + TAKE_PROFIT_BPS), or value
//     has fallen TRAIL_BPS below its peak since entry (trailing stop).
//   - Every order caps slippage at MAX_SLIPPAGE_BPS past the close it was
//     decided on, so a fill into a gap is refused rather than filled badly.
//
// The trailing stop is the crash brake: on a steadily falling window it
// exits near the peak instead of riding the position to the end, which is
// what keeps the loss bounded when the market never comes back.

import { BPS, runBars, type BarsState, type BuyInput, type SellInput } from "./vendor/makefun-bars.ts";

const SYMBOL = "CBBTC";
/** Bars of history behind the rolling high (4 hours of 1-minute bars). */
const LOOKBACK_BARS = 240;
/** Entry when the close is this far below the rolling high, in bps. */
const DIP_BPS = 125n;
/** Exit when the position is worth this much over its cost, in bps. */
const TAKE_PROFIT_BPS = 150n;
/** Exit when the position has fallen this far below its peak value, in bps. */
const TRAIL_BPS = 75n;
/** Round-trip budget for the window: bounds the whipsaw bleed. */
const MAX_ROUND_TRIPS = 4;
/** Slippage cap on every order, past the close it was decided on, in bps. */
const MAX_SLIPPAGE_BPS = 100;

/** Closes seen so far, oldest first; the current bar is appended after deciding. */
const closes: bigint[] = [];
/** Highest position value since the current entry (0 while flat). */
let peak = 0n;
/** Round trips completed (a sell that empties the position counts one). */
let roundTrips = 0;

/** The highest close of the last LOOKBACK_BARS bars before this one, or null. */
function rollingHigh(): bigint | null {
  if (closes.length === 0) return null;
  let high = closes[closes.length - 1];
  const from = Math.max(0, closes.length - LOOKBACK_BARS);
  for (let i = closes.length - 2; i >= from; i--) {
    if (closes[i] > high) high = closes[i];
  }
  return high;
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

    const high = rollingHigh();
    const held = state.positions.get(SYMBOL);
    const orders: Array<BuyInput | SellInput> = [];

    if (held !== undefined) {
      const value = state.value(SYMBOL, held.qty);
      if (value > peak) peak = value;
      const takeProfit = value * BPS >= held.cost * (BPS + TAKE_PROFIT_BPS);
      const trailing = value * BPS <= peak * (BPS - TRAIL_BPS);
      if (takeProfit || trailing) {
        roundTrips++;
        orders.push({ side: "sell", symbol: SYMBOL, qty: held.qty, max_slippage_bps: MAX_SLIPPAGE_BPS });
      }
    } else if (high !== null && roundTrips < MAX_ROUND_TRIPS) {
      const dip = (high - close) * BPS >= DIP_BPS * high;
      if (dip && state.cash > 0n) {
        peak = 0n;
        orders.push({ side: "buy", symbol: SYMBOL, notional_quote_units: state.cash, max_slippage_bps: MAX_SLIPPAGE_BPS });
      }
    }

    closes.push(close);
    return orders;
  },
});
