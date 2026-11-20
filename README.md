# 问题钉 · dsh-question-pin

读长回答的时候，你问过的那个问题会一直悬浮在回答旁边。

> Roll through a long reply and you still know what you asked.

## 它做什么

- 在会话里往下滚，回答右侧会出现一张小卡片，内容是**当前这段回答对应的那个问题**——完整原文，不是截断的预览。
- 滚动时卡片自动换成你正读到的那一段所回答的问题。
- 卡片默认最多显示三行；更长的问题在卡片内部用细滚动条翻看，卡片高度不会影响正文。
- 卡片上有三个按钮：
  - **回到这个问题**：把那一轮问题滚回屏幕中间；
  - **复制问题**：把完整问题复制到剪贴板；
  - **收起**：收成一个小钉，只留序号。
- 卡片不占正文空间、不随内容滚动；鼠标放在卡片上滚滚轮，卡片内容先滚，到边界后滚动交给聊天，不会卡住滚动。
- 问题里的换行会保留；消息行上的时间、操作按钮等界面文字不会混进卡片。

## 细节

- 只用 DSH 客户端公开的 slot（`conversation.input.overlay`）与行注解（`data-chat-anchor-key` / `data-chat-turn` / `data-conversation-scroll`），不覆盖任何自带 UI。
- 卡片挂在 `document.body` 上（`position: fixed`），不会被消息流的滚动容器裁掉。
- 颜色全部取自 DSH 主题 token（`--dsw-alias-*`），浅色/深色自动跟随；卡片高度上限按 DSH 正文字号计算，不会切掉半行。
- 窗口太窄放不下正文旁边时，卡片自动改为贴右侧边缘；高度不足时最多只占屏幕一半。
- 没有新增任何全局快捷键，也不会抢聊天输入框的焦点。

## 安装

要求 DSH `>= 0.2.0-rc.1`，Node `^22.19.0 || >=24.0.0`。

从 GitHub 安装：

```
dsh plugin --profile web add github:KakuKevin28/dsh-question-pin
```

从本地目录安装：

```
plugin_manager install_bundle  <本目录绝对路径>
```

装好后在「插件」页启用即可，插件名显示为「问题钉」。

## 结构

| 文件 | 作用 |
| --- | --- |
| `index.js` | host 半边：无 host 行为，只为 bundle 提供注册入口 |
| `client.js` | 全部逻辑：slot 注册、滚动探测、悬浮卡片 |
| `cordis.patch.yml` | bundle 装载这一个插件 |
| `locale/zh.json` / `locale/en.json` | 插件列表里的中文/英文名称与简介 |
| `icon.svg` | 插件列表图标 |

## English

While you scroll through a long answer, the question you asked stays pinned next to it — the full original question, not a truncated preview.

- Follows your reading position: it always shows the question that the visible part of the answer is replying to.
- Three lines by default; longer questions scroll inside the card with a thin, theme-aware scrollbar.
- Buttons: jump back to that question, copy it, or collapse to a small numbered pin.
- Pure addition: it uses the public `conversation.input.overlay` slot and chat row attributes, never replaces built-in UI.
- Colors come from DSH theme tokens, so light and dark mode follow automatically.

Install:

```
dsh plugin --profile web add github:KakuKevin28/dsh-question-pin
```

## 授权

MIT，见 [LICENSE](LICENSE)。