import { loadConfig } from '@reliable-queue/infrastructure';
import type { EnqueueBody } from '@reliable-queue/contracts';
export function client() {
  const config = loadConfig();
  if (!config.apiKey) throw new Error('API_KEY required');
  const send = async (path: string, method = 'GET', body?: unknown) => {
    const response = await fetch(config.apiUrl + path, {
      method,
      headers: { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(10000),
    });
    const json = await response.json();
    if (!response.ok) throw new Error(`${response.status}: ${JSON.stringify(json)}`);
    return json;
  };
  return {
    send,
    enqueue: (body: EnqueueBody) => send('/jobs', 'POST', body),
    queue: config.queueName,
  };
}
