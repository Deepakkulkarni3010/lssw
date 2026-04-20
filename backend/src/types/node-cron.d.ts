// Fallback type declaration for node-cron
declare module 'node-cron' {
  function schedule(
    expression: string,
    func: () => void,
    options?: { timezone?: string }
  ): void;
  export { schedule };
}
