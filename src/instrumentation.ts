// Starts the built-in scan scheduler on always-on hosts (RUN_SCHEDULER=true). Node runtime only.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startScheduler } = await import("./scheduler");
    await startScheduler();
  }
}
