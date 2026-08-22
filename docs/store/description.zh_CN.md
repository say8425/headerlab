# Detailed description — 简体中文 (`zh_CN`)

Paste the block below into **Store listing → Description**, with the language
dropdown set to Simplified Chinese. It is plain text: the store keeps line breaks and
renders nothing else, so the bullets and headings are literal characters.

```text
HeaderLab 使用 Chrome 自带的 declarativeNetRequest 引擎，在你选择的站点上设置、追加和删除 HTTP 请求与响应头。

安装时它什么都不索取。清单恰好请求两项权限 —— "storage" 和 "declarativeNetRequestWithHostAccess" —— 完全不请求任何主机访问权限。只有当你在写着该站点名字的那一行上按下 Grant（授权）之后，该站点才能被修改，而你随时可以在 Chrome 中撤销该授权。

【它做什么】

• 对请求侧或响应侧的任意头部进行设置、追加或删除。
• 按站点限定范围。站点按主机匹配，所以添加站点时端口或路径会被丢弃 —— 弹窗显示的就是真正走上链路的东西。
• 应用到所有站点是一个显式模式，而不是一个空的站点列表。这个模式的代价是对所有站点的访问权限，而开关本身不会去索取：索取的是单独的一个 Grant 按钮，在你按下它之前，那一行会明说。
• 按请求类型过滤。Chrome 资源类型中的八种，各自一个复选框。main_frame 默认开启，因为 Chrome 自己的默认值会悄悄把它排除掉。
• 一个开关暂停全部。工具栏图标随之变灰，浏览器重启之后依然是灰的。
• 跟随你操作系统的浅色或深色设置，在首次绘制之前完成。

【没有沉默的失败】

任何会阻止规则生效的原因，都会写在该规则自己那一行上，并计入 Rules 标题旁的读数 —— 缺失的权限、无法使用的主机名、Chrome 会拒绝的头部名称。

这个读数不会自我美化。一条规则如果只限定在你尚未授权的主机上，就会被计为 blocked（受阻），绝不会被计为 live（生效），而那些仍在等待的主机会列在旁边。

这比听起来更重要。Chrome 是整体接受或拒绝规则集，而不是逐条接受或拒绝，所以一条有问题的规则会连带停掉其余所有规则。HeaderLab 会点名是哪一行，并说明应当改用什么。

【它不做什么】

• 没有网络调用。没有分析，没有遥测，没有远程配置，没有更新 ping。
• 没有内容脚本。不向任何页面注入任何东西，扩展也从不接收页面的内容。
• 没有远程代码。不从扩展程序包之外获取或执行任何东西。
• 没有外部资源。没有 CDN，没有网络字体，没有远程图片。
• 没有任何东西离开你的机器。你的规则保存在 Chrome 自己的扩展存储里。

源代码是公开的，所以以上每一条都不必凭信任接受：
https://github.com/say8425/headerlab

【可选：从终端驱动它】

有一个独立的、可选的命令行工具可以替你应用规则变更 —— 如果你更愿意打字而不是点击，或者想让 AI 编码助手在工作过程中设置某个请求头，它会很有用。你在弹窗里打开它的开关之前，它一直是关闭的；它需要一个由你自己安装的辅助程序；而且它只通过你自己机器上的本地套接字通信，不走网络。只要不碰那个开关，这一切就都不会运行。

开源，Apache-2.0。
```

## How this was produced

Translated from [`description.en.md`](description.en.md), then reviewed against
the English source and revised — 15 issues were raised on this
locale and applied. Terminology follows [`../README.zh.md`](../README.zh.md),
the project's own README in this language, so a reader arriving from the
repository meets the same words.

`tests/unit/storeListing.test.ts` holds the structure to the English source:
the same number of bullets in the same order, every verbatim token intact, and
no Markdown that would render as literal junk in the store. Edit the prose
freely; that test is what stops an edit quietly breaking the shape.

**The English file is the source.** If a claim changes, change
`description.en.md` first and bring the five into line from there — five
descriptions making four different promises about the same extension is the
failure this ordering exists to prevent.
