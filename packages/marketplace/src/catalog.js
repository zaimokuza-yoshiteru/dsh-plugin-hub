import { githubRepository } from './npm-identity.js';
import semver from 'semver';
import { dshDeclaration } from './declarations.js';

export const PACKAGE_NAME = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/;
export const TAG_LABELS = { agent: 'Agent 接入', 'developer-tools': '开发工具', knowledge: '知识文档', productivity: '效率工具', integration: '系统集成', ui: '界面' };

/** Validate external catalog data before replacing the last usable snapshot. */
export function validateCatalog(value) {
  if (!value || value.schemaVersion !== 1 || !Array.isArray(value.plugins)) throw new Error('目录格式不受支持：需要 schemaVersion: 1 和 plugins 数组');
  if (value.plugins.length > 25000) throw new Error('目录最多支持 25000 个插件');
  const seen = new Set();
  const plugins = value.plugins.map((item, index) => {
    const fail = message => { throw new Error(`目录第 ${index + 1} 条：${message}`); };
    if (!item || typeof item !== 'object') fail('插件记录必须为对象');
    if (typeof item.packageName !== 'string' || !PACKAGE_NAME.test(item.packageName) || item.packageName.length > 214) fail('npm 包名无效');
    if (seen.has(item.packageName)) fail('npm 包名重复');
    seen.add(item.packageName);
    for (const [key, limit] of [['displayName', 80], ['description', 300], ['owner', 80]]) {
      if (typeof item[key] !== 'string' || !item[key].trim() || item[key].length > limit) fail(`${key} 无效`);
    }
    if (!['internal', 'community'].includes(item.origin)) fail('origin 无效');
    if (!Array.isArray(item.tags) || item.tags.length < 1 || item.tags.length > 5 || new Set(item.tags).size !== item.tags.length || item.tags.some(tag => typeof tag !== 'string' || !/^[a-z][a-z0-9-]{0,39}$/.test(tag))) fail('tags 无效');
    for (const key of ['documentationUrl', 'troubleshootingUrl', 'repositoryUrl']) {
      if (item[key] === undefined) continue;
      let url;
      try { url = new URL(item[key]); } catch { fail(`${key} 不是有效 URL`); }
      if (typeof item[key] !== 'string' || url.protocol !== 'https:' || url.username || url.password) fail(`${key} 必须是无凭据的 HTTPS 链接`);
    }
    if (item.stars !== undefined && (!Number.isSafeInteger(item.stars) || item.stars < 0)) fail('stars 无效');
    if (item.verification !== undefined) {
      const v = item.verification;
      if (!v || v.kind !== 'bundle-manifest' || !/^[a-f0-9]{40}$/.test(v.commit ?? '') || !Number.isFinite(Date.parse(v.checkedAt)) || v.manifestPath !== 'package.json' || typeof v.patchPath !== 'string' || !item.repositoryUrl) fail('verification 无效');
    }
    const locales = {};
    if (item.locales !== undefined) {
      if (!item.locales || typeof item.locales !== 'object' || Array.isArray(item.locales) || Object.keys(item.locales).length > 10) fail('locales 无效');
      for (const [language, copy] of Object.entries(item.locales)) {
        if (!/^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(language) || !copy || typeof copy !== 'object' || Array.isArray(copy)) fail('locales 无效');
        locales[language] = {};
        for (const [key, limit] of [['displayName', 80], ['description', 300]]) {
          if (copy[key] === undefined) continue;
          if (typeof copy[key] !== 'string' || !copy[key].trim() || copy[key].length > limit) fail(`locales.${language}.${key} 无效`);
          locales[language][key] = copy[key];
        }
      }
    }
    const result = Object.fromEntries(['packageName', 'displayName', 'description', 'owner', 'origin', 'tags', 'documentationUrl', 'troubleshootingUrl', 'repositoryUrl', 'stars', 'verification'].filter(key => item[key] !== undefined).map(key => [key, item[key]]));
    return Object.keys(locales).length ? { ...result, locales } : result;
  });
  return { schemaVersion: 1, plugins };
}

