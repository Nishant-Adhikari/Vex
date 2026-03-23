# Polymarket Analytics Reference

Track any user's positions, activity, PnL. Leaderboard, holders, open interest. All public, no auth.

## Track any user

```bash
# Profile
echoclaw polymarket profile <address> --json

# Positions with PnL
echoclaw polymarket positions --user <address> --json

# Activity (trades, splits, merges, redeems)
echoclaw polymarket activity --user <address> [--type TRADE] [--side BUY] --json

# Portfolio value
echoclaw polymarket value --user <address> --json  # Not yet CLI — available via Data API
```

## Own portfolio

```bash
echoclaw polymarket positions --json
echoclaw polymarket activity --json
echoclaw polymarket orders --json
```

## Leaderboard

```bash
echoclaw polymarket leaderboard [--category POLITICS|SPORTS|CRYPTO|CULTURE|ECONOMICS|TECH] [--period DAY|WEEK|MONTH|ALL] [--orderBy PNL|VOL] --json
```

Categories: OVERALL, POLITICS, SPORTS, CRYPTO, CULTURE, MENTIONS, WEATHER, ECONOMICS, TECH, FINANCE.

## Market analytics

```bash
# Top holders for a market
echoclaw polymarket holders <condition-id> --json  # Not yet CLI — available via Data API

# Open interest
echoclaw polymarket open-interest --market <condition-id> --json  # Available via Data API
```
