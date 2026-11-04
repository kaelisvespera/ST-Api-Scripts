# ST-Api-Scripts

SillyTavern（ST）与 TauriTavern 2.4（TT）的 API 配置管理器。本文对应 **2.2.4**。

## 使用

原生扩展通过酒馆的「扩展 → 安装扩展」安装，地址为 [kaelisvespera/ST-Api-Scripts](https://github.com/kaelisvespera/ST-Api-Scripts)。升级时先停用旧 API 管理器脚本，再刷新酒馆。原有配置无需删除。打开入口在扩展菜单和 API 连接区，也可使用 `/st-api-manager`。

- 主面板沿用 API 管理、标签设置、筛选、检测和数据工具栏，配置按标签折叠展示。通过「API 管理」可新增或编辑一个站点的多把 Key 和多个模型。
- 「拉取模型」使用表单当前选中的 Key，未选时用列表第一把。每把 Key 各有模型列表，可多选模型并为每条配置选标签。同 URL、同模型下的不同 Key 独立保存。站点若限制跨域访问，可手动填写模型。
- 在密钥掩码下方填写「密钥备注」，在各个模型 ID 下方填写「模型备注」。例如给一把 Key 写「CCMAX」，再给它下面的某个模型写「0.5/次」。同一配置组内同一条密钥记录的模型共享密钥备注，每条模型各自保存模型备注。清空后点「保存」可移除备注。旧「条目备注」仍可在单条编辑中使用。
- 卡片第一层显示模型，第二层显示当前组名、备注和操作。点模型名可查看完整内容和原条目标题。「应用」直接切换到该条目的连接，编辑、分组和删除位于「⋯」菜单。
- 「标签设置」可按当前组名、模型 ID、原条目标题和两级备注搜索。同组同名模型会显示 Key 序号，便于选中对应密钥的条目。
- 「检测」和「发送测试消息」直接请求指定站点。测试消息需要先选定表单中的 Key 和模型。
- 导入可选择合并或替换，支持旧版数组和分组导出。账户冲突时可以使用账户数据、使用本机数据、合并或取消。合并保留独立副本，可选同名标签的颜色。导出文件和账户存档包含密钥，请按私有资料保存。

2.2.2 移除了编辑页的 Key 轮换开关和聊天时自动换 Key。配置编辑、导入、同步和模型拉取只管理目录。

## 数据与验证

旧站点、分组和密钥池按独立条目迁移。原始存档和旧账户快照保留，可用于回退；新版编辑不会写回旧快照。实现和恢复方式见 [架构与实现](docs/架构与实现.md)。

```sh
node tools/build.cjs
node --experimental-vm-modules --test tests/*.test.cjs
node --test tests/native-extension.browser.cjs tests/iframe-realm.browser.cjs
```

本地通过 29 项 Node 回归和 9 项 Edge 浏览器测试。浏览器验收使用 ST、TT 和旧 TT iframe 的隔离夹具，覆盖 320px 手机、平板、横屏和桌面视口。手机和真实服务商尚待实测。原生安装无需酒馆助手，五个旧导入 JSON 对应历史脚本版本。

## 来源与许可证

本项目源自 [samiytaa 的 API 管理器 2.1.1](https://github.com/samiytaa/ST-AllInOneFloatOrb/blob/e5ecd8c91547b6a4cb12a59915350e6edc240f98/ST-ApiManager/index-2.1.1.js)。2.2.0 的构建使用独立的管理器源码。仓库保留历史依赖的 [Vue MIT 许可证](vendor/Vue-LICENSE)、[Zod MIT 许可证](vendor/Zod-LICENSE) 及 `tests/fixtures/` 中的 TT 和 jQuery 许可证。
