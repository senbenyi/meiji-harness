import { AsyncLocalStorage } from 'node:async_hooks';

const traces = new AsyncLocalStorage();
export const withRequestTrace = (record, run) => traces.run(record, run);
export async function recordTransfer(data, options) {
  const record = traces.getStore();
  if (record) await record(data, options);
}
