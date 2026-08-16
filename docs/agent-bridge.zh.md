# 代理桥接

[English](agent-bridge.md) | [한국어](agent-bridge.ko.md) | [日本語](agent-bridge.ja.md) | 中文 | [Español](agent-bridge.es.md)

[HeaderLab](README.zh.md) 的一部分。

AI 代理可以从终端驱动 HeaderLab，而不必由人去点击弹窗：

```bash
headerlab site add staging.example.com
headerlab rule add --target request --op set --name Authorization --value "Bearer $TOKEN"
```

在终端里它为人打印；接上管道或加 `--json` 时，它打印一个 JSON 对象，无论成功还是失败。
`--human` 是 `--json` 的反面：即使接上管道也强制为人可读的形式，用在日志要给人读而不是
给机器解析的时候。同时给出两者不是优先级问题而是矛盾，所以 CLI 什么都不做就拒绝，并以
2 退出。退出码为失败的类别命名：

| 退出码 | 含义 |
|---|---|
| `0` | 成功 |
| `2` | 你的输入 —— CLI 自己拒绝了它，什么都没有离开这台机器 |
| `3` | 没有可以对话的桥接 |
| `4` | 连上了，但这次交换失败了 |
| `1` | 扩展拒绝了该请求 |

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

## 命令

四条只读、什么都不改：`status`、`site ls`、`rule ls`、`state get`。它们发出同一条查询，并由
**弹窗渲染时所用的同一批纯函数**作答，所以 CLI 说的话和侧栏显示的内容无从分叉。

```bash
headerlab status
headerlab state get --json | jq .state | headerlab state set - --force
```

`status` 是唯一把「没有桥接」当作事实而非错误的命令 —— 它只凭本地已安装的内容作答，说
`live: false`，然后以 0 退出，就像在一个没有提交的仓库里运行 `git status`。另外三条会以
3 退出。

九条作为写入走桥接套接字：限定规则集范围的 `site add|rm` 与 `site all-sites on|off`，编辑
头部规则的 `rule add|rm|toggle`，停止与重启整套规则的 `pause`/`resume`，以及整体替换已存
状态的 `state set <file|->` —— 最后这条在 stdin 不是终端时要求 `--force`，因为它是一次无法
撤销的覆盖。

另外三条完全不碰那个套接字 —— 它们管理原生消息主机清单和 Chrome 运行的启动器脚本，而这正是
套接字得以存在的前提：`bridge install`、`bridge uninstall`、`bridge status`。最后一条会在
启动器指向的文件已不存在时报告 `entryMissing` —— 那是 `npm uninstall -g headerlab`、一次
升级，或搬动了全局 prefix 的 nvm 切换所留下的症状。重新运行 `bridge install` 即可修好。

包含标志与错误码的完整参考位于
[`packages/plugin/skills/headerlab/SKILL.md`](../packages/plugin/skills/headerlab/SKILL.md)。

## 五条不该被误解的主张

这些是产品自己的主张。在这里说错，比干脆不写这份文档更糟。

- **在人打开它之前，桥接是关闭的。** 它以可选权限 `nativeMessaging` 为载体，从弹窗上的按钮
  发起请求，位于 Chrome 自己的同意对话框之后 —— 安装时的 `permissions` 列表不会改变。这是
  实测而非假设：
  [`docs/research/2026-08-11-native-messaging-spike.md`](research/2026-08-11-native-messaging-spike.md)
  记录了同意对话框确实弹出，以及第二次连接时无需对话框而授权依然有效。
- **CLI 无法授予站点权限。** `site add` 和 `site all-sites on` 只改变规则被*限定*到什么范围
  —— 那一行依旧处于待授权状态，直到有人点击 **Grant**，与手动添加的站点完全一样。Chrome 要求
  权限授予必须有用户手势，这个限制被遵守而不是被绕开。
- **CLI 也无法打开桥接。** `chrome.permissions.request()` 需要用户手势才会兑现。没有
  `headerlab bridge enable`，将来也不会有能用的版本：在没人打开过开关的桥接旁边运行
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

## 如何打开

1. 在弹窗的桥接行打开开关 —— 在那之前它显示 **Agent bridge off**。这会通过 Chrome 自己的
   同意对话框请求 `nativeMessaging` 权限。
2. 从 `chrome://extensions` 复制 id 并运行安装命令：

   ```bash
   headerlab bridge install --extension-id <id>
   ```

3. 弹窗随即显示 **Agent bridge live**。

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

设计自身的 §2/§3 点名过的东西里，仍有两样不存在：`headerlab diagnostics` 也不会去做 ——
`status` 已经运载同样的载荷，给同一条查询取第二个名字不是功能 —— 以及
`state snapshots`/`state restore <id>` 本该读回的、每次原始写入前的快照
（[#35](https://github.com/say8425/headerlab/issues/35)）。`state set` 会做模式校验并要求
`--force`，但它不保留任何历史。
