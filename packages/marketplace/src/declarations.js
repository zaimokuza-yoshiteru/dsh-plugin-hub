import semver from 'semver';

/** Interpret author declarations; conflicting formats never become a positive result. */
export function dshDeclaration(manifest, host, peerEvidence) {
  const entries = [['engines.dsh', manifest.engines?.dsh], ['dsh.engines.dsh', manifest.dsh?.engines?.dsh], ['dsh.compatibility.dsh', manifest.dsh?.compatibility?.dsh]].filter(([, range]) => range !== undefined);
  const exact = manifest.dsh?.compatibility?.dshReleases?.[host.dsh];
  // Plugin Hub's explicit opt-in is independent of SemVer, so future RCs are
  // allowed too. Never widen an author's version constraint or peer dependency.
  const capabilityBased = manifest.dshPluginHub?.hostCompatibility === 'capability-based';
  const basis = entries.map(([key]) => key).concat(exact !== undefined ? ['dsh.compatibility.dshReleases'] : []).join(' + ') || (capabilityBased ? 'dshPluginHub.hostCompatibility' : peerEvidence ? 'peerDependencies' : 'undeclared');
  const range = entries.map(([, range]) => range).filter(range => typeof range === 'string').join(' & ') || null;
  if (!semver.valid(host.dsh) || entries.some(([, range]) => typeof range !== 'string' || !semver.validRange(range)) || exact !== undefined && !['compatible', 'incompatible'].includes(exact)) return { basis, range, status: 'unknown', reasons: ['未提供有效的 DSH 兼容声明'] };
  const results = entries.map(([, range]) => semver.satisfies(host.dsh, range));
  if (exact !== undefined) results.push(exact === 'compatible');
  if (results.includes(true) && results.includes(false)) return { basis, range, status: 'unknown', reasons: ['兼容声明存在冲突，需要维护者确认'] };
  if (results.includes(false)) return { basis, range, status: 'incompatible', reasons: [range ? `要求 DSH ${range}，当前为 ${host.dsh}` : `作者声明不兼容 DSH ${host.dsh}`] };
  if (!results.length && !peerEvidence && !capabilityBased) return { basis, range, status: 'unknown', reasons: ['未提供有效的 DSH 兼容声明'] };
  return { basis, range, status: 'compatible', reasons: [] };
}
