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
  Chrome 是整体拒绝规则集而非逐条拒绝，所以一条这样的规则会连带停掉其余所有规则。这不会悄无声息 —— 弹窗会显示注册失败。
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
  单词，在产物里会命中十六次，而每一次都是字符串或标识符而非调用 —— React DOM 的
  `prefetchDNS`、`fetchPriority` 和 `dns-prefetch`，以及字面量 `"xmlhttprequest"` 和
  `"websocket"`。后两者是 declarativeNetRequest 的资源类型名，但来路不同 ——
  `xmlhttprequest` 是弹窗以复选框提供的八种之一（在那里显示为 `xhr`），而 `websocket`
  只是校验已存状态的那个十五值资源类型枚举的成员。写在这里，是为了让你发现它们时读作「意料之中」而不是「抓到
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

每次回复都是 stdout 上的一个 JSON 对象 —— 无论成功还是失败 —— 随后是退出码。没有另一套
供人阅读、需要你去解析的输出。

```
CLI (headerlab)                      Native host              Extension (SW)
node, zero deps                       node, zero deps          lib/bridge/
   │                                      │                        │
   │  unix socket                         │  stdio                 │
   │  <per-user tmp>/headerlab/…sock      │  (4-byte length + JSON)│
   └──────── one JSON line ──────────────►├───────────────────────►│
            request/response              │                    apply()
   ◄──────────────────────────────────────┤◄───────────────────────┤
                                          │                   local:state
                                          │                        ▼
                                     Chrome launches         reconcile()
                                     and kills it        (existing single loop)
```

**这张图要传达的唯一事实是方向：主机无法先向扩展说话。** Chromium 确实有一条由原生端发起
连接的路径，但它藏在一个默认关闭的开关后面，所以设计把扩展当作唯一的发起方。扩展打开端口，
Chrome 作为副作用启动主机进程，主机在 Unix 套接字上监听，而连上去的是 CLI —— 反过来则不
存在。一次写入以一行 JSON 进入，经 stdio 分帧越过边界抵达扩展，应用到 `local:state`，再由
其他所有触发点早已汇入的那个 `reconcile()` 接手：**这是一个新的触发点，而不是新的写入者。**

### 命令

九条走桥接套接字：限定规则集范围的 `site add|rm` 与 `site all-sites on|off`，编辑头部规则的
`rule add|rm|toggle`，停止与重启整套规则的 `pause`/`resume`，以及整体替换已存状态的
`state set <file|->`。

另外三条完全不碰那个套接字 —— 它们管理原生消息主机清单和 Chrome 运行的启动器脚本，而这正是
套接字得以存在的前提：`bridge install`、`bridge uninstall`、`bridge status`。最后一条会在
启动器指向的文件已不存在时报告 `entryMissing` —— 那是 `npm uninstall -g headerlab`、一次
升级，或搬动了全局 prefix 的 nvm 切换所留下的症状。重新运行 `bridge install` 即可修好。

包含标志与错误码的完整参考位于
[`packages/plugin/skills/headerlab/SKILL.md`](../packages/plugin/skills/headerlab/SKILL.md)。

### 五条不该被误解的主张

这些是产品自己的主张。在这里说错，比干脆不写这一节更糟。

- **在人打开它之前，桥接是关闭的。** 它以可选权限 `nativeMessaging` 为载体，从弹窗上的按钮
  发起请求，位于 Chrome 自己的同意对话框之后 —— 安装时的 `permissions` 列表不会改变。这是
  实测而非假设：
  [`docs/research/2026-08-11-native-messaging-spike.md`](research/2026-08-11-native-messaging-spike.md)
  记录了同意对话框确实弹出，以及第二次连接时无需对话框而授权依然有效。
- **CLI 无法授予站点权限。** `site add` 和 `site all-sites on` 只改变规则被*限定*到什么范围
  —— 那一行依旧处于待授权状态，直到有人点击 **Grant**，与手动添加的站点完全一样。Chrome 要求
  权限授予必须有用户手势，这个限制被遵守而不是被绕开。
- **CLI 也无法打开桥接。** `chrome.permissions.request()` 需要用户手势才会兑现。没有
  `headerlab bridge enable`，将来也不会有能用的版本：在没人按过 **Enable** 的桥接旁边运行
  `bridge install`，只是写下一些永远不会连上的文件。
- **没有任何东西离开这台机器。** CLI、主机与扩展只通过位于权限受限的按用户目录中的 Unix 域
  套接字通信，从不使用网络套接字。**不是 `$TMPDIR`**，这是刻意的：`socketDir()` 不去读各个
  进程各自继承来的 `$TMPDIR`，而是向操作系统询问（以绝对路径调用
  `getconf DARWIN_USER_TEMP_DIR`）。因为主机继承 Chrome 的环境，CLI 继承终端的环境，两份
  副本若不一致，没有任何失败会把它暴露出来。确实有一个变量可以覆盖它
  （`HEADERLAB_SOCKET_DIR`），而它是在函数*内部*被读取一次，而不是由各个调用点各自读取 ——
  出于同样的理由。
  `tests/unit/outbound.test.ts` 禁止 `packages/headerlab/` 下每一个 `.mjs` 使用向外的原语
  —— `fetch`、`WebSocket`、`node:https`、`.listen(<端口号>)` 调用 —— 并且它自己的文档注释
  说明了它看不见什么：端口检查匹配的是源码中的字面数字，所以 `server.listen(8080)` 会被抓到，
  而 `server.listen(tcpPort)` 不会。之所以写出来而不是留给暗示，是因为夸大一项安全保证正是
  这个仓库最不愿意做的事。
