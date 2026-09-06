export function githubRepository(value) {
  let url=typeof value==='string'?value:value?.url;
  if(typeof url!=='string')return null;
  url=url.replace(/^git\+/, '').replace(/^git@github\.com:/, 'https://github.com/');
  try{const parsed=new URL(url);if(parsed.hostname.toLowerCase()!=='github.com')return null;const parts=parsed.pathname.replace(/\.git\/?$/,'').split('/').filter(Boolean);return parts.length===2?parts.join('/').toLowerCase():null;}catch{return null;}
}
/** A repository package name is not enough to identify the same published npm project. */
export function verifyNpmIdentity(metadata, plugin) {
  if (!plugin.verification && !githubRepository(plugin.repositoryUrl)) return;
  const expected=githubRepository(plugin.repositoryUrl);
  const latest=metadata.versions?.[metadata['dist-tags']?.latest];
  const actual=githubRepository(latest?.repository??metadata.repository);
  if(!actual)throw new Error('npm 包未声明可核对的 GitHub 来源');
  if(actual!==expected)throw new Error('npm 包对应的 GitHub 仓库与目录不一致');
}
