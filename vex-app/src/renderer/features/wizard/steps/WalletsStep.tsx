/**
 * Wizard Step 2 — Wallets (M8).
 *
 * Two chains (EVM + Solana), three actions per chain (Generate, Import,
 * Restore from backup). Layout: shadcn Tabs split.
 *
 * Skip-to-continue logic: when both chains have a wallet (either
 * persisted from a previous session via `envState.walletStatus.{evm,solana}`
 * being "present", OR set in-session via `lastGenerated`), render a
 * summary card with both addresses and a Continue button. Otherwise
 * render the Tabs UI.
 *
 * Address display sources (in order):
 *  1. `lastGenerated[chain]`  — freshest (just generated/imported/restored
 *     in this session)
 *  2. `envState.walletAddresses[chain]` — cross-session (loaded from
 *     `config.json` by the env-state probe)
 *
 * Per codex turn 8 RED #1, raw private keys never enter React state /
 * Zustand / TanStack cache. The import flow is implemented inside
 * `ChainActions` with a direct async call.
 */

import { useCallback, useState, type JSX } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../../../components/ui/card.js";
import { Button } from "../../../components/ui/button.js";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "../../../components/ui/tabs.js";
import { AddressDisplay } from "../../../components/common/AddressDisplay.js";
import { useEnvState } from "../../../lib/api/onboarding.js";
import {
  nextWizardStateFor,
  useSetWizardState,
} from "../../../lib/api/wizard.js";
import type { WizardStepId } from "@shared/schemas/wizard.js";
import type { WalletChain } from "@shared/schemas/wallets.js";
import { ChainActions } from "./wallets/ChainActions.js";

interface ChainState {
  readonly evm?: string;
  readonly solana?: string;
}

export interface WalletsStepProps {
  readonly completedSteps: ReadonlyArray<WizardStepId>;
  readonly onAdvance: (next: WizardStepId) => void;
}

export function WalletsStep({
  completedSteps,
  onAdvance,
}: WalletsStepProps): JSX.Element {
  const envQuery = useEnvState();
  const setWizardState = useSetWizardState();

  const [lastGenerated, setLastGenerated] = useState<ChainState>({});
  const [lastBackupDir, setLastBackupDir] = useState<ChainState>({});
  const [advanceError, setAdvanceError] = useState<string | null>(null);

  const envData = envQuery.data?.ok === true ? envQuery.data.data : null;
  const evmAddress =
    lastGenerated.evm ?? envData?.walletAddresses?.evm ?? null;
  const solanaAddress =
    lastGenerated.solana ?? envData?.walletAddresses?.solana ?? null;

  const evmReady =
    evmAddress !== null || envData?.walletStatus.evm === "present";
  const solanaReady =
    solanaAddress !== null || envData?.walletStatus.solana === "present";
  const bothReady = evmReady && solanaReady;

  const advanceToApiKeys = useCallback(async (): Promise<void> => {
    setAdvanceError(null);
    const next = nextWizardStateFor({
      completedSteps,
      current: "wallets",
      next: "apiKeys",
    });
    const result = await setWizardState.mutateAsync(next);
    if (!result.ok) {
      setAdvanceError(result.error.message);
      return;
    }
    onAdvance("apiKeys");
  }, [completedSteps, setWizardState, onAdvance]);

  const handleAddressSet = useCallback(
    (chain: WalletChain, address: string, backupDir: string | null): void => {
      setLastGenerated((prev) => ({ ...prev, [chain]: address }));
      if (backupDir !== null) {
        setLastBackupDir((prev) => ({ ...prev, [chain]: backupDir }));
      }
    },
    []
  );

  if (envQuery.isLoading) {
    return (
      <Card className="w-full max-w-2xl" data-vex-wizard-wallets="loading">
        <CardHeader>
          <CardTitle>Set up wallets</CardTitle>
        </CardHeader>
        <CardContent>
          <div role="status" aria-live="polite" className="flex items-center gap-2">
            <div
              aria-hidden
              className="h-1 w-32 overflow-hidden rounded-full bg-popover"
            >
              <div className="h-full w-1/3 animate-pulse bg-primary" />
            </div>
            <span className="sr-only">Loading wallet status…</span>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (bothReady) {
    return (
      <Card className="w-full max-w-2xl" data-vex-wizard-wallets="ready">
        <CardHeader>
          <CardTitle>Wallets configured</CardTitle>
          <CardDescription>
            Both wallets are set up. Continue to configure API keys.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-col gap-3">
            <div>
              <p className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
                EVM
              </p>
              {evmAddress !== null ? (
                <AddressDisplay address={evmAddress} className="mt-1" />
              ) : (
                <p className="mt-1 text-sm text-muted-foreground">
                  Wallet present (address loaded from config).
                </p>
              )}
            </div>
            <div>
              <p className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
                Solana
              </p>
              {solanaAddress !== null ? (
                <AddressDisplay address={solanaAddress} className="mt-1" />
              ) : (
                <p className="mt-1 text-sm text-muted-foreground">
                  Wallet present (address loaded from config).
                </p>
              )}
            </div>
          </div>
          {advanceError !== null ? (
            <p className="text-sm text-destructive" role="alert">
              {advanceError}
            </p>
          ) : null}
          <div className="flex justify-end">
            <Button
              onClick={() => {
                void advanceToApiKeys();
              }}
              disabled={setWizardState.isPending}
            >
              {setWizardState.isPending ? "Continuing…" : "Continue"}
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="w-full max-w-2xl" data-vex-wizard-wallets="setup">
      <CardHeader>
        <CardTitle>Set up wallets</CardTitle>
        <CardDescription>
          Vex needs both an EVM wallet (Ethereum + L2s) and a Solana
          wallet. Generate fresh keys, import existing ones, or restore
          from a backup keystore file. Each chain is encrypted with the
          master password from Step 1.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="evm">
          <TabsList>
            <TabsTrigger value="evm">EVM</TabsTrigger>
            <TabsTrigger value="solana">Solana</TabsTrigger>
          </TabsList>
          <TabsContent value="evm">
            <ChainActions
              chain="evm"
              address={evmAddress}
              backupDir={lastBackupDir.evm ?? null}
              onAddressSet={handleAddressSet}
            />
          </TabsContent>
          <TabsContent value="solana">
            <ChainActions
              chain="solana"
              address={solanaAddress}
              backupDir={lastBackupDir.solana ?? null}
              onAddressSet={handleAddressSet}
            />
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
