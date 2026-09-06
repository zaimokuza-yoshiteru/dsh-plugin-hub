# @zaimokuza/dsh-plugin-hub-source-demo

演示子来源插件，为默认市场添加 Zaimokuza 标签页。它本身也收录在主市场目录中；目录内容来自独立 npm 数据包。

Demo source plugin adding a Zaimokuza tab to the default market. It is itself listed in the main catalog and reads a separate npm data package.

说明与示例 / Guide: https://github.com/zaimokuza-yoshiteru/dsh-plugin-hub#readme

目录中的第三方插件不等于经过运行验证。 / Catalog inclusion does not mean third-party plugins were runtime-tested.

默认不按 DSH 版本号拦截（包括预发行版），依赖必要宿主接口；已实测版本见 package.json 的 `dshPluginHub.testedDshVersions`。

No DSH version gate, including prereleases; required host APIs must remain available. Tested versions are recorded in package.json under `dshPluginHub.testedDshVersions`.
