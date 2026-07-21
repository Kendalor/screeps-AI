// Minimal logger. Subsystem tags + level switching arrive with commands/console.ts.

export const log = {
  error(msg: string): void {
    console.log(`[ERROR] ${msg}`);
  },
  warn(msg: string): void {
    console.log(`[WARN] ${msg}`);
  },
  info(msg: string): void {
    console.log(`[INFO] ${msg}`);
  }
};
