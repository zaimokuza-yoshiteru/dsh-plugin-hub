# 使用与目录规范 / Usage and catalog format

## 中文

### 生成企业市场

发布后从 npm 或 Nexus 获取 CLI；模板随包提供，不访问 GitHub。

```sh
npx @zaimokuza/create-dsh-plugin-hub create-market team-market \
  --name @company/dsh-market --market-id team \
  --title 'Team Tools' --sub-title 'PLUGIN HUB' --primary-color blue \
  --datasource npm:@company/dsh-catalog \
  --registry https://nexus.example/repository/npm-group/
cd team-market
npm install
npm run build
npm pack
```

`npm run build` 生成插件入口，`npm pack` 生成包含入口与清单的 tgz。构建依赖（包括 esbuild 的平台包）需要能从配置的 npm 仓库获取。

`hub.config.json` 控制品牌与数据源；修改后重新构建。企业生成项目只读取指定目录，不启用公共演示目录。公共演示目录作为运行时依赖可能被下载。npm 凭据由环境/npm 配置提供，不写进配置 JSON。

### 生成子来源

```sh
npx @zaimokuza/create-dsh-plugin-hub create-source team-source \
  --name @company/dsh-source --market-id team --source-id handbook \
  --title Handbook --datasource npm:@company/handbook-catalog
```

`market-id` 必须与目标市场相同。子来源是普通 DSH 插件，可以写入主目录供用户安装；安装并重启后才贡献标签页。卸载并重启后标签页消失。子来源中的同名 npm 包覆盖主目录记录；多个子来源按 priority 降序、source ID 升序选择记录。

CLI 也支持 `--datasource file:./plugins.json`，将 JSON 编译进生成项目。npm 模式中，**插件包名**是 `--name`，**数据包名**是 `--datasource npm:...`，两者相互独立。

### 目录 JSON

数据包只需包含 `package.json` 和根目录 `plugins.json`；将后者列入 npm `files`。版本更新后独立发布，市场刷新会读取 `latest` 并校验 tarball integrity。

```json
{
  "schemaVersion": 1,
  "plugins": [{
    "packageName": "@company/dsh-search",
    "displayName": "知识搜索",
    "description": "查找团队文档。",
    "owner": "Knowledge Team",
    "origin": "internal",
    "tags": ["knowledge"],
    "documentationUrl": "https://docs.example/search",
    "troubleshootingUrl": "https://docs.example/search/help",
    "locales": { "en": { "displayName": "Knowledge search", "description": "Find team documentation." } }
  }]
}
```

必填字段如上；两个文档链接与 `locales` 可省略。`origin` 为 `internal` 或 `community`。tag 是展示标签，可用 `agent`、`developer-tools`、`knowledge`、`productivity`、`integration`、`ui`，也支持自定义小写标识；卡片 tag 不会修改筛选条件。目录顺序即展示顺序，不展示 Star。每个目录包内包名必须唯一。

可选 `repositoryUrl` 为 HTTPS。提供 GitHub 仓库地址时，市场核对 npm 的 repository，避免安装同名的其它项目。介绍与排查链接直接在新窗口打开，网页自身处理登录。

### 其他插件直接接入（数据扩展接口 v1）

已有插件可以直接注册列表，无需使用生成器，也无需依赖本项目的 npm 包或目录包。这是后端数据接口，不是任意 HTML / React 注入槽。市场负责渲染、独立来源 tab、按包名去重，以及统一版本、发行时间和安装检查。

默认市场的服务名为 `dshPluginHub_hub`；企业市场使用 `dshPluginHub_` 加上 `market-id`（连字符改为下划线）。同一 profile 中，用 `ctx.inject([服务名], scope => …)` 可选接入，检查 `apiVersion === 1`，再调用：

```js
scope.effect(() => scope.dshPluginHub_hub.registerSource({
  id: 'my-team',
  displayName: 'My team',
  kind: 'json',
  async getCatalog({ signal }) {
    // 返回本页目录规范定义的 JSON / Return the catalog JSON defined above.
    return { schemaVersion: 1, plugins: [] };
  },
}), 'My team: catalog');
```

