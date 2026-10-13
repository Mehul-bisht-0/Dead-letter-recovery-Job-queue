import { createRuntime, installSignals } from '@reliable-queue/infrastructure';
import { createApp } from './app';
export { createApp } from './app';
async function main() {
  const runtime = await createRuntime('api');
  const app = await createApp({
    queue: runtime.queue,
    auth: runtime.auth,
    telemetry: runtime.telemetry,
    ready: async () => {
      await runtime.pool.query('SELECT 1');
    },
    corsOrigins: runtime.config.corsOrigins,
    trustProxy: runtime.config.trustProxy,
  }).catch(async (error) => {
    await runtime.close();
    throw error;
  });
  installSignals(async () => {
    try {
      await app.close();
    } finally {
      await runtime.close();
    }
  }, runtime.logger);
  try {
    await app.listen({ host: runtime.config.host, port: runtime.config.port });
  } catch (error) {
    await app.close();
    await runtime.close();
    throw error;
  }
}
if (require.main === module)
  void main().catch((error) => {
    process.stderr.write(String(error) + '\n');
    process.exitCode = 1;
  });
