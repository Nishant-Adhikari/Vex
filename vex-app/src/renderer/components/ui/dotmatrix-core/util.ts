export function cx(...values: Array<string | undefined | null | false>): string {
  return values.filter(Boolean).join(" ");
}

export function stylePx(n: number): string {
  return `${n}px`;
}

export function styleOpacity(opacity: number): number {
  return Math.round(opacity * 1e6) / 1e6;
}