可运行的[独立插件示例](../examples/custom-catalog/index.js)包含可选绑定、文件读取和完整释放逻辑；复制整个 `examples/custom-catalog/`，改包名、patch 与清单即可集成。示例不依赖市场 npm 包；`private: true` 标明它是本地接入示例。TypeScript 类型可通过 `import type { ProviderApi, CatalogSource } from '@zaimokuza/dsh-plugin-hub/provider-api'` 引入；仅作开发依赖即可。

- `id`：同一市场内唯一，1–80 位小写字母、数字、`.`、`_`、`-`，首位为字母或数字。`displayName`：tab 名，最多 80 字符。
- `kind: 'json'`：`getCatalog({ signal })` 可同步或异步返回清单；可以读取插件自己的文件或调用自己的数据服务，认证由提供方管理，不要把凭据写入清单。`kind: 'npm'` 则使用 `packageName` 指定目录包，读取市场配置的 registry。
- `priority` 可选，默认 0，范围 -1000–1000；扩展来源优先于主来源，扩展之间按优先级降序、ID 升序去重。`cacheVersion` 可选（最多 80 字符），数据语义或读取目标改变时更新它，避免复用旧缓存。
- 注册会触发读取；用户点击市场“刷新”时再次调用。不是提供方数据变化后自动推送。列表变化只需刷新；插件代码的安装/卸载仍遵守 DSH 生命周期。
- 注册返回幂等释放函数，必须交给 `scope.effect`；可选绑定本身也应在所属插件释放时 `dispose()`。来源移除后，其 tab 和贡献数据移除，重复条目回退到其他来源。
- 同一市场最多 20 个来源（含主来源），单次默认 15 秒超时，单个 JSON 最多 32 MiB / 25000 条；提供方应响应 `signal`。坏数据或超时只影响对应来源，保留其有效缓存，不清空其他来源。

### 兼容性与安装

市场本身和 CLI 生成的市场 / 子来源默认不设置 `engines.dsh`，因此不会仅因 DSH 版本变化被本市场拦截，后续 alpha、rc 和正式版均允许尝试。必要宿主接口缺失时才报错，真实接口变化仍可能需要修复。`dshPluginHub.hostCompatibility: "capability-based"` 是本项目自定义的显式策略，不是 DSH 官方规范；`testedDshVersions` 只记录已实测版本，不作为白名单。第三方市场可能不识别该策略。第三方插件原有版本约束、Node 要求和 48 小时等待期不变。

读取 `engines.dsh`、DSH peerDependencies，以及作者已有的 `dsh.engines.dsh`、`dsh.compatibility.dsh` / `dshReleases`。声明冲突或证据不足时保留未知，预发行版本遵守 SemVer，不自动放宽。rc.1 前端内置模块有单独的已验证版本记录；不把任意开发依赖算作宿主接口。

默认发布满 48 小时才可安装，可通过市场插件配置 `minimumAgeHours` 调整。使用当前 DSH 可执行文件及 `web` profile 安装/卸载，遵守 `DSH_HOME` 或默认 `~/.dsh`，不推测 npx/pnpm 的临时缓存位置。多个操作完成后统一手动重启。目录包的刷新不要求重启。

## English

### Generate an enterprise market or source

Use the CLI examples above once the packages are available in your registry. Templates ship inside npm; generation does not fetch GitHub. Run `npm install`, `npm run build` and `npm pack` to produce the plugin entries and tarball. Your npm registry must provide build dependencies, including esbuild's platform package.

Edit `hub.config.json` and rebuild to change branding or the catalog. Generated enterprise markets read only the configured catalog; the public demo catalog may still be downloaded as a runtime dependency but is not enabled. Keep npm authentication in environment/npm configuration, outside JSON.

A source uses the target market's `market-id` and a unique `source-id`. It is an ordinary DSH plugin and can itself appear in the main catalog. Install and restart to add its tab; uninstall and restart to remove it. Source entries override same-name main entries; competing sources use descending priority then ascending source ID.

