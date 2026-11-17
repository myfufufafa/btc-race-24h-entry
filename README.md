# Deep-dip rider — BTC race bot (make.fun `btc-race-24h-20261117-0603`)

A long-only bot trading Coinbase Wrapped BTC (cbBTC) against USDC on
1-minute Orca Whirlpool bars, with $1,000 of paper money. No leverage, no
shorts, no network, no clock, no randomness: every decision is a pure
function of the bars seen so far, so two runs on the same window answer
identically.

## Strategy

Measured on the published dev window (24h, 1,440 bars) with the kit's own
harness — the local simulator I built from the harness source reproduces
the official grades of all six baselines to the micro-USDC, so the numbers
below are the official ones, not estimates.

- 1-minute moves average 4.3 bps; a full round trip costs ~35 bps (4 bps
  fee + 2 bps slippage + pool impact). Fast trend signals (EMA 8/21:
  **-$106.21**) and mean-reversion scalps (-$22..-$60) all bleed to death
  on costs. The window's money sits in a few multi-hour swings (up to
  249 bps from a running low to the next high).
- **Entry:** the close is at least **125 bps below the highest close of the
  last 240 bars** (4h). Buy 100% of cash. At most **4 round trips** per
  window — a risk budget that bounds the whipsaw bleed.
- **Exit (whole position):** value >= cost x 1.015 (take-profit +150 bps),
  or value has fallen **75 bps below its peak** since entry (trailing stop).
  The trailing stop is the crash brake: on a steadily falling window it
  exits near the peak instead of riding the position to the end.
- Every order caps slippage at 100 bps past the close it was decided on.

## Dev-window results (official local grade)

| Bot | Net PnL | Trades | Max DD |
| --- | --- | --- | --- |
| This bot | **+$13.78** | 8 | 1.5% |
| buy-and-hold (house) | +$1.07 | 1 | 2.1% |
| momentum (house) | +$2.45 | 1 | 2.1% |
| ema-cross (house) | -$106.21 | 68 | 11.0% |
| rsi-bollinger | -$24.25 | 11 | 2.8% |
| adx-momentum | -$32.66 | 26 | 3.6% |

Robustness checks (same code, no re-tuning): first 12h +$10.09, second
12h -$1.38, time-reversed window -$5.34 — losses stay bounded everywhere,
gains come from catching a real swing, not from one lucky trade. Parameter
plateau: dip 115–130 bps, take-profit 140–160 bps, trailing 75–85 bps all
grade +$10…+$15 on the dev window; the chosen point sits in the middle of
it, not on a peak.

## Honest limits

- The dev window is one 24h sample. The race window is unseen: if BTC
  falls all day, this bot exits on its trailing stop and ends down roughly
  the stop distance plus costs; if BTC rises without a 125 bps dip first,
  it buys late (or not at all until a dip comes) and underperforms
  buy-and-hold. The dev gate (+$13.78 > $0) is passed with margin.
- Live dev board (17 Nov ~13:30 WIB) already shows 5 entries; the leader
  is at +$19.70. This bot would sit 2nd on that board.

## Files

- `main.ts` — the bot (TypeScript, Node 22 type stripping, stdlib only).
- `vendor/makefun-bars.ts` — byte-identical copy of the kit's SDK shim.
- `LICENSE` — MIT.

## Grade locally

From the unpacked kit directory:

```
node cli/makefun.mjs grade-local --kit . --bot <path-to-this-repo> --driver process
```

The bot runs twice; the two action logs must match byte for byte.
