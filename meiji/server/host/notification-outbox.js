import { deliverTaskNotice } from "./task-notices.js";
export class NotificationOutbox {
  #repository;
  #controller;
  #running = new Map();
  #disposed = false;
  constructor(repository, controller) {
    this.#repository = repository;
    this.#controller = controller;
  }
  async drain(projectId) {
    if (this.#disposed) return;
    if (this.#running.has(projectId)) return this.#running.get(projectId);
    const run = this.#drain(projectId).finally(() =>
      this.#running.delete(projectId),
    );
    this.#running.set(projectId, run);
    return run;
  }
  async #drain(projectId) {
    const model = await this.#repository.open(projectId);
    while (!this.#disposed) {
      const notice = model
        .read()
        .runtime.outbox.find((n) => n.delivery_status === "pending");
      if (!notice) return;
      let error = "";
      try {
        await deliverTaskNotice(this.#controller, notice);
      } catch (cause) {
        error = cause.message;
      }
      await model.update(
        `notice:${notice.id}:${globalThis.crypto.randomUUID()}`,
        { notice_id: notice.id, error },
        (s) => {
          const n = s.runtime.outbox.find((n) => n.id === notice.id);
          n.delivery_status = error ? "pending" : "delivered";
          n.error = error;
          return {};
        },
      );
      if (error) return { notification_error: error };
    }
  }
  dispose() {
    this.#disposed = true;
    return Promise.all([...this.#running.values()]);
  }
}
