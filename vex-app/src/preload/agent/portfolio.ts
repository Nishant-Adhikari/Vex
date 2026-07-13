import { CH } from "../../shared/ipc/channels.js";
import {
  portfolioReadInputSchema,
  portfolioSeriesInputSchema,
} from "../../shared/schemas/portfolio.js";
import type {
  PortfolioReadInput,
  PortfolioSeriesInput,
} from "../../shared/schemas/portfolio.js";
import { movesReadInputSchema } from "../../shared/schemas/portfolio-moves.js";
import type { MovesReadInput } from "../../shared/schemas/portfolio-moves.js";
import type { PortfolioBridge } from "../../shared/types/bridge/agent/portfolio.js";
import { invokeWithSchema } from "../_dispatch.js";

export const portfolio = {
  read(input: PortfolioReadInput) {
    return invokeWithSchema(CH.portfolio.read, input, portfolioReadInputSchema);
  },
  series(input: PortfolioSeriesInput) {
    return invokeWithSchema(
      CH.portfolio.series,
      input,
      portfolioSeriesInputSchema,
    );
  },
  listMoves(input: MovesReadInput) {
    return invokeWithSchema(CH.portfolio.listMoves, input, movesReadInputSchema);
  },
} satisfies PortfolioBridge;
