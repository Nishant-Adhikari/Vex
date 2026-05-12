export interface TerminalSize {
  columns: number;
  rows: number;
}

export interface ShellLayout {
  columns: number;
  rows: number;
  bodyRows: number;
  mainColumns: number;
  sidebarColumns: number;
}

const MIN_COLUMNS = 48;
const MIN_ROWS = 16;
const COCKPIT_ROWS = 4;
const STATUS_ROWS = 2;
const INPUT_ROWS = 3;

export function clampTerminalSize(size: TerminalSize): TerminalSize {
  return {
    columns: Math.max(MIN_COLUMNS, Math.floor(size.columns || 80)),
    rows: Math.max(MIN_ROWS, Math.floor(size.rows || 24)),
  };
}

export function deriveShellLayout(
  size: TerminalSize,
  sidebarOpen: boolean,
): ShellLayout {
  const { columns, rows } = clampTerminalSize(size);
  const bodyRows = Math.max(4, rows - COCKPIT_ROWS - STATUS_ROWS - INPUT_ROWS);
  const sidebarColumns = sidebarOpen
    ? Math.min(38, Math.max(30, Math.floor(columns * 0.32)))
    : 0;
  const mainColumns = Math.max(
    20,
    columns - sidebarColumns - (sidebarOpen ? 1 : 0),
  );

  return {
    columns,
    rows,
    bodyRows,
    mainColumns,
    sidebarColumns,
  };
}

export { STATUS_ROWS };
