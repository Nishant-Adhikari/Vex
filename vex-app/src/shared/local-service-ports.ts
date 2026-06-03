/**
 * Default host ports the local Docker stack publishes on the loopback
 * interface. Single source of truth for the three main-process
 * consumers (compose/render, compose/lifecycle, ipc/docker) so the
 * Postgres default is declared ONCE instead of re-hardcoded per file
 * (a prior triple-declaration desync hazard).
 *
 * These are deliberately UNCOMMON FIXED ports in the registered range,
 * chosen to sit BELOW the Windows TCP dynamic/ephemeral range
 * (49152-65535). On Windows with the Docker Desktop WSL2/Hyper-V
 * backend, Hyper-V/WinNAT carves reboot-shifting *excluded* port blocks
 * out of that dynamic range; publishing a host port inside an exclusion
 * fails `docker compose up` with WSAEACCES ("...forbidden by its access
 * permissions", Winsock 10013). Microsoft's guidance (KB 3039044) is to
 * use a port NOT in 49152-65535, so we pick a quiet registered-range
 * value away from common dev ports and 5432.
 *
 * The embeddings runtime default (`DEFAULT_EMBED_PORT`) lives in
 * `embedding-defaults.ts` because the renderer mirrors it for wizard
 * placeholders; it follows the same below-the-dynamic-range rule.
 */
export const DEFAULT_PG_PORT = 27432;
