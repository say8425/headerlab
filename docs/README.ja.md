# HeaderLab

[English](../README.md) | [한국어](README.ko.md) | 日本語 | [中文](README.zh.md) | [Español](README.es.md)

HTTP リクエスト・レスポンスヘッダーを Chrome で追加・変更・削除します。あなたが許可する
まで、サイトへのアクセス権限は一切持ちません。

[![CI](https://github.com/say8425/headerlab/actions/workflows/ci.yml/badge.svg)](https://github.com/say8425/headerlab/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/headerlab?logo=npm&logoColor=%23CC3534&color=%23CC3534)](https://www.npmjs.com/package/headerlab)
[![Chrome MV3](https://img.shields.io/badge/Chrome-MV3-4285F4?style=flat&logo=googlechrome&logoColor=white)](https://developer.chrome.com/docs/extensions/reference/api/declarativeNetRequest)
[![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=flat&logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue)](#ライセンス)

ModHeader の代替です。ModHeader は 2026 年 7 月、隠されたトラッカーが見つかったため
Chrome ウェブストアから削除されました。それがこのプロジェクトが存在する理由のすべてであり、
下記の信頼方針が機能一覧ではなく厳格な制約である理由です。

| ライト | ダーク |
|---|---|
| ![ライトテーマの HeaderLab ポップアップ: 4 つのルールのうち 3 つが有効、許可済みサイト 2 件、ヘッダールール 4 件](screenshots/popup-light.png) | ![同じポップアップのダークテーマ。OS の設定に従います](screenshots/popup-dark.png) |

## インストール

Chrome ウェブストアには掲載していません。最新の
[リリース](https://github.com/say8425/headerlab/releases)に添付された zip を展開するか、
自分でビルドしてください:

```bash
corepack enable          # pnpm は package.json の packageManager フィールドから来ます
pnpm install
pnpm build               # → .output/chrome-mv3
```

そのあと `chrome://extensions` を開き、**デベロッパーモード**を有効にして
**パッケージ化されていない拡張機能を読み込む**からそのディレクトリを選びます。Chrome 専用
です — [制約](#制約)を参照してください。

### CLI

```bash
npm i -g headerlab
```

これでターミナルから拡張機能を操作するための `headerlab` が PATH に入ります —
[エージェントブリッジ](#エージェントブリッジ)を参照。ランタイム依存がゼロなので、クローン
からインストールなしで直接実行することもできます: `node
packages/headerlab/bin/headerlab.mjs`。ただし上の一行が人間の使い方で、クローンは
コントリビューターの作業です。順序は意図的にそうしてあります。

### エージェントスキル

`packages/plugin` は CLI を Claude Code と Codex 向けのスキルとして梱包します。ひとつの
`skills/` ツリーを 2 つのマニフェストが共有しています。どちらもディレクトリには公開して
いないため、両方ともこのリポジトリからインストールします:

```bash
# Claude Code
claude plugin marketplace add say8425/headerlab
claude plugin install headerlab@headerlab

# Codex
codex plugin marketplace add say8425/headerlab
```

スキルは自身の内容がモデルに届く前に `command -v headerlab` を実行します。CLI がないという
事実が、作業中の驚きではなく最初から事実として届くようにするためです。**ブリッジを有効に
するまでは `bridge-off` を報告します。** CLI のグローバルインストールは前提条件ではありま
せん — プラグインは `packages/headerlab` への独自の shim を持っています。`npm i -g
headerlab` を併用しても衝突しません。PATH がグローバルのコピーを先に解決します。

## できること

- 任意のヘッダーを **リクエスト** 側でも **レスポンス** 側でも **設定・追加・削除**します。
  `append` は Chrome によってリクエストヘッダー 21 個の許可リストに制限されており、
  HeaderLab はその外にあるルールを名指しします。これは聞こえるより重要です — Chrome は
  ルールセットをルール単位ではなく丸ごと拒否するため、そうしたルールが 1 つあると他の
  すべても止まります。
- **サイト単位のスコープ。** サイトはホストでマッチします。ポートやパスを入れると落とされ、
  保存された値がそのまま動作する値になるので、レールに見えるものが実際に回線に出るものです。
- **すべてのサイトに適用**を、空のリストではなく明示的なモードとして扱います。`<all_urls>`
  を必要としますが、スイッチ自体はそれを要求しません — 隣の Grant ボタンが要求します。
- **リクエストタイプでの絞り込み** — Chrome のリソースタイプ 8 種を個別にチェックできます。
  `main_frame` が既定で有効なのは、DNR 自身の既定がそれを黙って除外するからです。
- スイッチひとつで**全体を一時停止**。ツールバーのアイコンも灰色になり、Service Worker が
  起きたときに再適用されます。
- **OS のテーマに従います。** ライトでもダークでも、最初の描画より前に決まります。

権限はサイトごとに、そのサイト名が書かれた行で要求します — ホスト名を入力したりスイッチを
切り替えたりした副作用として要求することはありません。**Grant** を押すまで、その行は
アンバー色でそう告げます:

![internal.example.com のサイト行が保留状態のアンバー色で、Grant ボタンとともに表示されている様子](screenshots/popup-permission.png)

ルールが出ていくのを妨げるものは何であれ、そのルール自身の行で語られ、レールで数えられます。
下は 2 番目のルールが、Chrome が追加しないリクエストヘッダーへの `append` を要求した場合
です — 行はどのヘッダーかと代わりに何をすべきかを告げ、読み取り部は **2 of 4 rules live ·
1 off · 1 blocked** を示し、そのメッセージのために何も動きません:

![2 番目の行の値の位置に "Use Set. Chrome does not append request headers." が赤で表示されたルール一覧と、2 of 4 rules live, 1 off, 1 blocked を示すレール](screenshots/popup-blocked.png)

<sub>Chrome に読み込んだ実際の本番ビルドから撮影しています。手を入れたのはマニフェストだけ
で、例示用の 2 ホストを事前に許可しないとネイティブの権限ダイアログなしに許可済みの状態を
撮影できないためです。</sub>

## 信頼方針

- **インストール時点でホスト権限なし。** マニフェストの `permissions` はちょうど `storage`
  と `declarativeNetRequestWithHostAccess` だけです。`optional_host_permissions:
  ["<all_urls>"]` も宣言していますが、それ自体は何も付与しません — Chrome は拡張機能が
  宣言していないオリジンを要求することを拒むので、あの行はランタイムの Grant ボタンを
  合法にするものであって、不要にするものではありません。サイトへのアクセスはあなたが
  ホストごとにランタイムで付与し、Chrome からいつでも取り消せます。
- **ネットワーク呼び出しなし。** 分析も、テレメトリも、リモート設定も、更新 ping も
  ありません。配布されるバンドルはネットワークプリミティブを*呼び出しません*。信じる代わりに
  自分で確認できます:

  ```bash
  pnpm build
  grep -rE 'fetch\(|XMLHttpRequest|WebSocket|sendBeacon' .output/chrome-mv3
  ```

  何も出ません。このパターンが呼び出しとコンストラクタの形だけに一致するのは意図的です。
  大文字小文字を無視して単語をそのまま検索すると、バンドルに 16 回当たりますが、
  そのすべてが呼び出しではなく文字列か識別子です — React DOM の `prefetchDNS`、
  `fetchPriority`、`dns-prefetch`、そしてリテラルの `"xmlhttprequest"` と `"websocket"`
  です。後の 2 つは Chrome の declarativeNetRequest のリソースタイプ名で、ポップアップで
  それらを条件にできるため含まれています。見つけたときに「見破った嘘」ではなく「想定どおり」
  と読めるよう、ここに書いておきます。
- **コンテンツスクリプトなし。** どのページにも何も注入しません。ヘッダーは Chrome の
  `declarativeNetRequest` エンジンが変更し、このエンジンはリクエストの中身を拡張機能に
  渡しません。
- **外部リソースなし。** CDN も、ウェブフォントも、リモート画像もありません。
- **黙った失敗なし。** ルールが出ていくのを妨げるものは画面に出ます — 足りない権限、
  使えないホスト名、Chrome が拒否するヘッダー名。適用されていないルールは必ず理由を語ります。

## エージェントブリッジ

AI エージェントが、人がポップアップをクリックする代わりにターミナルから HeaderLab を操作
できます:

```bash
headerlab site add staging.example.com
headerlab rule add --target request --op set --name Authorization --value "Bearer $TOKEN"
```

コマンドは全部で 12 個、すべての応答は stdout 上の 1 つの JSON オブジェクトで、終了コードが
それに続きます。**人が有効にするまでブリッジは無効です** — `nativeMessaging` をオプション
権限として使い、Chrome 自身の同意ダイアログの向こう側にあります。そして CLI はブリッジを
有効にすることも、サイト権限を付与することもできません。Chrome がどちらにもユーザー
ジェスチャーを要求するからです。マシンの外に出るものはありません — 3 つのプロセスは
ユーザーごとのディレクトリにある Unix ドメインソケットだけで会話し、ネットワークソケットは
使いません。

有効化は 3 ステップです — ポップアップのブリッジ行で **Enable** を押し、
`headerlab bridge install --extension-id <id>` を実行すると、ポップアップが
**Bridge live** になります。

**[→ `docs/agent-bridge.md`](agent-bridge.md)** に設計があります: プロセス図と方向が
なぜ一方向なのか、コマンド表の全体、取り違えてはいけない 5 つのこと、そしてアップグレードが
ランチャーを孤児にしたときの対処。コマンドリファレンスそのものは
[`packages/plugin/skills/headerlab/SKILL.md`](../packages/plugin/skills/headerlab/SKILL.md)
にあります。

## アーキテクチャ

```
lib/model/       型、zod スキーマ、既定値、マイグレーション        純粋
lib/compile/     AppState → DNR ルール + 診断                    純粋
lib/permissions/ origins.ts, audit.ts は純粋 · probe.ts がブラウザを呼ぶ
lib/view/        ポップアップのビューモデル                       純粋
lib/bridge/      protocol.ts (コマンドスキーマ), apply.ts (リデューサ)  純粋
lib/storage/     state.ts, session.ts, useAppState.ts
lib/sync/        ruleSync.ts (reconcile), icon.ts
components/      ポップアップ UI
entrypoints/     background.ts, popup/
packages/        拡張バンドルの外にあるエージェントブリッジ — headerlab
                 (CLI とネイティブメッセージングホスト、npm に公開)、plugin。
                 依存ゼロ、node:test、独自の CI ジョブ
```

**正しさはすべて `chrome.*` を決して import しない純粋な層にあります。** `compile()` は
アプリケーション状態全体を declarativeNetRequest ルールと診断のリストに変換し、ポップアップ
は同じ状態に対して同じ関数を走らせます — だから画面が語ることとブラウザが告げられたことが
食い違うことはありません。

**reconcile ループはひとつ。** ストレージの変更、ワーカーの起動、権限の付与や取り消し —
すべてのトリガーが `lib/sync/ruleSync.ts` の `reconcile()` に集まり、それが一から再
コンパイルしてルールセットを丸ごと置き換えます。冪等であり、状態が下流へ漏れる第二の経路は
ありません。

この形は選んだのではなく強制されたものです: `@webext-core/fake-browser` は
`declarativeNetRequest` と `permissions.*` を throw するスタブとして実装するため、ブラウザ
を模したテストができません。ロジックからブラウザを無関係にすることがその答えです。

設計文書は `docs/superpowers/specs/` に、その背後の計測されたプラットフォーム制約は
`docs/research/` にあります。

## 制約

**これは Chrome MV3 のビルドであり、それ以外の何物でもありません。** `wxt.config.ts` は
他のターゲットを宣言しておらず、他のブラウザでビルドを走らせたこともありません。Edge は
同じエンジンなので動くはずですが、誰もスイートを走らせていません。

下の表は*移植したときにぶつかるプラットフォームの天井*であって、サポート表ではありません。
この拡張機能が立脚する API について、
[MDN のブラウザ互換性データ](https://github.com/mdn/browser-compat-data)を、各ブラウザが
最初に出荷したバージョンで読んだものです:

| | Chrome | Edge | Firefox | Safari |
|---|---|---|---|---|
| リクエストヘッダー (`RuleAction.requestHeaders`) | 86 | ✓ | 113 | 16.4 |
| レスポンスヘッダー (`RuleAction.responseHeaders`) | 86 | ✓ | 113 | **なし** |
| サイト単位のランタイム権限 (`optional_host_permissions`) | 102 | ✓ | 128 | 15.5 |
| タブスコープのルール (`RuleCondition.tabIds`) | 92 | ✓ | 113 | **なし** |
| ネイティブメッセージング (`runtime.connectNative`) | 29 | ✓ | 50 | アプリコンテナ |

このうち 2 つは書き出しておく価値があります:

- **Safari はレスポンスヘッダーをまったく変更できません。** この拡張機能がすることの半分
  なので、Safari 版は同じ製品の再コンパイルではなく、より小さな別の製品になります。
- **Safari のネイティブメッセージングは、ディスク上のホストマニフェストではなく、包含する
  macOS アプリに向かいます**(Apple が文書化しているモデル)。`headerlab bridge install`
  はまさにそのマニフェストを書くので、そこにはインストールする先がありません。

まだ作っていない機能は Issue で追跡しています:
[#30](https://github.com/say8425/headerlab/issues/30) ルールセットが 1 つ ·
[#31](https://github.com/say8425/headerlab/issues/31) JSON インポート/エクスポート ·
[#32](https://github.com/say8425/headerlab/issues/32) タブロック UI ·
[#33](https://github.com/say8425/headerlab/issues/33) 正規表現スコープ ·
[#34](https://github.com/say8425/headerlab/issues/34) 手動テーマ切り替え ·
[#35](https://github.com/say8425/headerlab/issues/35) ブリッジの残りのコマンド。

## 開発

```bash
pnpm dev             # WXT 開発サーバ → .output/chrome-mv3-dev をパッケージ化せず読み込み
pnpm check           # CI の 6 ジョブのうち 4 つ: 型検査 · lint · format · 単体テスト
pnpm test            # wxt build && vitest run — 単体テスト、ブラウザなし
pnpm test:packages   # エージェントブリッジのパッケージ群を node:test で — vitest の
                     # glob が届かないため独自の CI ジョブになっています
pnpm check:all       # pnpm check && pnpm test:packages
pnpm test:e2e        # wxt build --mode e2e && playwright test — 本物の Chrome
pnpm build           # 本番ビルド → .output/chrome-mv3
pnpm screenshots     # この README の画像を実際のポップアップから再生成
```

**npm ではなく pnpm。** `package.json` の `packageManager` が正確なバージョンを指定して
いるので、`corepack enable` だけでそのバージョンが入り、他に入れるものはありません。
`package-lock.json` はありません。`pnpm-lock.yaml` が CI の `--frozen-lockfile` が読む
ロックファイルです。

**素の `pnpm exec vitest run` ではなく `pnpm test` を実行してください。** いくつかの
スイートは*ビルド済み*の成果物に対して検証しますが、素のツールはビルドをしません。古い
成果物は、ガードを黙って無効にした偽のグリーンと、1 時間を溶かした偽のレッドの両方を
生んだことがあります。そのため `tests/support/build.ts` が古さを検知し、実行すべき
コマンドを添えて失敗します。

**`pnpm test:e2e` と `pnpm screenshots` は、Playwright が既定でインストールしない
ブラウザを必要とします:**

```bash
pnpm exec playwright install --with-deps --no-shell chromium
```

`--no-shell` が重要です。Playwright の既定のヘッドレスダウンロードは
`chromium-headless-shell` で、これは拡張機能を読み込めない縮小ビルドです — ところが上の
2 つのコマンドは拡張機能を読み込むために存在します。完全なバイナリがないと、依存の欠落
ではなくコードの問題に見える形で失敗します。

残りは `../CLAUDE.md` が持っています: `lint` がなぜ `wxt prepare` を連結するのか、
`postinstall` がなぜ一度も走らないことがあるのか、oxfmt が何をフォーマットし何をしないのか、
そしてすでに誰かの時間を奪ったプラットフォームの罠。

## テスト

3 層です: ブラウザなしの純粋なロジック、手で仕込んだスパイで駆動するアダプタ、そして実際に
読み込まれた拡張機能に対するエンドツーエンド。16 個の e2e のうち 2 つはローカルのエコー
サーバを通じて実際のリクエストを回線に流し、ヘッダーを読み返します — このリポジトリで最も
強い証拠です。

執筆時点: 38 ファイルにわたる単体テスト 820 個と e2e 16 個。そのうち 4 つはブリッジ自身の
もので、実際の `headerlab site add` を実際にインストールされたホストとソケットを経て実際の
ストレージまで届けるものが含まれます。`packages/headerlab` はさらに 140 個を持ち、vitest
ではなく Node 組み込みのテストランナーで走ります。そのパッケージには依存がなく、持つべきでも
ないからです。`vitest.config.ts` の glob がそこに届かないことが、独自の CI ジョブを持つ
理由です。しばらくの間それらは実行されないままマージされており、何も走らせないスイートは
存在しないものより悪いのです。成功を報告してしまうからです。

## ライセンス

Apache-2.0。[LICENSE](../LICENSE) を参照してください。
