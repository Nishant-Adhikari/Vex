# Polymarket Bridge Reference

Deposit/withdraw USDC to/from Polymarket on Polygon. Supports EVM chains, Solana, Bitcoin.

## Supported chains

Ethereum, Polygon, Arbitrum, Base, Solana, Bitcoin. Check with:
```bash
echoclaw polymarket bridge supported-assets --json
```

## Deposit

Get deposit addresses for your Polymarket wallet:
```bash
echoclaw polymarket bridge deposit --json
```
Returns EVM, Solana (SVM), and Bitcoin addresses. Send supported tokens to these addresses.

## Withdraw

```bash
echoclaw polymarket bridge withdraw --chain <chainId> --token <addr> --recipient <addr> --json
```

## Quote

Preview fees before bridging:
```bash
echoclaw polymarket bridge quote --from-chain <id> --from-token <addr> --to-chain <id> --to-token <addr> --amount <base-units> --json
```

## Track status

```bash
echoclaw polymarket bridge status <deposit-or-withdraw-address> --json
```
Statuses: `DEPOSIT_DETECTED` → `PROCESSING` → `ORIGIN_TX_CONFIRMED` → `SUBMITTED` → `COMPLETED`.
