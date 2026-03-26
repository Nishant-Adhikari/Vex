import { Command } from "commander";
import { getDexScreenerClient } from "../../tools/dexscreener/client.js";
import { isHeadless, writeJsonSuccess } from "../../utils/output.js";
import { printTable, colors } from "../../utils/ui.js";
import type { TableColumn } from "../../utils/ui.js";

const PROFILE_COLUMNS: TableColumn[] = [
  { header: "Token", width: 16 },
  { header: "Chain", width: 12 },
  { header: "Address", width: 20 },
  { header: "Description", width: 40 },
];

export function createProfilesSubcommand(): Command {
  return new Command("profiles")
    .description("Get latest trending token profiles")
    .action(async () => {
      const client = getDexScreenerClient();
      const profiles = await client.getProfiles();

      if (isHeadless()) {
        writeJsonSuccess({ profiles, count: profiles.length });
        return;
      }

      if (profiles.length === 0) {
        process.stderr.write("No token profiles found\n");
        return;
      }

      process.stderr.write(colors.info(`Latest ${profiles.length} token profiles\n\n`));

      const rows = profiles.slice(0, 30).map(p => [
        p.tokenAddress.slice(0, 14) + "...",
        p.chainId,
        p.tokenAddress.slice(0, 18) + "...",
        (p.description ?? "-").slice(0, 38),
      ]);

      printTable(PROFILE_COLUMNS, rows);
    });
}
