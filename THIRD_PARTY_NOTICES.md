# 第三方声明 / Third-party notices

本项目的 DSH 页面注册、客户端包装与 profile 集成参考了下述 MIT 项目。原始版权与许可文本保留；资源列表仅展示外部项目的元数据，不包含其代码。宿主 UI 组件由 DSH 提供。

The DSH page registration in `src/client/index.jsx`, client module-loader wrapper in `scripts/build.mjs`, and profile CLI integration approach were adapted from or informed by dsh-market/dsh-market, commit `1f7b502c0f3a62acfbf2190052e97c16eb798267`. The current resource hub retains the applicable attribution for that integration code.

Upstream: https://github.com/dsh-market/dsh-market

MIT License

Copyright (c) 2026 fkysly and dsh-market contributors

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

Runtime dependencies @modelcontextprotocol/sdk and yaml, and build dependencies esbuild and React retain their own licenses. Their precise versions are recorded in package-lock.json.

The UI consumes the host-provided `@deepseek-ai/dsh-client-ui-primitives` (Input, Button, Menu and Modal). These components and their styles are resolved from the DSH module table, not copied or bundled into this plugin.
