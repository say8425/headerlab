# HeaderLab

[English](../README.md) | [한국어](README.ko.md) | [日本語](README.ja.md) | 中文 | [Español](README.es.md)

在 Chrome 中添加、修改和删除 HTTP 请求与响应头。在你授权之前，它不持有任何站点访问权限。

[![CI](https://github.com/say8425/headerlab/actions/workflows/ci.yml/badge.svg)](https://github.com/say8425/headerlab/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/headerlab?logo=npm&logoColor=%23CC3534&color=%23CC3534)](https://www.npmjs.com/package/headerlab)
[![Chrome MV3](https://img.shields.io/badge/Chrome-MV3-4285F4?style=flat&logo=googlechrome&logoColor=white)](https://developer.chrome.com/docs/extensions/reference/api/declarativeNetRequest)
[![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=flat&logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue)](#许可证)

ModHeader 的替代品。ModHeader 于 2026 年 7 月因被发现内置隐藏追踪器而从 Chrome 应用商店
下架。这就是本项目存在的全部理由，也是下面的信任准则是硬性约束而非功能清单的原因。

| 浅色 | 深色 |
|---|---|
| ![浅色主题下的 HeaderLab 弹窗：四条规则中三条生效，两个已授权站点，四条头部规则](screenshots/popup-light.png) | ![同一弹窗的深色主题，跟随操作系统设置](screenshots/popup-dark.png) |

## 安装

没有 Chrome 应用商店条目。下载最新
[发布](https://github.com/say8425/headerlab/releases)附带的 zip 并解压，或者自己构建：

```bash
corepack enable          # pnpm 来自 package.json 的 packageManager 字段
pnpm install
pnpm build               # → .output/chrome-mv3
```

然后打开 `chrome://extensions`，开启**开发者模式**，选择**加载已解压的扩展程序**，
并指向该目录。仅支持 Chrome —— 参见[限制](#限制)。

### CLI

```bash
npm i -g headerlab
```

这会把 `headerlab` 放到你的 PATH 上，用于从终端驱动扩展 —— 参见
[代理桥接](#代理桥接)。由于该包没有任何运行时依赖，它也可以直接从克隆仓库运行，无需任何
安装步骤：`node packages/headerlab/bin/headerlab.mjs`。不过上面那一行才是普通用户的用法，
克隆是贡献者做的事，两者的顺序是刻意如此。

### 代理技能

`packages/plugin` 把 CLI 打包成面向 Claude Code 与 Codex 的技能，由一个 `skills/` 目录树
配两份清单构成。两者都未发布到任何目录服务，因此都从本仓库安装：

```bash
# Claude Code
claude plugin marketplace add say8425/headerlab
claude plugin install headerlab@headerlab

# Codex
codex plugin marketplace add say8425/headerlab
```

技能会在自身内容抵达模型之前先运行 `command -v headerlab`，这样「CLI 不存在」是作为一个
事实到达的，而不是任务中途的意外。**在桥接被打开之前，它会报告 `bridge-off`。** 全局安装
CLI 并非前提条件：插件自带指向 `packages/headerlab` 的 shim。同时执行 `npm i -g headerlab`
也不冲突 —— PATH 会优先解析全局副本。

## 它做什么

- 对**请求**侧或**响应**侧的任意头部进行**设置、追加或删除**。`append` 被 Chrome 限制在
  请求头的 21 项白名单内，HeaderLab 会点名落在名单之外的规则 —— 这比听起来更重要，因为
  Chrome 是整体拒绝规则集而非逐条拒绝，所以一条这样的规则会连带停掉其余所有规则。
- **按站点限定范围。** 站点按主机匹配：你输入的端口或路径会被丢弃，而存下来的值就是实际
  生效的值，所以侧栏显示的就是真正走上链路的东西。
- **应用到所有站点**是一个显式模式，而不是一个空的站点列表。它需要 `<all_urls>`，但开关
  本身不会去索取 —— 索取的是旁边的 Grant 按钮。
- **按请求类型过滤** —— Chrome 的八种资源类型，可逐项勾选。`main_frame` 默认开启，因为
  DNR 自己的默认值会悄悄把它排除掉。
- 一个开关**暂停全部**。工具栏图标随之变灰，并在 Service Worker 唤醒时重新应用。
- **跟随系统主题**，浅色或深色，在首次绘制之前完成。

权限是按站点、在写着该站点名字的那一行上请求的 —— 绝不会作为输入主机名或拨动开关的副作用
被请求。在你按下 **Grant** 之前，那一行是琥珀色的，并且明说：

![internal.example.com 的站点行处于待授权的琥珀色状态，带有 Grant 按钮](screenshots/popup-permission.png)

任何会阻止规则生效的原因，都会写在该规则自己那一行上，并计入侧栏。下图中第二条规则要求
Chrome 对一个它不会追加的请求头执行 `append` —— 该行说明是哪一个以及应当改用什么，读数
显示 **2 of 4 rules live · 1 off · 1 blocked**，并且没有任何元素为这条消息挪位：

![规则列表中第二行在值的位置以红色显示 "Use Set. Chrome does not append request headers."，侧栏读作 2 of 4 rules live, 1 off, 1 blocked](screenshots/popup-blocked.png)

<sub>截自加载进 Chrome 的真实生产构建。唯一改动的是清单文件，用于预先授权两个示例主机，
否则无法在没有原生权限对话框的情况下拍到已授权状态。</sub>

## 信任准则

- **安装时不含任何主机权限。** 清单的 `permissions` 恰好只有 `storage` 和
  `declarativeNetRequestWithHostAccess`。它还声明了 `optional_host_permissions:
  ["<all_urls>"]`，但这本身不授予任何东西 —— Chrome 拒绝让扩展请求它从未声明过的来源，
  所以那一行是让运行时的 Grant 按钮合法，而不是让它变得多余。站点访问由你在运行时逐个主机
  授予，并可随时在 Chrome 中撤销。
- **没有网络调用。** 没有分析、遥测、远程配置或更新 ping。发布的产物从不*调用*网络原语，
  而且你可以自己验证，而不必相信：

  ```bash
  pnpm build
  grep -rE 'fetch\(|XMLHttpRequest|WebSocket|sendBeacon' .output/chrome-mv3
  ```

  它不会返回任何结果。这个模式刻意只匹配调用与构造形式：如果只是忽略大小写地搜索那几个
  单词，在产物里大约会命中十四次，而每一次都是字符串或标识符而非调用 —— React DOM 的
  `prefetchDNS`、`fetchPriority` 和 `dns-prefetch`，以及字面量 `"xmlhttprequest"` 和
  `"websocket"`，后两者是 Chrome declarativeNetRequest 的资源类型名，出现在这里是因为
  你可以在弹窗中按它们过滤。写在这里，是为了让你发现它们时读作「意料之中」而不是「抓到
  一个谎」。
- **没有内容脚本。** 不向任何页面注入任何东西。头部由 Chrome 的 `declarativeNetRequest`
  引擎修改，该引擎从不把请求内容交给扩展。
- **没有外部资源。** 没有 CDN，没有网络字体，没有远程图片。
- **没有沉默的失败。** 任何阻止规则生效的原因都会呈现在屏幕上 —— 缺失的权限、无法使用的
  主机名、Chrome 会拒绝的头部名称。未生效的规则总会说明原因。

## 代理桥接

AI 代理可以从终端驱动 HeaderLab，而不必由人去点击弹窗：

```bash
headerlab site add staging.example.com
headerlab rule add --target request --op set --name Authorization --value "Bearer $TOKEN"
```

共十二条命令，每次回复都是 stdout 上的一个 JSON 对象，随后是退出码。**在人打开它之前，
桥接是关闭的** —— 它以可选权限 `nativeMessaging` 为载体，位于 Chrome 自己的同意对话框
之后；并且 CLI 既不能打开桥接，也不能授予站点权限，因为 Chrome 对两者都要求用户手势。
没有任何东西离开这台机器 —— 三个进程只通过位于按用户隔离目录中的 Unix 域套接字通信，
从不使用网络套接字。

打开它是三步 —— 在弹窗的桥接行按下 **Enable**，运行
`headerlab bridge install --extension-id <id>`，弹窗随即显示 **Bridge live**。

**[→ `docs/agent-bridge.md`](agent-bridge.md)** 里是设计：进程图以及方向为何是单向的、
完整的命令表、五条不该被误解的主张，以及升级把启动器变成孤儿时该怎么办。命令参考本身位于
[`packages/plugin/skills/headerlab/SKILL.md`](../packages/plugin/skills/headerlab/SKILL.md)。

## 架构

```
lib/model/       类型、zod 模式、默认值、迁移                     纯函数
lib/compile/     AppState → DNR 规则 + 诊断                      纯函数
lib/permissions/ origins.ts, audit.ts 为纯函数 · probe.ts 调用浏览器
lib/view/        弹窗视图模型                                    纯函数
lib/bridge/      protocol.ts (命令模式), apply.ts (reducer)        纯函数
lib/storage/     state.ts, session.ts, useAppState.ts
lib/sync/        ruleSync.ts (reconcile), icon.ts
components/      弹窗 UI
entrypoints/     background.ts, popup/
packages/        扩展产物之外的代理桥接 —— headerlab
                 (CLI 加原生消息主机，已发布到 npm)、plugin。
                 零依赖，node:test，各自的 CI 作业
```

**所有正确性都活在一个从不 import `chrome.*` 的纯函数层里。** `compile()` 把整个应用状态
转换成 declarativeNetRequest 规则加一份诊断列表，而弹窗对同一份状态运行同一个函数 ——
因此屏幕所说的与浏览器被告知的不可能出现分歧。

**只有一个 reconcile 循环。** 每一个触发点 —— 存储变化、Worker 启动、权限被授予或撤销 ——
都汇入 `lib/sync/ruleSync.ts` 中的 `reconcile()`，它从头重新编译并整体替换规则集。它是
幂等的，不存在第二条让状态向下漂移的路径。

这个形状是被迫的而非选择的：`@webext-core/fake-browser` 把 `declarativeNetRequest` 和
`permissions.*` 实现为会抛异常的桩，因此无法做浏览器模拟测试。让浏览器与逻辑无关，就是
对此的回应。

设计文档位于 `docs/superpowers/specs/`，其背后经过测量的平台约束位于 `docs/research/`。

## 限制

**这是一个 Chrome MV3 构建，仅此而已。** `wxt.config.ts` 没有声明任何其他目标，也从未在
其他浏览器上跑过构建。Edge 是同一个引擎，理应可用，但没有人对它跑过测试套件。

下表是*移植时会撞上的平台天花板*，而不是支持矩阵。它是本扩展所依赖的那些 API 的
[MDN 浏览器兼容性数据](https://github.com/mdn/browser-compat-data)，按各浏览器首次发布
该能力的版本读取：

| | Chrome | Edge | Firefox | Safari |
|---|---|---|---|---|
| 请求头 (`RuleAction.requestHeaders`) | 86 | ✓ | 113 | 16.4 |
| 响应头 (`RuleAction.responseHeaders`) | 86 | ✓ | 113 | **不支持** |
| 按站点的运行时授权 (`optional_host_permissions`) | 102 | ✓ | 128 | 15.5 |
| 标签页范围的规则 (`RuleCondition.tabIds`) | 92 | ✓ | 113 | **不支持** |
| 原生消息 (`runtime.connectNative`) | 29 | ✓ | 50 | 应用容器 |

其中两条值得单独写清楚：

- **Safari 完全无法修改响应头。** 这是本扩展所做工作的一半，因此 Safari 版本不是同一个
  产品的重新编译，而是一个更小的、不同的产品。
- **Safari 的原生消息走向的是包裹它的 macOS 应用**（Apple 文档化的模型），而不是磁盘上的
  主机清单。`headerlab bridge install` 写的正是那样一份清单，所以在那里无处可装。

刻意尚未构建的功能以 Issue 追踪：
[#30](https://github.com/say8425/headerlab/issues/30) 只有一套规则集 ·
[#31](https://github.com/say8425/headerlab/issues/31) JSON 导入/导出 ·
[#32](https://github.com/say8425/headerlab/issues/32) 标签页锁定 UI ·
[#33](https://github.com/say8425/headerlab/issues/33) 正则范围限定 ·
[#34](https://github.com/say8425/headerlab/issues/34) 手动主题切换 ·
[#35](https://github.com/say8425/headerlab/issues/35) 桥接尚未实现的命令。

## 开发

```bash
pnpm dev             # WXT 开发服务器 → 以已解压方式加载 .output/chrome-mv3-dev
pnpm check           # CI 六个作业中的四个：类型检查 · lint · format · 单元测试
pnpm test            # wxt build && vitest run —— 单元测试，无浏览器
pnpm test:packages   # 代理桥接的各包，在 node:test 下运行 —— vitest 的 glob
                     # 触及不到它们，所以它是独立的 CI 作业
pnpm check:all       # pnpm check && pnpm test:packages
pnpm test:e2e        # wxt build --mode e2e && playwright test —— 真实 Chrome
pnpm build           # 生产构建 → .output/chrome-mv3
pnpm screenshots     # 从真实弹窗重新生成本 README 中的图片
```

**是 pnpm，不是 npm。** `package.json` 在 `packageManager` 中写明了确切版本，所以
`corepack enable` 会给你那一个版本，别的都不用装。这里没有 `package-lock.json`；
`pnpm-lock.yaml` 才是 CI 用 `--frozen-lockfile` 安装时读取的锁文件。

**请运行 `pnpm test`，而不是裸的 `pnpm exec vitest run`。** 有几个套件是针对*构建产物*
做断言的，而裸工具不会构建。陈旧的产物曾同时制造过一次悄悄让守卫失效的假绿，和一次耗掉
一小时的假红，因此 `tests/support/build.ts` 现在会检测陈旧并带着该运行的命令失败。

**`pnpm test:e2e` 与 `pnpm screenshots` 需要一个 Playwright 默认不会安装的浏览器：**

```bash
pnpm exec playwright install --with-deps --no-shell chromium
```

`--no-shell` 很关键。Playwright 默认下载的无头版本是 `chromium-headless-shell`，那是一个
无法加载扩展的精简构建 —— 而上面这两条命令恰恰是为加载扩展而存在的。没有完整二进制时，
它们失败的样子看起来像代码问题，而不是缺少依赖。

其余内容由 `../CLAUDE.md` 承载：`lint` 为何要串联 `wxt prepare`、`postinstall` 为何可能
一次都不会运行、oxfmt 格式化什么又不格式化什么，以及那些已经耗掉别人时间的平台陷阱。

## 测试

三层：不依赖浏览器的纯逻辑、由手工植入的 spy 驱动的适配器，以及针对真正被加载的扩展的
端到端测试。十六个 e2e 中有两个通过本地回声服务器把真实请求送上链路并读回头部 —— 它们是
本仓库中最强的证据。

撰写时：38 个文件中的 820 个单元测试，加上 16 个 e2e。其中四个是桥接自己的，包括一个把真实
的 `headerlab site add` 经由真实安装的主机、经由套接字、送进真实存储的测试。
`packages/headerlab` 另有 140 个，由 Node 内置测试运行器而非 vitest 执行，因为该包没有
依赖，也不该获得依赖。`vitest.config.ts` 的 glob 触及不到它们，这正是它们拥有独立 CI 作业
的原因：有一段时间它们在从未被执行的情况下被合并，而一个没有任何东西去运行的测试套件比
不存在更糟，因为它会报告成功。

## 许可证

Apache-2.0。参见 [LICENSE](../LICENSE)。
