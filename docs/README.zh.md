# HeaderLab

[English](../README.md) | [한국어](README.ko.md) | [日本語](README.ja.md) | 中文 | [Español](README.es.md)

在 Chrome 里增删改 HTTP 请求头和响应头。在你授权之前，它没有任何站点访问权限。

[![Chrome Web Store](https://img.shields.io/chrome-web-store/v/kgapijlldieckifoenckgninnepafhnn?logo=googlechrome&logoColor=%234285F4&color=%234285F4&label=chrome%20web%20store)](https://chromewebstore.google.com/detail/headerlab/kgapijlldieckifoenckgninnepafhnn)
[![CLI](https://img.shields.io/npm/v/headerlab?logo=npm&logoColor=%23CC3534&color=%23CC3534&label=cli)](https://www.npmjs.com/package/headerlab)
[![CI](https://github.com/say8425/headerlab/actions/workflows/ci.yml/badge.svg)](https://github.com/say8425/headerlab/actions/workflows/ci.yml)

| 浅色 | 深色 |
|---|---|
| ![浅色主题下的 HeaderLab 弹窗：四条规则中三条生效，两个已授权站点，四条头部规则](screenshots/popup-light.png) | ![同一个弹窗的深色主题，跟随操作系统设置](screenshots/popup-dark.png) |

## 安装

目前只支持 Chrome。Firefox 和 Safari 在计划中。

### Chrome 网上应用店

推荐从
[Chrome 网上应用店](https://chromewebstore.google.com/detail/headerlab/kgapijlldieckifoenckgninnepafhnn)
安装。

### 发布页面

每个 `extension-v*` 发布都附带 `headerlab-<version>-chrome.zip`。在
[发布页面](https://github.com/say8425/headerlab/releases)取下你要的版本，解压，然后
`chrome://extensions` → **开发者模式** → **加载已解压的扩展程序** → 选择解压后的目录。

### 自行构建

```bash
corepack enable          # pnpm 来自 package.json 的 packageManager 字段
pnpm install
pnpm build               # → .output/chrome-mv3
```

用同样的方式加载 `.output/chrome-mv3`。

## AI

HeaderLab 可以交给 AI 编码代理来操作。它由三部分组成，可以叠加使用：一个 CLI，人也可以
直接手动用；一个技能，教代理怎么用这个 CLI；还有桥接，把前两者接到运行中的扩展上。三者
默认都不开启，而且都不能自己打开自己。原因见本节最后一段。

### CLI

```bash
npm i -g headerlab
```

这会把 `headerlab` 装到 PATH 上，用来从终端操作扩展，参见[代理桥接](#代理桥接)。这个包
没有任何运行时依赖，所以从克隆的仓库里也能直接跑，不需要安装：
`node packages/headerlab/bin/headerlab.mjs`。上面那条命令是普通用户的用法，克隆仓库是
贡献者的做法，这个先后顺序是刻意的。

### 代理技能

`packages/plugin` 把 CLI 打包成给 Claude Code 和 Codex 用的技能：一份 `skills/` 目录树，
两份清单。两者都没有发布到任何目录服务，所以都从本仓库安装：

```bash
# Claude Code
claude plugin marketplace add say8425/headerlab
claude plugin install headerlab@headerlab

# Codex
codex plugin marketplace add say8425/headerlab
```

技能的内容送到模型之前，会先执行 `command -v headerlab`。这样「CLI 不在」是一开始就摆明
的事实，而不是任务做到一半冒出来的意外。**桥接打开之前，它报告 `bridge-off`。** 全局安装
CLI 不是前提条件：插件自带一个指向 `packages/headerlab` 的 shim。同时执行
`npm i -g headerlab` 也不冲突，PATH 会先解析到全局副本。

用你自己的话提要求，技能会把它转换成 CLI 命令：

```text
HeaderLab 现在在做什么?
只在 staging.example.com 上添加 X-Debug: on 请求头
在 api.example.com 上不要发送 Referer 头
把所有规则先暂停，然后再打开
我实际被允许修改哪些站点?
```

第一条和最后一条是读取。`status`、`site ls`、`rule ls` 和 `state get` 不写入任何东西就能
作答。中间三条会写入，其中有一点值得先知道：添加站点只是给规则划定范围，并不授予对该站点
的访问权限。在弹窗里按下 Grant 之前，站点一直处于待授权状态。技能被要求把这一点说出来，
免得你把这次写入读成站点已经生效。

### 代理桥接

桥接就是把上面两者送进运行中扩展的那一层：

```bash
headerlab site add staging.example.com
headerlab rule add --target request --op set --name Authorization --value "Bearer $TOKEN"
```

在有人于弹窗里打开开关之前，桥接是关闭的。CLI 既不能授予站点权限，也不能打开桥接，这两件
事 Chrome 都只接受用户手势。没有任何东西离开这台机器：CLI、主机和扩展在一个按用户划分的
目录下的 Unix 域套接字上相遇，不使用网络套接字。

[`docs/agent-bridge.zh.md`](agent-bridge.zh.md) 写了全部：协议、命令、退出码、怎么打开，
以及五条不要弄错的主张。

## 它做什么

- 对**请求**侧或**响应**侧的任意头部做**设置、追加或删除**。Chrome 把请求头的 `append`
  限制在一份 21 项白名单内，落在名单外的规则 HeaderLab 会点名。这件事比听上去重要：
  Chrome 拒绝规则集是整体拒绝，不是逐条拒绝，所以一条这样的规则会把其余规则全都停掉。
  这不会悄无声息，弹窗会显示注册失败。
- **按站点限定范围。** 站点按主机匹配。添加时端口和路径会被丢掉，存下来的值就是实际生效
  的值，所以侧栏显示的就是真正走上链路的东西。
- **应用到所有站点**是一个显式的模式，不是一个空的站点列表。它需要 `<all_urls>`，但开关
  本身不会去要，去要的是旁边的 Grant 按钮。
- **按请求类型过滤**，Chrome 的八种资源类型，可以逐项勾选。`main_frame` 默认开启，因为
  DNR 自己的默认值会悄悄把它排除掉。
- 一个开关**暂停全部**。工具栏图标随之变灰，Service Worker 唤醒时会重新应用。
- **跟随系统主题**，浅色或深色，在首次绘制之前完成。

权限是按站点请求的，就在写着该站点名字的那一行上，绝不会因为你输入了一个主机名、拨了一下
开关就顺带发生。在你按下 **Grant** 之前，那一行是琥珀色的，并且明说：

![internal.example.com 的站点行处于待授权的琥珀色状态，带有 Grant 按钮](screenshots/popup-permission.png)

任何会挡住规则生效的原因，都写在这条规则自己那一行上，并计入 **Rules** 标题旁的读数。下图里第二条规则要求
Chrome 对一个它不会追加的请求头执行 `append`。这一行说明了是哪一个、应该改用什么，读数是
**2 of 4 live · 1 off · 1 blocked**，而且没有任何元素为了这条消息挪位置：

![规则列表中第二行在值的位置以红色显示 "Use Set. Chrome does not append request headers."，Rules 标题旁的读数为 2 of 4 live, 1 off, 1 blocked](screenshots/popup-blocked.png)

<sub>截自加载进 Chrome 的真实生产构建。唯一改动的是清单文件，用来预先授权两个示例主机，
否则拍不到不带原生权限对话框的已授权状态。</sub>

## 信任准则

- **安装时没有任何主机权限。** 清单的 `permissions` 只有 `storage` 和
  `declarativeNetRequestWithHostAccess` 两项。它另外声明了
  `optional_host_permissions: ["<all_urls>"]`，但这一行本身不授予任何东西。Chrome 不允许
  扩展请求它从未声明过的来源，所以这一行的作用是让运行时的 Grant 按钮合法，而不是让它变
  得多余。站点访问由你在运行时逐个主机授予，也可以随时在 Chrome 里撤销。
- **没有网络调用。** 没有分析、遥测、远程配置或更新 ping。发布的产物从不*调用*网络原语，
  这一点你可以自己验证，不必相信我们：

  ```bash
  pnpm build
  grep -rE 'fetch\(|XMLHttpRequest|WebSocket|sendBeacon' .output/chrome-mv3
  ```

  它不返回任何结果。这个模式刻意只匹配调用形式和构造形式。如果只是忽略大小写地搜那几个
  单词，产物里会命中十六次，而每一次都是字符串或标识符，不是调用：React DOM 的
  `prefetchDNS`、`fetchPriority` 和 `dns-prefetch`，以及字面量 `"xmlhttprequest"` 和
  `"websocket"`。后两个是 declarativeNetRequest 的资源类型名，来路却不同。
  `xmlhttprequest` 是弹窗以复选框提供的八种之一（在那里写作 `xhr`），而 `websocket` 只
  出现在校验已存状态用的那个十五项资源类型枚举里。写在这里，是为了让你发现它们时读作
  意料之中，而不是抓到一次说谎。
- **没有内容脚本。** 不往任何页面注入任何东西。头部由 Chrome 的 `declarativeNetRequest`
  引擎修改，这个引擎从不把请求内容交给扩展。
- **没有外部资源。** 没有 CDN，没有网络字体，没有远程图片。
- **没有沉默的失败。** 任何挡住规则生效的原因都会显示在屏幕上：缺失的权限、无法使用的
  主机名、Chrome 会拒绝的头部名。没有生效的规则一定会说明原因。

## 限制

详情见 [MDN 浏览器兼容性数据](https://github.com/mdn/browser-compat-data)。

| | Chrome | Edge | Firefox | Safari |
|---|---|---|---|---|
| 请求头 (`RuleAction.requestHeaders`) | 86 | ✓ | 113 | 16.4 |
| 响应头 (`RuleAction.responseHeaders`) | 86 | ✓ | 113 | **不支持** |
| 按站点的运行时授权 (`optional_host_permissions`) | 102 | ✓ | 128 | 15.5 |
| 标签页范围的规则 (`RuleCondition.tabIds`) | 92 | ✓ | 113 | **不支持** |
| 原生消息 (`runtime.connectNative`) | 29 | ✓ | 50 | 14（包裹应用） |

## 架构

```
lib/model/       类型、zod 模式、默认值、迁移                     纯函数
lib/compile/     AppState → DNR 规则 + 诊断                      纯函数
lib/permissions/ origins.ts, audit.ts 为纯函数 · probe.ts 调用浏览器
lib/view/        弹窗视图模型                                    纯函数
lib/bridge/      protocol.ts (命令模式), apply.ts (reducer),
                 query.ts (状态 → StatusPayload)                   纯函数
lib/storage/     state.ts, session.ts, useAppState.ts
lib/sync/        ruleSync.ts (reconcile), icon.ts
components/      弹窗 UI
entrypoints/     background.ts, popup/
packages/        扩展产物之外的代理桥接 —— headerlab
                 (CLI 加原生消息主机，已发布到 npm)、plugin。
                 零依赖，node:test，各自的 CI 作业
```

**所有正确性都在一个从不 import `chrome.*` 的纯函数层里。** `compile()` 把整个应用状态
转换成 declarativeNetRequest 规则加一份诊断列表，弹窗对同一份状态运行同一个函数。所以
屏幕上说的和浏览器被告知的不可能不一致。

**只有一个 reconcile 循环。** 存储变化、Worker 启动、权限被授予或撤销，每一个触发点都汇入
`lib/sync/ruleSync.ts` 里的 `reconcile()`。它从头重新编译，整体替换规则集，因此是幂等的，
也不存在第二条让状态向下漂移的路径。

这个结构是被逼出来的，不是选出来的。`@webext-core/fake-browser` 把 `declarativeNetRequest`
和 `permissions.*` 实现成会抛异常的桩，浏览器模拟测试因此走不通。让浏览器与逻辑无关，就是
对此的回应。

设计文档在 `docs/superpowers/specs/`，它们背后经过实测的平台约束在 `docs/research/`。

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
pnpm store:assets    # 重新生成 Chrome 网上应用店的 8 张图片 → docs/store/assets/
```

**用 pnpm，不用 npm。** `package.json` 的 `packageManager` 写明了确切版本，所以
`corepack enable` 会给你那一个，别的都不用装。这里没有 `package-lock.json`，CI 用
`--frozen-lockfile` 安装时读的锁文件是 `pnpm-lock.yaml`。

**请运行 `pnpm test`，不要裸跑 `pnpm exec vitest run`。** 有几个套件是对*构建产物*做断言
的，而裸工具不会构建。陈旧的产物出过两次事：一次假绿，悄悄让一个守卫失效；一次假红，耗掉
一小时。所以 `tests/support/build.ts` 会检测陈旧，并带着该运行的命令报错。

**`pnpm test:e2e`、`pnpm screenshots` 和 `pnpm store:assets` 需要一个 Playwright 默认不会
安装的浏览器：**

```bash
pnpm exec playwright install --with-deps --no-shell chromium
```

`--no-shell` 是关键。Playwright 默认下载的无头版本是 `chromium-headless-shell`，那是一个
加载不了扩展的精简构建，而上面这两条命令存在的意义恰恰就是加载扩展。没有完整二进制时，
它们失败的样子看起来像代码问题，而不是缺少依赖。

**`pnpm screenshots` 和 `pnpm store:assets` 会覆盖被追踪的 PNG**，分别在
`docs/screenshots/` 和 `docs/store/assets/`，后者会先清空目录再重写全部 8 张。这正是它们
的职责，但跑一次就会在 `git status` 里留下改动，只有 UI 确实变了才提交。

**e2e 构建带着发布构建没有的主机权限。考虑到本页开头那条主张，这值得明说。**
`pnpm test:e2e` 会在生产目录旁边生成 `.output/chrome-mv3-e2e` 和
`.output/chrome-mv3-bridge-e2e`。前者声明了 `http://127.0.0.1/*`（`wxt.config.ts`），
好让测试套件能驱动本地回声服务器，不必去点 Playwright 点不了的运行时弹窗；后者直接授予
`nativeMessaging`。`tests/unit/manifest.test.ts` 断言两者都进不了生产。运行 e2e 套件不会
碰 `.output/chrome-mv3`，需要新的生产构建就跑 `pnpm build`。

其余的写在 `../CLAUDE.md` 里：`lint` 为什么要串 `wxt prepare`、`postinstall` 为什么可能
一次都不会跑、oxfmt 格式化什么又不格式化什么，以及那些已经耗掉过别人时间的平台陷阱。

## 测试

分三层：不碰浏览器的纯逻辑、由手工植入的 spy 驱动的适配器，以及针对真正被加载起来的扩展
的端到端测试。e2e 里有两个测试通过本地回声服务器把真实请求送上链路，再把头部读回来，它们
是本仓库里最强的证据。桥接也有自己的一组，其中一个把真实的 `headerlab site add` 经由真实
安装的主机、经由套接字，送进真实的存储。

`packages/headerlab` 另有自己的一套测试，由 Node 内置的测试运行器执行，而不是 vitest，
因为这个包没有依赖，也不该有。`vitest.config.ts` 的 glob 够不到它们，这正是它们拥有独立
CI 作业的原因：曾经有一段时间，它们在从未被执行的情况下被合并，而没有任何东西去运行的
测试套件比不存在更糟，因为它会报告成功。

## 许可证

Apache-2.0。参见 [LICENSE](../LICENSE)。