/** Declared compatibility is not a promise that a package has been runtime-tested. */
export function evaluateVersion(version, manifest, publishedAt, host, now, minimumAgeHours = 48) {
  const peerEvidence = Object.entries(manifest.peerDependencies ?? {}).some(([name, range]) => name.startsWith('@deepseek-ai/dsh-') && typeof range === 'string' && semver.validRange(range) && host.peers[name]);
  const declaration = dshDeclaration(manifest, host, peerEvidence);
  const dshRange = declaration.range;
  const reasons = [...declaration.reasons];
  let compatibility = declaration.status;
  if (manifest.engines?.node && (!semver.validRange(manifest.engines.node) || !semver.satisfies(host.node, manifest.engines.node))) {
    compatibility = 'incompatible'; reasons.push(`要求 Node ${manifest.engines.node}`);
  }
  const extraNode = manifest.dsh?.compatibility?.node;
  if (extraNode !== undefined && (typeof extraNode !== 'string' || !semver.validRange(extraNode) || !semver.satisfies(host.node, extraNode))) {
    compatibility = 'incompatible'; reasons.push(`要求 Node ${extraNode}`);
  }
  const profiles = manifest.dsh?.compatibility?.profiles;
  if (Array.isArray(profiles) && !profiles.includes(host.profile ?? 'web')) { compatibility = 'incompatible'; reasons.push('声明不支持当前 DSH profile'); }
  for (const [name, range] of Object.entries(manifest.peerDependencies ?? {})) {
    if (!name.startsWith('@deepseek-ai/')) continue;
    const actual = host.peers[name];
    if (!actual) {
      if (manifest.peerDependenciesMeta?.[name]?.optional) continue;
      if (compatibility !== 'incompatible') compatibility = 'unknown';
      reasons.push(`无法确认宿主接口 ${name}`);
    } else if (typeof range !== 'string' || !semver.validRange(range) || !semver.satisfies(actual, range)) {
      compatibility = 'incompatible'; reasons.push(`${name} 要求 ${range}，当前为 ${actual}`);
    }
  }
  for (const [key, actual] of [['os', host.platform], ['cpu', host.arch]]) {
    const values = manifest[key];
    if (Array.isArray(values) && (values.includes(`!${actual}`) || (values.some(v => !v.startsWith('!')) && !values.includes(actual) && !values.includes('any')))) {
      compatibility = 'incompatible'; reasons.push(`不支持当前 ${key}: ${actual}`);
    }
  }
  const publishedMs = typeof publishedAt === 'string' ? Date.parse(publishedAt) : NaN;
  const eligibleAt = Number.isFinite(publishedMs) ? new Date(publishedMs + minimumAgeHours * 3600000).toISOString() : null;
  const age = eligibleAt === null ? 'unknown' : Date.parse(eligibleAt) <= now ? 'ready' : 'waiting';
  if (age === 'unknown') reasons.push('仓库未返回有效发布时间');
  if (age === 'waiting') reasons.push(`发布未满 ${minimumAgeHours} 小时`);
  if (manifest.deprecated) reasons.push(`已弃用：${manifest.deprecated}`);
  const canInstall = compatibility === 'compatible' && age === 'ready' && !manifest.deprecated;
  return { version, compatibilityBasis: declaration.basis, publishedAt: Number.isFinite(publishedMs) ? new Date(publishedMs).toISOString() : null, dshRange, compatibility, age, eligibleAt, canInstall, reasons };
}

export function releaseList(metadata, host, now, minimumAgeHours, plugin) {
  return Object.entries(metadata.versions ?? {})
    .filter(([version, manifest]) => semver.valid(version) && manifest && typeof manifest === 'object')
    .sort(([a], [b]) => semver.rcompare(a, b))
    .map(([version, manifest]) => {
      const release = evaluateVersion(version, manifest, metadata.time?.[version], host, now, minimumAgeHours);
      if((plugin?.verification || githubRepository(plugin?.repositoryUrl)) && githubRepository(manifest.repository)!==githubRepository(plugin.repositoryUrl)) { release.canInstall=false; release.reasons.push('该版本的 npm 来源无法与目录仓库核对'); }
      return release;
    });
}
