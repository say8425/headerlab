# HeaderLab

[English](../README.md) | [한국어](README.ko.md) | 日本語 | [中文](README.zh.md) | [Español](README.es.md)

HTTP リクエスト・レスポンスヘッダーを Chrome で追加・変更・削除します。あなたが許可する
まで、サイトへのアクセス権限は一切持ちません。

[![Chrome Web Store](https://img.shields.io/chrome-web-store/v/kgapijlldieckifoenckgninnepafhnn?logo=googlechrome&logoColor=%234285F4&color=%234285F4&label=chrome%20web%20store)](https://chromewebstore.google.com/detail/headerlab/kgapijlldieckifoenckgninnepafhnn)
[![CLI](https://img.shields.io/npm/v/headerlab?logo=npm&logoColor=%23CC3534&color=%23CC3534&label=cli)](https://www.npmjs.com/package/headerlab)
[![CI](https://github.com/say8425/headerlab/actions/workflows/ci.yml/badge.svg)](https://github.com/say8425/headerlab/actions/workflows/ci.yml)

| ライト | ダーク |
|---|---|
| ![ライトテーマの HeaderLab ポップアップ: 4 つのルールのうち 3 つが有効、許可済みサイト 2 件、ヘッダールール 4 件](screenshots/popup-light.png) | ![同じポップアップのダークテーマ。OS の設定に従います](screenshots/popup-dark.png) |

## インストール

Chrome 専用です — [制約](#制約)を参照。

### Chrome ウェブストア

**[インストール](https://chromewebstore.google.com/detail/headerlab/kgapijlldieckifoenckgninnepafhnn)**
— 審査済み、自動で更新されます。まずこれを。

### リリースページ

`extension-v*` リリースにはそれぞれ `headerlab-<version>-chrome.zip` が添付されています
([リリース](https://github.com/say8425/headerlab/releases))。展開して `chrome://extensions` →
**デベロッパーモード** → **パッケージ化されていない拡張機能を読み込む** → 展開した
ディレクトリ。

### 自分でビルドする

```bash
corepack enable          # pnpm は package.json の packageManager フィールドから来ます
pnpm install
pnpm build               # → .output/chrome-mv3
```

`.output/chrome-mv3` を同じ手順で読み込みます。下の信頼方針を、ただ述べられただけのもの
ではなく確認できるものにしているのがこれです。

## AI

HeaderLab は AI コーディングエージェントから操作できます。積み重なる 3 つの部品から成ります:
人が手で使うこともできる CLI、エージェントにその使い方を教えるスキル、そしてそのどちらかを
動いている拡張機能につなぐブリッジです。どれも既定では有効になっておらず、どれも自分自身を
有効にすることはできません — その理由はこのセクションの最後の段落にあります。

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

普段の言葉で頼めば、スキルがそれを CLI コマンドに移します:

```text
HeaderLab は今なにをしている?
staging.example.com にだけ X-Debug: on リクエストヘッダーを追加して
api.example.com では Referer ヘッダーを送らないで
ルールを全部いったん止めて、また戻して
実際に変更を許可されているサイトはどれ?
```

最初と最後は読み取りです — `status`、`site ls`、`rule ls`、`state get` が何も書かずに
答えます。中の三つは書き込みで、ひとつ知っておくとよい点があります: サイトを追加するのは
ルールの適用範囲を決めるだけで、そのサイトへのアクセス権を与えるわけではありません。
ポップアップで Grant を押すまでそのサイトは保留のままで、スキルはすでに有効であるかのように
流さず、その事実を伝えるよう指示されています。

### エージェントブリッジ

ブリッジは、上の 2 つのどちらかを動いている拡張機能へ運ぶものです:

```bash
headerlab site add staging.example.com
headerlab rule add --target request --op set --name Authorization --value "Bearer $TOKEN"
```

ブリッジは人がポップアップでスイッチを入れるまで無効で、CLI はサイト権限を付与すること
もブリッジを有効にすることもできません — Chrome がどちらもユーザージェスチャーからしか
受け取らないからです。マシンの外に出るものはありません: CLI・ホスト・拡張機能はユーザー
ごとのディレクトリにある Unix ドメインソケットで出会い、ネットワークソケットは使いません。

[`docs/agent-bridge.ja.md`](agent-bridge.ja.md) がそのすべてです — プロトコル、コマンド、
終了コード、有効にする手順、そして取り違えてはいけない 5 つのこと。

## できること

- 任意のヘッダーを **リクエスト** 側でも **レスポンス** 側でも **設定・追加・削除**します。
  `append` は Chrome によってリクエストヘッダー 21 個の許可リストに制限されており、
  HeaderLab はその外にあるルールを名指しします。これは聞こえるより重要です — Chrome は
  ルールセットをルール単位ではなく丸ごと拒否するため、そうしたルールが 1 つあると他の
  すべても止まります。これは黙って起きません — ポップアップが登録の失敗を表示します。
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
  です。後の 2 つは declarativeNetRequest のリソースタイプ名ですが、入ってくる経路が
  違います — `xmlhttprequest` はポップアップがチェックボックスとして提供する 8 つのうちの
  1 つ(そこでは `xhr` と表示されます)で、`websocket` は保存された状態を検証する 15 個の
  リソースタイプ enum の要素にすぎません。見つけたときに「見破った嘘」ではなく「想定どおり」
  と読めるよう、ここに書いておきます。
- **コンテンツスクリプトなし。** どのページにも何も注入しません。ヘッダーは Chrome の
  `declarativeNetRequest` エンジンが変更し、このエンジンはリクエストの中身を拡張機能に
  渡しません。
- **外部リソースなし。** CDN も、ウェブフォントも、リモート画像もありません。
- **黙った失敗なし。** ルールが出ていくのを妨げるものは画面に出ます — 足りない権限、
  使えないホスト名、Chrome が拒否するヘッダー名。適用されていないルールは必ず理由を語ります。

## 制約

**これは Chrome MV3 のビルドであり、それ以外の何物でもありません。** `wxt.config.ts` は
他のターゲットを宣言しておらず、他のブラウザでビルドを走らせたこともありません。Edge は
同じエンジンなので動くはずですが、誰もスイートを走らせていません。

下の表は*移植したときにぶつかるプラットフォームの天井*であって、サポート表ではありません。
この拡張機能が立脚する API について、
[MDN のブラウザ互換性データ](https://github.com/mdn/browser-compat-data)を、各ブラウザが
最初に出荷したバージョンで読んだものです。Edge の列が数値でなく `✓` なのは、BCD が
`mirror` と記録しているからです — Chrome に追随します:

| | Chrome | Edge | Firefox | Safari |
|---|---|---|---|---|
| リクエストヘッダー (`RuleAction.requestHeaders`) | 86 | ✓ | 113 | 16.4 |
| レスポンスヘッダー (`RuleAction.responseHeaders`) | 86 | ✓ | 113 | **なし** |
| サイト単位のランタイム権限 (`optional_host_permissions`) | 102 | ✓ | 128 | 15.5 |
| タブスコープのルール (`RuleCondition.tabIds`) | 92 | ✓ | 113 | **なし** |
| ネイティブメッセージング (`runtime.connectNative`) | 29 | ✓ | 50 | 14 (包含アプリ) |

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
[#34](https://github.com/say8425/headerlab/issues/34) 手動テーマ切り替え。

## アーキテクチャ

```
lib/model/       型、zod スキーマ、既定値、マイグレーション        純粋
lib/compile/     AppState → DNR ルール + 診断                    純粋
lib/permissions/ origins.ts, audit.ts は純粋 · probe.ts がブラウザを呼ぶ
lib/view/        ポップアップのビューモデル                       純粋
lib/bridge/      protocol.ts (コマンドスキーマ), apply.ts (リデューサ),
                 query.ts (状態 → StatusPayload)                      純粋
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

## 開発

```bash
pnpm dev             # WXT 開発サーバ → .output/chrome-mv3-dev をパッケージ化せず読み込み
pnpm check           # CI の 6 ジョブのうち 4 つ: 型検査 · lint · format · 単体テスト
pnpm test            # wxt build && vitest run — 単体テスト、ブラウザなし
pnpm test:packages   # エージェントブリッジのパッケージ群を node:test で — vitest の
                     # glob が届かないため独自の CI ジョブになっています
pnpm check:all       # pnpm check && pnpm test:packages
pnpm test:e2e        # e2e モード 2 つをビルドして playwright test — 本物の Chrome
pnpm typecheck       # wxt prepare && tsc --noEmit
pnpm lint            # wxt prepare && oxlint --deny-warnings   (lint:fix で修正)
pnpm format:check    # oxfmt --check             (pnpm format で書き込み)
pnpm build           # 本番ビルド → .output/chrome-mv3
pnpm screenshots     # この README の画像を実際のポップアップから再生成
pnpm store:assets    # Chrome ウェブストア用の画像 8 枚を再生成 → docs/store/assets/
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

**`pnpm test:e2e`、`pnpm screenshots`、`pnpm store:assets` は、Playwright が既定で
インストールしないブラウザを必要とします:**

```bash
pnpm exec playwright install --with-deps --no-shell chromium
```

`--no-shell` が重要です。Playwright の既定のヘッドレスダウンロードは
`chromium-headless-shell` で、これは拡張機能を読み込めない縮小ビルドです — ところが上の
2 つのコマンドは拡張機能を読み込むために存在します。完全なバイナリがないと、依存の欠落
ではなくコードの問題に見える形で失敗します。

**`pnpm screenshots` と `pnpm store:assets` は追跡中の PNG を上書きします**(それぞれ
`docs/screenshots/` と `docs/store/assets/`。後者はディレクトリを空にしてから 8 枚を
書き直します)。それがこれらのコマンドの仕事ですが、一度実行すると `git status` に変更が
残ります — UI が実際に変わったときだけコミットしてください。

**e2e ビルドは配布ビルドにないホスト権限を持ちます。このページ冒頭の主張を考えれば、
声に出して言う価値があります。** `pnpm test:e2e` は本番ディレクトリの隣に
`.output/chrome-mv3-e2e` と `.output/chrome-mv3-bridge-e2e` を作ります。前者は
`http://127.0.0.1/*` を宣言し(`wxt.config.ts`)、Playwright がクリックできない
ランタイムのダイアログなしにローカルのエコーサーバを動かせるようにします。後者は
`nativeMessaging` をそのまま付与します。`tests/unit/manifest.test.ts` がどちらも本番に
届かないことを表明し、e2e スイートを走らせても `.output/chrome-mv3` には触れません —
新しい本番ビルドは `pnpm build` で作ってください。

残りは `../CLAUDE.md` が持っています: `lint` がなぜ `wxt prepare` を連結するのか、
`postinstall` がなぜ一度も走らないことがあるのか、oxfmt が何をフォーマットし何をしないのか、
そしてすでに誰かの時間を奪ったプラットフォームの罠。

## テスト

3 層です: ブラウザなしの純粋なロジック、手で仕込んだスパイで駆動するアダプタ、そして実際に
読み込まれた拡張機能に対するエンドツーエンド。e2e のうち 2 つはローカルのエコーサーバを
通じて実際のリクエストを回線に流し、ヘッダーを読み返します — このリポジトリで最も強い証拠
です。ブリッジも自身の分を持っており、実際の `headerlab site add` を実際にインストール
されたホストとソケットを経て実際のストレージまで届けるものがその 1 つです。

`packages/headerlab` は自前のスイートを持ち、vitest ではなく Node 組み込みのテストランナー
で走ります。そのパッケージには依存がなく、持つべきでもないからです。`vitest.config.ts` の
glob がそこに届かないことが、独自の CI ジョブを持つ理由です。しばらくの間それらは実行され
ないままマージされており、何も走らせないスイートは存在しないものより悪いのです。成功を
報告してしまうからです。

## ライセンス

Apache-2.0。[LICENSE](../LICENSE) を参照してください。
