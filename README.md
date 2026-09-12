# DSH Plugin Hub

DSH 原生资源面板，当前版本 **0.2.0**。支持 Web 与 Desktop、中英文界面；从侧边栏打开，保留当前会话。

- **Skill**：搜索、按工作区筛选、启停、打开目录，使用 DSH 原生 Markdown 组件预览正文。
- **MCP**：JSON/YAML 配置编辑与格式化、环境变量引用、字段帮助、启停、重连、独立连接测试和删除。
- **Plugin**：查看当前 profile 的非官方原生插件，展示版本与来源；桌面端提供原生管理窗口入口说明。
- **实验性功能**：管理 Agent Teams；Web 支持安装与启停，Desktop 通过原生管理窗口操作。

## 安装

```sh
dsh plugin --profile <当前-profile> add @zaimokuza/dsh-plugin-hub
```

重启 DSH 后打开 Plugin Hub。Desktop 从自身的 **Desktop Plugins** 窗口安装。

要求 Node.js `^22.19.0 || >=24.0.0`；已验证 DSH `0.1.5-rc.1` 与 `0.1.5-rc.2`。

## 使用说明

所有管理操作绑定当前实例的 profile。Skill 启停不会修改共享文件；MCP 删除会移除 Hub 创建的配置或当前 profile 中独立的 YAML 定义，共享文件或安装包中的定义需在来源处删除。

MCP 的描述、版本和图标来自服务初始化信息。宿主未公开持续连接状态时显示“未知”，独立连接测试单独显示结果。建议在启动 DSH 时设置凭据环境变量，在 YAML 中通过 `!!js process.env.MCP_TOKEN` 引用；JSON 等价写法为 `{ "__jsExpr": "process.env.MCP_TOKEN" }`。

目录操作作用于运行 DSH 的电脑。Desktop 原生管理窗口使用 macOS `Cmd+,`、Windows `Ctrl+,` 或系统菜单 **Desktop Plugins**。更多实现边界见 [原生资源说明](https://github.com/zaimokuza-yoshiteru/dsh-plugin-hub/blob/main/docs/native-resources.md)。

## 开发与发布

```sh
npm ci
npm run check
# 可选：对已安装的原生 DSH 运行隔离 profile 集成检查
DSH_TEST_ROOT=/absolute/path/to/dsh-runtime npm run verify:native
```

单包结构：`src/` 为源码，`tests/` 为测试，`scripts/` 为构建与发布工具。`npm run check` 执行测试、构建、打包及离线安装验证；CI 覆盖 Linux、macOS 与 Windows。

本地预览、测试记录、调研资料、缓存和发布产物统一放在被 Git 忽略的 `.local/`；`lib/` 是构建结果，不提交。npm 仅包含运行时代码、浏览器构建及必要元数据。发布从 GitHub Actions 的 **Publish npm** 工作流触发，开启 `publish` 后发布到 npm。
