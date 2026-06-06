import type { WalletAvailableBackup } from "@shared/schemas/wallets.js";

export function backupCardLabel(backup: WalletAvailableBackup): string {
  const date = new Date(backup.timestamp);
  // Force en-US so the backup timestamp reads in English regardless of OS
  // locale (display-only; does not affect restore parsing or storage).
  const when = Number.isNaN(date.getTime())
    ? backup.timestamp
    : date.toLocaleString("en-US");
  const count =
    backup.walletCount === 1 ? "1 wallet" : `${backup.walletCount} wallets`;
  return `Backup from ${when}, ${count}`;
}
