# ST-Api-Scripts

酒馆助手 API 管理器 2.1.1 的 TauriTavern 2.4 适配版，当前版本 `2.1.1-tt2.4.2`。

## 使用

先停用旧版 API 管理器，再将 [导入文件](ST-ApiManager/酒馆助手脚本-API管理器2.1.1-TT2.4.2.json) 导入酒馆助手的脚本库并启用。也可以将原脚本的内容替换为：

```js
import 'https://cdn.jsdmirror.com/gh/kaelisvespera/ST-Api-Scripts@7ca4c1eb7f22483cbe0f1d111c87282f248cb711/ST-ApiManager/index-2.1.1-tt2.4.js'
```

若镜像无法访问，可改用 jsDelivr：

```js
import 'https://cdn.jsdelivr.net/gh/kaelisvespera/ST-Api-Scripts@7ca4c1eb7f22483cbe0f1d111c87282f248cb711/ST-ApiManager/index-2.1.1-tt2.4.js'
```

需要 TauriTavern 2.4 和已启用的酒馆助手；这是酒馆助手脚本，不通过 TT 的原生扩展管理器安装。入口仍在 API 连接区和扩展菜单中，也保留脚本按钮及 `/st-api-manager` 命令。

## 修复

- `TT2.4.2` 修复关闭“AI 响应设置”抽屉时的应用超时；该抽屉中的 `#openai_settings` 会被 TT 的 Panel Runtime 移出 DOM，应用连接配置无需等待它。
- 应用及分类切换只写入已保存的连接配置并发起原生连接，不再强制先拉模型列表；“检测”和“发送测试消息”保留网络验证。应用成功不会虚报健康检测成功，也不会改变当前 Key 索引。
- 密钥先完成本地同步，再触发一次来源切换。原生 Key 输入框保持空白，避免原生连接再次保存同一密钥；具体的本地错误会原样显示。
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

46 项回归测试通过，覆盖原版超时复现、抽屉关闭及空模型列表、密钥同步后仅重连一次、分组、激活模型及 Key 轮换保留、存储迁移和失败处理。浏览器模拟环境验证了抽屉从 DOM 移除且模型列表请求始终不返回时，仍能切换到指定模型并发起原生连接；也已验证初始化、添加 Key、模型拉取、保存和刷新恢复。尚未在用户的真实手机 TT 2.4 安装及付费 API 上实测。

“应用完成”表示连接设置已写入；服务商是否可用仍以原生连接状态或主动检测为准。`src/tt-apply-settings.js` 保存本地配置写入逻辑，`tools/create-apply-patch.cjs` 修正应用及分类切换流程。

`src/upstream-index-2.1.1.js` 保留作者发布的原始构建；`src/tt-bootstrap.js` 和 `tools/grouping-patch.cjs` 保存适配代码，构建时生成可远程 import 的单文件。

## 来源

- [原作者 samiytaa / ST-AllInOneFloatOrb](https://github.com/samiytaa/ST-AllInOneFloatOrb/blob/e5ecd8c91547b6a4cb12a59915350e6edc240f98/ST-ApiManager/index-2.1.1.js)
- [TT 2.4 扩展存储 API](https://github.com/Darkatse/TauriTavern/blob/v2.4.0/docs/API/Extension.md)
- [TT 关闭设置抽屉时的 DOM 停车逻辑](https://github.com/Darkatse/TauriTavern/blob/v2.4.0/src/tauri/main/adapters/panel-runtime/top-settings-panel-parking.js#L37)
- [TT 的 generateRaw](https://github.com/Darkatse/TauriTavern/blob/v2.4.0/src/script.js#L4891)
- [酒馆助手 GenerateRawConfig](https://github.com/N0VI028/JS-Slash-Runner/blob/e71c990607f6c92127151b1f8dad6c79fa03966e/src/function/generate/types.ts#L130)

保留上游文件中的版权与许可证标记；本仓库为适配版本，不代表原作者发布。
