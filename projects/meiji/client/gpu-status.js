import { request } from './task-client.js';

export function mountGpuStatus(root) {
  const status = document.createElement('div');
  status.className = 'gpu-status';
  status.setAttribute('role', 'status');
  status.setAttribute('aria-label', 'GPU 利用率');
  status.textContent = 'GPU：--';
  root.querySelector('.library').before(status);
  let timer, pending, disposed = false;
  const refresh = async () => {
    if (disposed || document.hidden || pending) return;
    const controller = new AbortController();
    pending = controller;
    try {
      const data = await request('gpu', { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(60 * 60 * 1000)]) });
      if (disposed || document.hidden || pending !== controller) return;
      if (!data.gpus?.length) throw new Error('GPU unavailable');
      status.textContent = data.gpus.map(gpu =>
        `GPU${data.gpus.length > 1 ? ` ${gpu.index}` : ''}：${Number.isFinite(gpu.utilization_percent) ? `${gpu.utilization_percent}%` : '--'}`,
      ).join(' · ');
      status.title = data.gpus.map(gpu => gpu.name).join(' / ') + ` · 更新于 ${new Date(data.sampled_at).toLocaleTimeString()}`;
    } catch {
      if (!disposed && !document.hidden && pending === controller) {
        status.textContent = 'GPU：暂不可用';
        status.title = '暂时无法读取 GPU 利用率，5 秒后重试';
      }
    } finally { if (pending === controller) pending = null; }
  };
  const visibilityChanged = () => {
    clearInterval(timer);
    pending?.abort();
    pending = null;
    status.textContent = 'GPU：--';
    status.title = '';
    if (!document.hidden && !disposed) {
      void refresh();
      timer = setInterval(refresh, 5000);
    }
  };
  document.addEventListener('visibilitychange', visibilityChanged);
  visibilityChanged();
  return () => {
    disposed = true;
    clearInterval(timer);
    pending?.abort();
    document.removeEventListener('visibilitychange', visibilityChanged);
    status.remove();
  };
}
