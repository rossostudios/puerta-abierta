export async function register() {
  // Sentry instrumentation is disabled for the ECS migration baseline.
}

export async function onRequestError(...args: unknown[]) {
  void args;
}
