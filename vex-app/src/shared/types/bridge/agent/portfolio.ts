import type { Result } from "../../../ipc/result.js";
import type {
  PortfolioDto,
  PortfolioReadInput,
  PortfolioSeriesDto,
  PortfolioSeriesInput,
} from "../../../schemas/portfolio.js";
import type {
  MovesDto,
  MovesReadInput,
} from "../../../schemas/portfolio-moves.js";

/**
 * Portfolio — read-only wallet-scoped reads (stage 3 + move 0.3).
 *
 * `read` resolves a server-side wallet address allow-list (the configured
 * inventory for `{ scope: "global" }`, or the session's wallet scope for
 * `{ scope: "session", sessionId }`) and aggregates `proj_balances` +
 * `proj_portfolio_snapshots` into a renderer-safe DTO. An empty allow-list
 * resolves to the empty portfolio DTO, never an error.
 *
 * `listMoves` resolves the session's wallet scope and reads its executed-trade
 * activity from `proj_activity` (the MOVES feed — real swaps, success-only by
 * construction). An empty scope resolves to the empty array, never an error.
 *
 * The renderer never supplies a wallet address.
 */
export interface PortfolioBridge {
  readonly read: (input: PortfolioReadInput) => Promise<Result<PortfolioDto>>;
  readonly series: (
    input: PortfolioSeriesInput,
  ) => Promise<Result<PortfolioSeriesDto>>;
  readonly listMoves: (input: MovesReadInput) => Promise<Result<MovesDto>>;
}
