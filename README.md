# ST-Api-Scripts

酒馆助手 API 管理器 2.1.1 的 TauriTavern 2.4 适配版，当前版本 `2.1.1-tt2.4.5`。

## 使用

先停用旧版 API 管理器，再将 [导入文件](ST-ApiManager/酒馆助手脚本-API管理器2.1.1-TT2.4.5.json) 导入酒馆助手的脚本库并启用。也可以将原脚本的内容替换为：

```js
import 'https://cdn.jsdelivr.net/gh/kaelisvespera/ST-Api-Scripts@973bc3cc211a85c76296c98cd52f4ee7d709be49/ST-ApiManager/index-2.1.1-tt2.4.js'
```

若 jsDelivr 无法访问，可尝试镜像（发布验证时该镜像返回 521）：

```js
import 'https://cdn.jsdmirror.com/gh/kaelisvespera/ST-Api-Scripts@973bc3cc211a85c76296c98cd52f4ee7d709be49/ST-ApiManager/index-2.1.1-tt2.4.js'
```

需要 TauriTavern 2.4 和已启用的酒馆助手；这是酒馆助手脚本，不通过 TT 的原生扩展管理器安装。入口仍在 API 连接区和扩展菜单中，也保留脚本按钮及 `/st-api-manager` 命令。

## 修复

- `TT2.4.5` 取消对 TT 内部模块的动态导入和宿主 Function 导入器。密钥读写、激活改为宿主 fetch 的 `/api/secrets/read`、`write`、`rotate`；弹窗仅使用已经初始化的公开 context。避免在脚本 iframe 或另一份模块图中启动 TT。此前的宿主模块导入方案未能解决手机上的初始化错误，因此已替换。

- `TT2.4.3` 修复缓存的 `secretId` 与配置中的 Key 不一致时仍启用旧密钥的问题。TT 状态请求按原生 `secret_id` 选择密钥，仅填写设置对象中的 Key 无法替换它。现在按密钥内容的 SHA-256 指纹和原生密钥类型保存本机绑定，并核对 ID 仍存在；不把脱敏值或标签当作密钥原文。
- 同步密钥时不触发 DOM 连接事件；URL、来源、模型和密钥完整写入后，只发起一次原生连接。TT 的原生连接函数先刷新密钥状态，再构造状态请求。首次遇到无法验证的旧 ID 时，会重新登记该 Key，后续切换和刷新复用已验证绑定。

- `TT2.4.2` 修复关闭“AI 响应设置”抽屉时的应用超时；该抽屉中的 `#openai_settings` 会被 TT 的 Panel Runtime 移出 DOM，应用连接配置无需等待它。
- 应用及分类切换只写入已保存的连接配置并发起原生连接，不再强制先拉模型列表；“检测”和“发送测试消息”保留网络验证。应用成功不会虚报健康检测成功，也不会改变当前 Key 索引。
- 密钥先完成本地同步，再同步来源并发起一次原生连接。原生 Key 输入框保持空白，避免原生连接再次保存同一密钥；具体的本地错误会原样显示。
- 测试消息调用酒馆助手的 `generateRaw`，使指定的 URL、Key、模型和来源生效。
- 弹窗和密钥模块从 TT 宿主加载，避免根路径被解析到 CDN。
- 请求通过宿主的 fetch 桥发送，模型状态请求明确使用 OpenAI 兼容格式。
- 配置使用 TT 扩展存储。首次读取无存档时迁移旧浏览器配置，保留旧数据；读取失败时停止加载，避免覆盖存量。
- 同站点新增模型时，旧模型分别保留原分组，新模型进入“未分类”。保留多标签和显式批量分组操作。
- 同站点通过“添加配置”增加模型时，保留此前已有、未在新增表单勾选的模型。通过编辑表单主动取消勾选，仍可移除模型。

配置与 Key 在 TT 本地保存，仓库内不包含个人配置。扩展存档位置为 `data_root/_tauritavern/extension-store/st-api-manager/kv/main/state.json`。保存通过异步队列完成，写入失败会弹出提示；页面卸载无法保证尚未完成的写入结束。原有“账户同步”及其冲突界面保留，语义不变。

