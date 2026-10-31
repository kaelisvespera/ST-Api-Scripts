# ST-Api-Scripts

基于 samiytaa 的 API 管理器 2.1.1，适配为 **SillyTavern / TauriTavern 2.4 原生前端扩展**。当前版本 `2.1.1-tt2.4.6`，无需酒馆助手。实现说明见 [架构与实现](docs/架构与实现.md)。

本版已通过 76 项 Node 回归测试与 2 项 Edge 浏览器测试；手机端实际安装和服务商连接结果待用户验证。

## 安装与升级

1. 先停用旧的 API 管理器酒馆助手脚本，保留原配置。
2. 打开酒馆的扩展管理页，选择安装扩展，填入仓库地址：

   ```text
   https://github.com/kaelisvespera/ST-Api-Scripts
   ```

3. 安装后刷新页面；手机 TT 可完整退出后重新打开。
4. 从 API 连接区或扩展菜单打开管理器，也可使用 `/st-api-manager` 命令。

TT 沿用旧脚本的 `st-api-manager/state` 存档，已有站点、模型、分组、多个 Key 和轮换位置会在原位置读取。升级时保留旧配置，避免同时启用旧脚本和原生扩展。

根目录的 `manifest.json`、`index.js` 和 `vendor/` 是原生安装所需文件。`ST-ApiManager/` 下的五个 JSON 仍固定到 TT2.4.5 的历史脚本提交，保留用于兼容记录；新安装使用上面的仓库地址。

## 功能与本次改动

- 保留原管理器的站点及模型管理、分组、多 Key、生成前轮换、检测、测试消息和账户同步。
- 原生扩展直接使用宿主公开 context 和事件总线，本地加载 Vue 3.5.22 与 Zod 3.23.8，无需酒馆助手注入变量，也不复制整页宿主样式。
- 应用配置时先同步密钥，再写入来源、端点和模型，最后发起一次原生连接；关闭设置抽屉、模型列表为空或模型接口无响应时仍可应用已保存的配置。
- 同步自定义模型输入框与下拉选择，修复下拉框异步处理把新模型改回旧模型的问题；非自定义来源不会写入其他来源的模型控件。
- 密钥按内容指纹与原生类型绑定 `secret_id`，核对缓存 ID 是否仍存在。普通 ST 在密钥写入或激活后刷新宿主密钥状态；TT 使用现有 HTTP 桥和原生连接流程。
- 测试消息通过宿主生成接口使用所选来源、模型、端点和 `secret_id`；已有活跃密钥会在登记测试 Key 后恢复。生成前轮换通过公开 `CHAT_COMPLETION_SETTINGS_READY` 事件写入本次请求的 ID。
- 同站点添加模型时保留旧模型及其各自分组，新模型进入未分类；编辑表单仍允许主动取消模型。

主要已接入来源为自定义 OpenAI 兼容端点、OpenAI、DeepSeek 和 Google AI Studio。TT 2.4 未实现的 SubModel 暂不支持。

## 数据保存

TT 使用 `extension.store`，存档位于 `data_root/_tauritavern/extension-store/st-api-manager/kv/main/state.json`。普通 ST 使用 `SillyTavern.getContext().extensionSettings['st-api-manager']` 并调用 `saveSettingsDebounced()` 保存。首次没有扩展存档时读取已知的旧浏览器配置键，保留浏览器原值；TT 存档读取失败会停止初始化。

配置包含 Key，保存在用户的酒馆数据中。账户同步功能保留原有语义；仓库不包含个人配置。TT 写入通过异步队列完成，退出前仍在等待的写入应先完成；普通 ST 的实际落盘由宿主设置保存流程处理。

“已写入配置”表示本地连接设置已保存；服务商是否可用，以原生连接状态、检测或测试消息结果为准。

## 构建与验证

构建及 Node 回归测试只需 Node.js：

```sh
node tools/build.cjs
node --experimental-vm-modules --test tests/*.test.cjs
```

构建同时生成根目录原生扩展 `index.js` 和 `ST-ApiManager/index-2.1.1-tt2.4.js` 兼容脚本。前者使用本地 `vendor/`，历史 JSON 中固定的提交保持不变。

76 项 Node 回归测试和 2 项 Edge 浏览器测试通过。测试覆盖存储、分组、密钥绑定、应用顺序、原生请求和原生扩展适配。真实 Edge 已运行完整原生 bundle，验证菜单打开、配置应用、测试消息、轮换与 TT 数据读取；旧 iframe 兼容测试也已通过。浏览器测试使用本地宿主及 API fixture，手机 TT 和真实服务商连接仍待实测。

在已安装 Playwright 与 Edge 的环境中，可继续运行：

```sh
node --test tests/native-extension.browser.cjs tests/iframe-realm.browser.cjs
```

## 来源与许可证

- [原作者 samiytaa / ST-AllInOneFloatOrb](https://github.com/samiytaa/ST-AllInOneFloatOrb/blob/e5ecd8c91547b6a4cb12a59915350e6edc240f98/ST-ApiManager/index-2.1.1.js)
- [SillyTavern 原生前端扩展文档](https://docs.sillytavern.app/for-contributors/writing-extensions/)
- [TT 2.4 扩展存储 API](https://github.com/Darkatse/TauriTavern/blob/v2.4.0/docs/API/Extension.md)
- Vue 3.5.22 与 Zod 3.23.8 的 MIT 许可证分别保存在 [Vue-LICENSE](vendor/Vue-LICENSE)、[Zod-LICENSE](vendor/Zod-LICENSE)。
- 上游原始构建和 TT 原版函数测试引用保留各自版权与许可证，见 `src/upstream-index-2.1.1.js`、`tests/fixtures/`。

本仓库为适配版本，不代表原作者发布。
