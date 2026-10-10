import { AsyncLocalStorage } from "node:async_hooks";
const traces = new AsyncLocalStorage();
export const withGatewayTrace = (record, run) => traces.run(record, run);
export async function recordTransfer(data) {
  const record = traces.getStore();
  if (record) await record(data);
}
