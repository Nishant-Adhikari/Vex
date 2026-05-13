/**
 * First-time hero shown when the user has zero sessions. Drops a single
 * CTA in front of them — "Start your first session" — so the empty
 * state isn't ambiguous.
 *
 * Action is a no-op render-prop because the parent SessionPanel owns
 * the SessionCreator dialog state; we only surface intent.
 */

import { Button } from "../../components/ui/button.js";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../../components/ui/card.js";

interface WelcomeBannerProps {
  readonly onStart: () => void;
}

export function WelcomeBanner({ onStart }: WelcomeBannerProps): JSX.Element {
  return (
    <Card className="w-full max-w-xl">
      <CardHeader>
        <CardTitle>Welcome to Vex</CardTitle>
        <CardDescription>
          Spin up your first session. Sessions are isolated agent threads
          — pick a mode and a permission posture, then talk to your
          local agent.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <ul className="flex flex-col gap-2 text-sm text-[var(--color-text-secondary)]">
          <li>
            <span className="font-medium text-foreground">Agent mode</span>{" "}
            — open-ended conversation, no goal-driven loop.
          </li>
          <li>
            <span className="font-medium text-foreground">Mission mode</span>{" "}
            — Vex pursues a goal with optional autonomous execution.
          </li>
        </ul>
        <div className="flex justify-start">
          <Button type="button" onClick={onStart}>
            Start your first session
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
