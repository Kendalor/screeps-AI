// Minimal logger. Subsystem tags + level switching (cmd.debug("links")) come
// with commands/console.ts (docs/rewrite-skeleton.md §7).

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
