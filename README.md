# DSH Plugin Hub

[English](#english)

面向 DeepSeek Harness 的可配置插件市场。团队维护独立的 npm 目录数据包，用户在 DSH 中发现、安装和卸载插件；CLI 可直接生成企业市场与子来源项目，无需访问本仓库。

- DSH 原生组件，中英文界面，可配置标题、副标题与主色。
- 全部插件、已安装与子来源标签页；按包名去重，子来源优先。
- 按 npm 发行信息检查声明兼容性与 48 小时等待期；支持批量安装后手动重启。
- 可选介绍文档与 troubleshooting 链接；目录读取失败时保留有效缓存。
- 其他插件可通过公开 `registerSource` 接口直接提供列表，无需使用子来源生成器，见[接入规范](docs/guide.md#其他插件直接接入数据扩展接口-v1)。

![中文市场](docs/images/market-zh.png)
![子数据源](docs/images/source-zh.png)
![已安装的子来源插件](docs/images/installed-zh.png)

## 包结构

所有包使用 `@zaimokuza` scope。`-demo` 代表演示目录或演示来源，不代表安装操作是模拟的。

| 包名（省略 scope） | 职责 |
| --- | --- |
| `dsh-plugin-hub` | 可安装的市场插件与可复用运行时 |
| `create-dsh-plugin-hub` | 企业市场 / 子来源生成器与构建器 |
| `dsh-plugin-hub-catalog-demo` | 固定公共目录 JSON 快照，独立发布 |
| `dsh-plugin-hub-source-demo` | 添加 Zaimokuza 标签页的子来源插件，也在主目录中展示 |
| `dsh-plugin-hub-source-catalog-demo` | ACP Adapter 与 Theme Library 的独立目录 JSON |

## 安装与使用

以下命令在 npm 首次发布完成后可用。运行要求：Node `^22.19.0 || >=24.0.0`，首版验证宿主为 DSH `0.1.2-rc.1`。

```sh
dsh plugin --profile web add @zaimokuza/dsh-plugin-hub
# 可选：也可以在市场页面安装这个子来源
dsh plugin --profile web add @zaimokuza/dsh-plugin-hub-source-demo
```

手动重启 DSH，进入 **设置 → Plugin Hub**。下载和安装使用当前市场配置的 npm/Nexus 仓库；企业部署请用 CLI 指定自己的目录包与 registry，见[使用与目录规范](docs/guide.md)。

市场自身及生成项目默认不按 DSH 版本号拦截（包括未来预发行版）；必要接口缺失时会报错。已实测版本仅作记录，不限制新版尝试。第三方插件仍按其声明检查。

公共目录是演示快照，不是官方认证或运行测试清单。兼容性未知不等于不兼容；符合版本与时间条件也不保证内网仓库已经放行。第三方说明保留作者原文，目录可用 `locales` 提供翻译。

## 本地构建与测试

```sh
npm ci
npm run check                 # 测试、构建、打包与离线验证
```

MIT；保留的[第三方声明](packages/marketplace/THIRD_PARTY_NOTICES.md)说明来源与许可证。

## English

A configurable plugin marketplace for DeepSeek Harness. Teams publish independent npm catalog packages; users discover, install and uninstall plugins inside DSH. The CLI generates enterprise markets and source plugins without fetching this repository.

- Native DSH controls, Chinese/English UI and configurable branding.
- All plugins, Installed and source tabs; source entries override duplicate package names.
- npm compatibility declarations and a 48-hour release-age check; install several plugins before restarting manually.
- Optional documentation/troubleshooting links and last-known-good catalog caching.
- Existing plugins can contribute lists through the public `registerSource` API without our generator; see the [integration guide](docs/guide.md#direct-integration-from-other-plugins-data-api-v1).

![English marketplace](docs/images/market-en.png)

The five packages above separate runtime, generator, main demo catalog, demo source plugin and its catalog. `-demo` identifies sample content: installation actions are real. The source plugin is itself listed in the main catalog.

After the first npm release, use the installation commands above, restart DSH and open **Settings → Plugin Hub**. Requirements: Node `^22.19.0 || >=24.0.0`; the first release is verified on DSH `0.1.2-rc.1`. For enterprise registry configuration and CLI examples, read the bilingual [guide](docs/guide.md).

The marketplace and generated projects do not gate DSH by version, including future prereleases; missing required APIs fail at runtime. Tested versions are recorded, not used as an allowlist. Third-party declarations remain enforced.

The public catalog is a static demo snapshot, not official certification or runtime testing. Unknown compatibility is not proof of incompatibility. Eligibility cannot guarantee Nexus availability. Third-party copy stays author-owned; catalogs can provide translations through `locales`.

Run `npm ci` and `npm run check` to test, build, pack and verify the tarballs offline.

MIT; see the [third-party notices](packages/marketplace/THIRD_PARTY_NOTICES.md).
