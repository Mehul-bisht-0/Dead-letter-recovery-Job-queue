import { createRuntime, installSignals } from '@reliable-queue/infrastructure';
import { createDashboard } from './app';
export { createDashboard } from './app';
async function main() {
  const runtime = await createRuntime('dashboard', { port: Number(process.env.PORT ?? 3001) });
  const app = await createDashboard({
    queue: runtime.queue,
    auth: runtime.auth,
    config: runtime.config,
    telemetry: runtime.telemetry,
    ready: async () => {
      await runtime.pool.query('SELECT 1');
    },
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
