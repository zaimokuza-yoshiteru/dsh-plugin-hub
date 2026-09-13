import { agentTeams } from '../experiment-definitions.js';

const errors = {
  'invalid-request': '无效的实验性功能请求',
  'profile-changed': '实例 profile 已变化，请刷新',
  unsupported: '当前宿主不支持管理此实验性功能',
  busy: '实验性功能正在更新',
  'state-changed': '实验性功能状态已变化，请刷新后重试',
  'tasks-running': '仍有任务或请求正在运行，请等待完成或停止后再切换',
  failed: '实验性功能切换失败，请刷新确认当前状态',
};

function desktopBridge(desktop) {
  const bridge = desktop?.experiments;
  return bridge?.version === 1 && typeof bridge.list === 'function' && typeof bridge.setEnabled === 'function' ? bridge : null;
}

function validateSnapshot(snapshot, profile) {
  if (snapshot?.profile !== profile.directory) throw new Error('实例 profile 已变化，请刷新');
  if (!Array.isArray(snapshot.features)) throw new Error('宿主实验性功能接口返回了无效状态');
  const rows = snapshot.features.filter(row => row?.id === 'agent-teams');
  if (rows.length > 1 || rows.some(row => typeof row.enabled !== 'boolean' || ![true, false, null].includes(row.activeEnabled) || ['installed', 'canToggle', 'busy'].some(key => typeof row[key] !== 'boolean'))) throw new Error('宿主实验性功能接口返回了无效状态');
  return rows;
}

/** UI uses one adapter; Desktop mutations never fall back to profile-file writes. */
export function experimentClient(request, desktop, reload) {
  return {
    async list(profile, options = {}) {
      if (profile.installation !== 'desktop') return request('experiments', {}, options);
      const baseline = [{ ...agentTeams, enabled: null, activeEnabled: null, installed: false, busy: false, pendingRestart: false }];
      const bridge = desktopBridge(desktop);
      const native = bridge ? validateSnapshot(await bridge.list(), profile) : [];
      return baseline.map(row => {
        const feature = native.find(item => item.id === row.id);
        return feature ? { ...row, ...feature, canInstall: false, supported: true, pendingRestart: feature.activeEnabled !== null && feature.enabled !== feature.activeEnabled }
          : { ...row, canToggle: false, canInstall: false, supported: false };
      });
    },
    async change(profile, row, enabled, action = 'toggle') {
      if (profile.installation !== 'desktop') return request('experiment-mutate', { profile: profile.directory, id: row.id, action, enabled, expectedEnabled: row.enabled });
      const bridge = desktopBridge(desktop);
      if (!bridge || !row.supported || !row.canToggle || action !== 'toggle') throw new Error('当前宿主不支持管理此实验性功能');
      const result = await bridge.setEnabled({ profile: profile.directory, id: row.id, enabled, expectedEnabled: row.enabled });
      if (result?.ok === false) {
        throw new Error(errors[result.error?.code] ?? errors.failed);
      }
      if (result?.ok !== true || typeof result.reloadRequired !== 'boolean') throw new Error('宿主实验性功能接口返回了无效状态');
      validateSnapshot(result.value, profile);
      if (result.reloadRequired) reload();
      return result.value;
    },
  };
}
