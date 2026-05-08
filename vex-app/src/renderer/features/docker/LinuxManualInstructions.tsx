/**
 * Render the docker.com apt-repo bootstrap as a copy-paste block.
 * `instructions` arrives from the main process so we don't ship the
 * exact command list in the renderer bundle (privacy + bundle size).
 */

import { Button } from "../../components/ui/button.js";
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card.js";

interface LinuxManualInstructionsProps {
  readonly instructions: string;
  readonly onRetry: () => void;
}

export function LinuxManualInstructions({
  instructions,
  onRetry,
}: LinuxManualInstructionsProps): JSX.Element {
  return (
    <Card className="w-full max-w-2xl">
      <CardHeader>
        <CardTitle>Install Docker Engine manually</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <pre className="overflow-x-auto rounded-md border border-border bg-popover/40 p-3 text-xs leading-relaxed text-foreground">
          <code>{instructions}</code>
        </pre>
        <p className="text-xs text-muted-foreground">
          After install: log out and back in (or reboot) so your user joins the{" "}
          <code className="font-mono">docker</code> group, then click Retry.
        </p>
        <div className="flex justify-end">
          <Button onClick={onRetry}>Retry detection</Button>
        </div>
      </CardContent>
    </Card>
  );
}