- **这个构建拒绝正则过滤器。** `state set` 会校验负载，但弹窗没有正则编辑器，这里也没有任何
  地方调用 `chrome.declarativeNetRequest.isRegexSupported()` —— 而它是判断一个模式是否为
  合法 RE2 的唯一权威。于是 `filter.mode: 'regex'` 的规则会在看不见的情况下生效，头部被改动
  而没有任何界面能显示是哪个模式在负责。`lib/bridge/port.ts` 直接以错误码 `unsupported`
  拒绝这样的负载，直到配套的正则编辑器出现
  （[#33](https://github.com/say8425/headerlab/issues/33)）。

### 如何打开

1. 在弹窗的桥接行按下 **Enable** —— 在那之前它显示 **Bridge off**。这会通过 Chrome 自己的
   同意对话框请求 `nativeMessaging` 权限。
2. 从 `chrome://extensions` 复制 id 并运行安装命令：

   ```bash
   headerlab bridge install --extension-id <id>
   ```

3. 弹窗随即显示 **Bridge live**。

`--extension-id` 也是 CLI 自己的 README 首先给出的指令，因为它在任何情况下都适用 —— 从 npm
安装 CLI 的人手上并没有可以指向的扩展目录。`--load-path <dir>` 是当你正在处理本地解压构建、
路径本就在手边时的替代方案，但它是便利，也同样是陷阱：符号链接、结尾的斜杠，或指向同一目录
的不同写法，都会哈希出不同的 id，而不匹配的清单会干净地安装完成，然后单纯地永远连不上。

无论走哪条路，安装器都会把它实际用的 id 原样回显，因为 CLI 内部没有任何东西能拿它与 Chrome
真正加载的东西比对。把回显的 id 与 `chrome://extensions` 对照，是唯一存在的检查，而
`tests/e2e/bridge.spec.ts` 正是对着一个运行中的浏览器做这件事。

**打包。** `packages/headerlab` 把 `headerlab` 命令**和** Chrome 启动的主机作为一个包而非
两个来发布。`bridge install` 会写出一个以绝对路径命名主机入口文件的启动器；一个不带主机发布
的 CLI 同样会写出那个启动器 —— 安装步骤看不到它所命名的文件在目标机器上并不存在 —— 而
Chrome 报告这种失败时用的消息，与清单被拒绝或 id 不匹配时完全相同。让两者从同一个 tarball
发布，使这种失败方式从结构上不可能发生，而不只是被写进文档。

命令表面比设计自身的 §2/§3 更窄 —— `headerlab status`、`diagnostics`、`state get`、
`rule ls`，以及每次原始写入前的快照都不存在
（[#35](https://github.com/say8425/headerlab/issues/35)）。

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
该能力的版本读取。Edge 那一列是 `✓` 而非数字，因为 BCD 把它记作 `mirror` —— 它跟随
Chrome：

| | Chrome | Edge | Firefox | Safari |
|---|---|---|---|---|
| 请求头 (`RuleAction.requestHeaders`) | 86 | ✓ | 113 | 16.4 |
| 响应头 (`RuleAction.responseHeaders`) | 86 | ✓ | 113 | **不支持** |
| 按站点的运行时授权 (`optional_host_permissions`) | 102 | ✓ | 128 | 15.5 |
| 标签页范围的规则 (`RuleCondition.tabIds`) | 92 | ✓ | 113 | **不支持** |
| 原生消息 (`runtime.connectNative`) | 29 | ✓ | 50 | 14（包裹应用） |

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
pnpm test:e2e        # 构建两个 e2e 模式后运行 playwright test —— 真实 Chrome
pnpm typecheck       # wxt prepare && tsc --noEmit
pnpm lint            # wxt prepare && oxlint --deny-warnings   (lint:fix 修复)
pnpm format:check    # oxfmt --check             (pnpm format 写入)
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

**`pnpm screenshots` 会覆盖被追踪的 PNG**（`docs/screenshots/`）。这正是它的职责，但跑一次
就会在 `git status` 里留下改动 —— 只有在 UI 确实变了的时候才提交它们。

**e2e 构建带有发布构建所没有的主机权限，考虑到本页开头的主张，这值得明说。**
`pnpm test:e2e` 会在生产目录旁边生成 `.output/chrome-mv3-e2e` 和
`.output/chrome-mv3-bridge-e2e`。前者声明了 `http://127.0.0.1/*`（`wxt.config.ts`），
以便测试套件能驱动本地回声服务器，而不必面对 Playwright 无法点击的运行时弹窗；后者
直接授予 `nativeMessaging`。`tests/unit/manifest.test.ts` 断言两者都不会进入生产，
并且运行 e2e 套件不会触碰 `.output/chrome-mv3` —— 需要新的生产构建请运行 `pnpm build`。

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
