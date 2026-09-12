export class RequestError extends Error {
  constructor(message) { super(message); this.name = 'RequestError'; }
}

/** Use DSH's authenticated Connection carrier, including the Desktop worker bridge. */
export function connectionRequest(connection, marketId) {
  const endpoint = 'dshPluginHub_' + marketId.replaceAll('-', '_') + '/';
  return async (path, data = {}, { signal } = {}) => {
    const deadline = signal ? AbortSignal.any([signal, AbortSignal.timeout(path === 'experiment-mutate' ? 370000 : 20000)]) : AbortSignal.timeout(path === 'experiment-mutate' ? 370000 : 20000);
    const result = await connection.rpc.call('/api', endpoint + path, data, deadline);
    if (!result.ok) throw new RequestError(result.error.message);
    return result.value;
  };
}
