export class RequestError extends Error {
  constructor(key, detail = '') { super(key); this.detail = detail; }
}

export async function request(path, data, { signal, fetcher = fetch, base = '/dsh-plugin-hub/hub/api/' } = {}) {
  let response;
  try {
    response = await fetcher(base + path, {
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(20000)]) : AbortSignal.timeout(20000),
      ...(data === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) }),
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new RequestError(error.name === 'TimeoutError' ? '请求超时，正在等待 DSH 响应。' : '连接已断开，请确认本地 DSH 实例正在运行。恢复后页面会自动重连。');
  }
  if (response.status === 401) throw new RequestError('请先登录当前 DSH 实例');
  let value;
  try { value = await response.json(); }
  catch { throw new RequestError('服务返回了无效响应，请刷新 DSH 页面。'); }
  if (!response.ok) throw new RequestError(value.error ?? `HTTP ${response.status}`);
  return value;
}