`--datasource file:./plugins.json` embeds local JSON instead. In npm mode, `--name` identifies the plugin while `--datasource npm:...` identifies its separate data package.

### Catalog contract

A data package needs `package.json` and root `plugins.json`, included in npm `files`. Publish data updates independently; refresh reads `latest` and verifies tarball integrity. The JSON example above shows required fields; documentation/troubleshooting URLs and `locales` are optional. `origin` is `internal` or `community`. Tags support the six built-in IDs above and custom lowercase IDs; card tags do not change filters. Catalog order is display order; Star counts are not displayed. Package names must be unique within each catalog.

Optional `repositoryUrl` must be HTTPS. A GitHub repository URL enables npm repository identity checks to avoid unrelated name collisions. Links open in a new window; the destination website handles authentication.

### Direct integration from other plugins (data API v1)

Existing plugins can register lists without our generator or a runtime dependency on our npm packages. This is a host-side data interface, not an HTML/React slot. The marketplace owns rendering, source tabs, deduplication and release/install checks.

The default service is `dshPluginHub_hub`; branded markets use `dshPluginHub_` plus the market ID with dashes replaced by underscores. Use optional `ctx.inject([service], scope => …)` in the same profile, check `apiVersion === 1`, then call `registerSource` as shown above. The [standalone example](../examples/custom-catalog/index.js) includes optional binding, file loading and disposal. Copy the whole `examples/custom-catalog/` directory and change its package name, patch and catalog. It has no market package dependency; `private: true` marks it as a local integration example. Optional TypeScript types are exported from `@zaimokuza/dsh-plugin-hub/provider-api` (`ProviderApi`, `CatalogSource`); a development-only dependency suffices.

- Source IDs must be unique, 1–80 lowercase letters/digits/dots/underscores/dashes, starting with a letter or digit. `displayName` is the tab label (up to 80 characters).
- For `kind: 'json'`, `getCatalog({ signal })` returns the documented JSON synchronously or asynchronously. Use your own files or data service, handling authentication privately and keeping credentials out of catalog data. For `kind: 'npm'`, set `packageName`; the market's configured registry is used.
- Optional `priority` defaults to 0, within -1000–1000. Contributors beat primary data; competing contributors sort by descending priority then ascending ID. Change optional `cacheVersion` (up to 80 characters) when data semantics or the read target changes.
- Registration triggers a read; the marketplace Refresh button reads again. Changes are not automatically pushed from the provider. Data updates need only a refresh; plugin code still follows the DSH installation/unloading lifecycle.
- Bind the returned idempotent disposer to `scope.effect`, and dispose the optional binding when its owning plugin unloads. Removing a source removes its tab/data and restores remaining duplicate entries.
- At most 20 sources including primary data, a default 15-second read timeout, and at most 32 MiB / 25000 entries per JSON source. Honor `signal`. Invalid or timed-out sources retain their last valid cache without clearing healthy sources.

### Compatibility and installation

The marketplace and CLI-generated markets/sources omit `engines.dsh` by default, so this marketplace does not block them solely for a different DSH version, including future alpha, RC and stable releases. Missing required host APIs fail at runtime; actual API changes may still require fixes. `dshPluginHub.hostCompatibility: "capability-based"` is this project’s explicit custom policy, not an official DSH standard. `testedDshVersions` records tested hosts without acting as an allowlist. Other marketplaces may not recognize this policy. Third-party version constraints, Node requirements and the 48-hour age check stay unchanged.

The marketplace reads `engines.dsh`, DSH peerDependencies and the author-declared `dsh.engines.dsh`, `dsh.compatibility.dsh` / `dshReleases` formats. Conflicts or insufficient evidence remain unknown. Prereleases follow SemVer without implicit widening. Verified rc.1 frontend module versions are tracked separately; arbitrary development dependencies are not host interfaces.

The default minimum release age is 48 hours, configurable through `minimumAgeHours`. Install/uninstall uses the running DSH executable and `web` profile, honoring `DSH_HOME` or `~/.dsh`, without guessing npx/pnpm cache paths. Restart manually after completing several operations. Catalog refreshes do not require restarting DSH.
