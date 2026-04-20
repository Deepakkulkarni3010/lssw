// Fallback type declaration for node-cron (used if @types/node-cron is unavailable)
declare module 'node-cron' {
  function schedule(
    expression: string,
    func: () => void,
    options?: { timezone?: string }
  ): void;
  export { schedule };
}
