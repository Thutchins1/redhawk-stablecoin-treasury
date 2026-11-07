# Stablecoin Treasury Risk Monitor

Redhawk Builds 2026, Miami University. Challenge 28: *Stablecoin treasury risk monitor. Track peg deviation, concentration and rebalance alerts.*

A one-page dashboard for a finance team that keeps part of its operating cash in stablecoins (USDC, USDT, DAI). It scores how far each coin is from $1.00, how much of the money depends on one issuer, and replays real past depegs (March 2023 USDC, May 2022 Terra) against the team's own rebalance policy to show whether that policy would have helped or hurt.

## Run it

Needs Node.js 22 or newer.

```
npm ci
npm test        # 29 tests, including the three acceptance checks
npm run dev     # then open http://127.0.0.1:4180/
```

The app is local-only by design. No accounts, no keys, no network calls at runtime.

## What is real and what is mocked

| Item | Status |
|---|---|
| Stablecoin prices (current snapshot and the 2023 / 2022 daily series) | Real. Retrieved from CoinGecko through its official MCP connector and cached in `data/stablecoin_prices.json` with source and retrieval date. |
| The $250,000 treasury and its holdings | Fictional fixture, labelled `"synthetic": true` in `data/stablecoin_treasury.json`. |
| Policy thresholds (warn 50 bps, act 200 bps, 50% issuer cap, sell 50%) | Team assumptions for the demo. Not regulatory guidance. Editable in the UI. |
| Supabase, Firecrawl, Alpha Vantage, Quartr, Financial Datasets connectors | Connected during setup but not used by this app. |
| Language model inside the app | None. Every figure is computed in `lib/stablecoin.js`. The "Generate summary" text is a deterministic template. |

## Where the work lives

- `lib/stablecoin.js`: the engine (peg deviation in basis points, Herfindahl concentration, alerts, depeg replay, narrative).
- `server.js`: routes `/api/treasury`, `/api/scenarios`, `/api/treasury/replay`, `/api/treasury/explain`, and the page.
- `public/index.html`: the dashboard.
- `tests/stablecoin.test.js`: 11 tests for this challenge on top of the 18 from the starter pack.
- `data/`: the fixture and cached prices.
- `context/team-brief.txt`: user, pain point, scope, acceptance criteria, demo procedure.

Everything else is the organizers' starter pack v1.2, unchanged.

## AI use disclosure

The code, tests and this README were written with Claude Code (Anthropic), directed by the team: picking the challenge and MVP, the replay idea, the policy rules, and testing the thresholds. The starter pack explicitly expects a coding assistant. The app itself contains no AI.

## Timeline disclosure

Work began Friday evening, November 6, after the workshops, in an earlier repository. The event rules ask that the submission repository be created after Saturday, November 7 at 10:00 AM ET, so this repository was created on Saturday afternoon and the full commit history was pushed here unchanged, Friday timestamps included. The earlier repository was made private. Organizers were told.

## Limitations

- Six daily price points per scenario. Intraday lows in March 2023 were worse than the daily snapshots.
- The policy executes at the snapshot price with no fees, slippage or settlement delay.
- Thresholds are assumptions. Not a compliance or production tool.
- Holdings are fictional. Prices are real but cached, not live.

## Credits

Prices: CoinGecko (free public API via the official MCP connector). Starter pack: Redhawk Builds 2026 organizers (SEPi, Miami Banking Club, RedHawk Applied AI). Challenge statement: Sam Yeh.
