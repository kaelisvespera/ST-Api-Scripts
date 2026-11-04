# ST-Api-Scripts

SillyTavern（ST）与 TauriTavern 2.4（TT）的 API 配置管理器。当前版本为 **2.2.0**。

## 使用

原生扩展通过酒馆的「扩展 → 安装扩展」安装，地址为 [kaelisvespera/ST-Api-Scripts](https://github.com/kaelisvespera/ST-Api-Scripts)。升级时先停用旧 API 管理器脚本，再刷新酒馆。原有配置无需删除。打开入口在扩展菜单和 API 连接区，也可使用 `/st-api-manager`。

- 每条配置记录一个站点、一把密钥和一个模型。同 URL、同模型的不同密钥可以各自编辑，也可以放入不同分组。新增时可以为一把密钥填写多个模型，每行生成一条配置。
- 点击「管理分组」创建分组，在新增或编辑配置时勾选，可选多个。分组筛选只影响列表；删除分组时保留其中的配置。
- 「拉取模型」使用表单里的 URL 和密钥。选择模型、保存后才更新目录。支持 OpenAI 兼容、OpenAI、DeepSeek 和 Google AI Studio 模型列表；站点若不允许跨域访问，可手动填写模型。
- 导入以合并方式保留现有配置，可读取旧版数组和分组导出。同一条目或分组的两个版本有冲突时，会保留独立副本。再次导入同一版本会沿用原副本。需要账户同步时先点「从账户读取」，核对合并后的目录，再点「同步到账户」。导出文件和账户存档包含密钥，请按私有资料保存。

2.2.0 已移除单条应用、分类轮切、聊天前自动换 Key、连接检测和测试消息。管理器只保存自己的目录，聊天连接仍在酒馆原生设置中管理。

## 数据与验证

旧站点、分组和密钥池按独立条目迁移。原始存档和旧账户快照保留，可用于回退；新版编辑不会写回旧快照。实现和恢复方式见 [架构与实现](docs/架构与实现.md)。

```sh
node tools/build.cjs
node --experimental-vm-modules --test tests/*.test.cjs
node --test tests/native-extension.browser.cjs tests/iframe-realm.browser.cjs
```

2.2.0 通过 19 项 Node 测试和 3 项 Edge 浏览器测试。浏览器使用 ST、TT 和旧 TT iframe 的隔离宿主夹具。手机和真实服务商尚待实测。原生安装无需酒馆助手，五个旧导入 JSON 对应历史脚本版本。

## 来源与许可证

本项目源自 [samiytaa 的 API 管理器 2.1.1](https://github.com/samiytaa/ST-AllInOneFloatOrb/blob/e5ecd8c91547b6a4cb12a59915350e6edc240f98/ST-ApiManager/index-2.1.1.js)。2.2.0 的构建使用独立的管理器源码。仓库保留历史依赖的 [Vue MIT 许可证](vendor/Vue-LICENSE)、[Zod MIT 许可证](vendor/Zod-LICENSE) 及 `tests/fixtures/` 中的 TT 和 jQuery 许可证。