上游已接入的主要来源为自定义 OpenAI 兼容端点、OpenAI、DeepSeek 和 Google AI Studio。TT 2.4 未实现的 SubModel 不在本次支持范围内；上游下拉菜单中其余未接入来源保持原有提示。

## 验证与构建

仅需 Node.js，无需安装项目依赖：

```sh
node tools/build.cjs
node --experimental-vm-modules --test tests/*.test.cjs
```

63 项回归测试通过，覆盖旧密钥 ID 指向错误 Key、密钥被编辑或 ID 丢失、相同脱敏后缀、重复应用及刷新复用、轮换注册后恢复活跃密钥，以及原版超时复现、分组和存储迁移。配置应用集成测试读取最终构建，并运行 TT 2.4 原版 `onConnectButtonClick` 和 `getStatusOpen` 函数，验证 A→B→A 切换时每次只有一个状态请求，且原生刷新后的 `secret_id`、URL、模型及对应密钥一致。原生函数测试引用保留来源与 AGPL v3 许可证，见 `tests/fixtures/`。浏览器模拟环境验证了抽屉从 DOM 移除且模型列表请求始终不返回时，仍能切换到指定模型并发起原生连接；也已验证初始化、添加 Key、模型拉取、保存和刷新恢复。尚未在用户的真实手机 TT 2.4 安装及付费 API 上实测。

另使用已安装的 Playwright 和 Edge 运行 `node --test tests/iframe-realm.browser.cjs`：真实父页面与 iframe 复现了旧导入方式的只读属性错误；修复后普通窗口和代理窗口均能经宿主 HTTP 桥读写并激活密钥，验证未请求 TT 原生模块或访问 Function 导入器，并覆盖酒馆助手的父窗口代理。此测试使用本地模拟页面，尚不等同于手机 TT 实机验证。

界面“已写入配置”表示连接设置已保存；服务商是否可用仍以原生连接状态或主动检测为准。`src/tt-secrets.js` 保存密钥绑定与注册逻辑，`src/tt-apply-settings.js` 保存本地配置写入逻辑，`tools/create-apply-patch.cjs` 修正应用及分类切换流程。

`src/upstream-index-2.1.1.js` 保留作者发布的原始构建；`src/tt-bootstrap.js` 和 `tools/grouping-patch.cjs` 保存适配代码，构建时生成可远程 import 的单文件。

## 来源

- [原作者 samiytaa / ST-AllInOneFloatOrb](https://github.com/samiytaa/ST-AllInOneFloatOrb/blob/e5ecd8c91547b6a4cb12a59915350e6edc240f98/ST-ApiManager/index-2.1.1.js)
- [TT 2.4 扩展存储 API](https://github.com/Darkatse/TauriTavern/blob/v2.4.0/docs/API/Extension.md)
- [TT 关闭设置抽屉时的 DOM 停车逻辑](https://github.com/Darkatse/TauriTavern/blob/v2.4.0/src/tauri/main/adapters/panel-runtime/top-settings-panel-parking.js#L37)
- [酒馆助手 iframe 的只读 SillyTavern 属性](https://github.com/N0VI028/JS-Slash-Runner/blob/e71c990607f6c92127151b1f8dad6c79fa03966e/src/iframe/predefine.js#L27)
- [TT 状态请求使用原生密钥 ID](https://github.com/Darkatse/TauriTavern/blob/v2.4.0/src/scripts/openai.js#L6351)
- [TT 的 generateRaw](https://github.com/Darkatse/TauriTavern/blob/v2.4.0/src/script.js#L4891)
- [酒馆助手 GenerateRawConfig](https://github.com/N0VI028/JS-Slash-Runner/blob/e71c990607f6c92127151b1f8dad6c79fa03966e/src/function/generate/types.ts#L130)

保留上游文件中的版权与许可证标记；本仓库为适配版本，不代表原作者发布。
