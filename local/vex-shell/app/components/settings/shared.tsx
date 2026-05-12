import React from "react";
import { Text } from "ink";

export function maskSecret(value: string | undefined): string {
  if (!value) return "<unset>";
  if (value.length <= 8) return "***";
  return `${value.slice(0, 4)}…${value.slice(-4)}`;
}

export function Label({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <Text color="cyan" bold>
      {children}
    </Text>
  );
}

export function Hint({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <Text dimColor>{children}</Text>;
}
