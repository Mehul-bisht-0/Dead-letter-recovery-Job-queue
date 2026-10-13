import { createRuntime, installSignals, startMonitor } from '@reliable-queue/infrastructure';
import { Dispatcher } from './dispatcher';
export { Dispatcher } from './dispatcher';
async function main() {
  const runtime = await createRuntime(
    'dispatcher',
    { port: Number(process.env.PORT ?? 3003) },
    true,
  );
  const dispatcher = new Dispatcher(runtime.jobs, runtime.dispatch, runtime.config, runtime.logger);
  try {
    const closeMonitor = await startMonitor(runtime, () => dispatcher.ready);
    installSignals(async () => {
      try {
        await dispatcher.stop();
      } finally {
        try {
          await closeMonitor();
        } finally {
          await runtime.close();
        }
      }
    }, runtime.logger);
    dispatcher.start();
  } catch (error) {
    await runtime.close();
    throw error;
  }
}
if (require.main === module)
  void main().catch((error) => {
    process.stderr.write(String(error) + '\n');
    process.exitCode = 1;
  });
