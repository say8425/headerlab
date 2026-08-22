# Detailed description — 简体中文 (`zh_CN`)

Paste the block below into **Store listing → Description**, with the language
dropdown set to Simplified Chinese. It is plain text: the store keeps line breaks and
renders nothing else, so the bullets and headings are literal characters.

```text
HeaderLab 使用 Chrome 自带的 declarativeNetRequest 引擎，在你选择的站点上设置、追加和删除 HTTP 请求与响应头。在你授权之前，它对任何站点都没有访问权限。

【它做什么】

• 对请求侧或响应侧的任意头部进行设置、追加或删除。
• 按站点限定范围。站点按主机匹配，所以弹窗显示的就是真正走上链路的东西。
• 应用到所有站点，这是一个显式模式。它需要对所有站点的访问权限，而开关本身不会去索取 —— 索取的是单独的一个 Grant 按钮。
• 按请求类型过滤。Chrome 资源类型中的八种，各自一个复选框，其中包括被 Chrome 自己的默认值悄悄排除掉的 main_frame。
• 一个开关暂停全部。工具栏图标随之变灰，浏览器重启之后依然是灰的。

【用 AI 编码代理驱动它】

HeaderLab 附带一个可选的命令行工具，以及一个面向 Claude Code 和 Codex 的技能，所以代理可以在干活的过程中读取和修改你的头部规则。用你自己的话说就行 —— 加一个 X-Debug 头并把范围限定到 staging.example.com，别再往 API 发 Referer —— 结果会出现在弹窗里，和你自己敲进去一模一样。

这并不会让你失去控制权：在你于弹窗中打开它的开关之前，桥接一直是关闭的；工具既不能自己打开开关，也不能授予站点访问权限 —— 这两件事 Chrome 只从你本人的点击中接受 —— 而且它只走本地套接字通信，不走网络。

【它不做什么】

• 没有网络调用。没有分析，没有遥测，没有远程配置，没有更新 ping。
• 没有内容脚本。不向任何页面注入任何东西，扩展也从不查看页面的内容。
• 没有远程代码，没有 CDN，没有网络字体，没有远程图片。不从扩展程序包之外获取任何东西。
• 没有任何东西离开你的机器。你的规则保存在 Chrome 自己的扩展存储里。

https://github.com/say8425/headerlab

开源，Apache-2.0。
```

## How this was produced

Translated from [`description.en.md`](description.en.md). The first version was
reviewed against the English source and revised — 15 issues were raised on this
locale and applied.

**The 2026-08-22 rewrite did not go through that reviewer stage.** It was
translated straight from the new English, in the same pass that wrote it, so
this file is worth a proofread before it is pasted into the dashboard — the
structural guard below cannot read meaning. Terminology follows
[`../README.zh.md`](../README.zh.md), the project's own README in this language, so a
reader arriving from the repository meets the same words.

`tests/unit/storeListing.test.ts` holds the structure to the English source:
the same number of bullets in the same order, every verbatim token intact, and
no Markdown that would render as literal junk in the store. Edit the prose
freely; that test is what stops an edit quietly breaking the shape.

**The English file is the source.** If a claim changes, change
`description.en.md` first and bring the five into line from there — five
descriptions making four different promises about the same extension is the
failure this ordering exists to prevent.
