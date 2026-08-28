# HeaderLab

[English](../README.md) | [한국어](README.ko.md) | 日本語 | [中文](README.zh.md) | [Español](README.es.md)

HTTP リクエスト・レスポンスヘッダーを Chrome で追加・変更・削除します。ユーザーが許可する
まで、サイトへのアクセス権限は一切持ちません。

[![Chrome Web Store](https://img.shields.io/chrome-web-store/v/kgapijlldieckifoenckgninnepafhnn?logo=googlechrome&logoColor=%234285F4&color=%234285F4&label=chrome%20web%20store)](https://chromewebstore.google.com/detail/headerlab/kgapijlldieckifoenckgninnepafhnn)
[![CLI](https://img.shields.io/npm/v/headerlab?logo=npm&logoColor=%23CC3534&color=%23CC3534&label=cli)](https://www.npmjs.com/package/headerlab)
[![CI](https://github.com/say8425/headerlab/actions/workflows/ci.yml/badge.svg)](https://github.com/say8425/headerlab/actions/workflows/ci.yml)

| ライト | ダーク |
|---|---|
| ![ライトテーマの HeaderLab ポップアップ: Rules 見出しの横のカウントが 3 of 4 live, 1 off を示し、レールに許可済みサイト 2 件、ヘッダールール 4 件](screenshots/popup-light.png) | ![同じポップアップのダークテーマ。OS の設定に従います](screenshots/popup-dark.png) |

## インストール

現在は Chrome のみ対応。Firefox と Safari は対応予定。

### Chrome ウェブストア

[Chrome ウェブストア](https://chromewebstore.google.com/detail/headerlab/kgapijlldieckifoenckgninnepafhnn)からの
インストールを推奨します。

### リリースページ

`extension-v*` リリースにはそれぞれ `headerlab-<version>-chrome.zip` が添付されています。
[リリースページ](https://github.com/say8425/headerlab/releases)から必要なバージョンの
アセットを取得して展開し、`chrome://extensions` → **デベロッパーモード** →
**パッケージ化されていない拡張機能を読み込む** → 展開したディレクトリ。

### 自分でビルドする

```bash
corepack enable          # pnpm は package.json の packageManager フィールドから来ます
pnpm install
pnpm build               # → .output/chrome-mv3
```

`.output/chrome-mv3` を同じ手順で読み込みます。

## AI

HeaderLab は AI コーディングエージェントから操作できます。部品は 3 つあり、順に積み重なり
ます。人が手で使うこともできる CLI、その使い方をエージェントに教えるスキル、そしてその
どちらかを動作中の拡張機能につなぐブリッジです。どれも既定では無効で、どれも自分自身を
有効にはできません。その理由はこのセクションの最後の段落にあります。

### CLI

```bash
npm i -g headerlab
```

`headerlab` が PATH に入り、ターミナルから拡張機能を操作できるようになります。詳しくは
[エージェントブリッジ](#エージェントブリッジ)を参照してください。ランタイム依存がゼロ
なので、クローンからインストールなしで直接実行することもできます:
`node packages/headerlab/bin/headerlab.mjs`。上の一行が人の使い方で、クローンからの実行は
コントリビューターの作業です。この順序は意図的なものです。

### エージェントスキル

`packages/plugin` は CLI を Claude Code と Codex 向けのスキルとして梱包します。ひとつの
`skills/` ツリーを 2 つのマニフェストが共有する形です。どちらもディレクトリには公開して
いないので、両方ともこのリポジトリからインストールします:

```bash
# Claude Code
claude plugin marketplace add say8425/headerlab
claude plugin install headerlab@headerlab

# Codex
codex plugin marketplace add say8425/headerlab
```

スキルは、自身の内容がモデルに届く前に `command -v headerlab` を実行します。CLI がない
という事実を、作業の途中の驚きではなく最初からの事実として届けるためです。**ブリッジを
有効にするまでは `bridge-off` を報告します。** CLI のグローバルインストールは前提条件では
ありません。プラグインが `packages/headerlab` を指す shim を自前で持っています。
`npm i -g headerlab` を併用しても衝突しません。PATH がグローバルのコピーを先に解決します。

普段の言葉で頼めば、スキルがそれを CLI のコマンドに対応づけます:

```text
HeaderLab は今なにをしている?
staging.example.com にだけ X-Debug: on リクエストヘッダーを追加して
api.example.com では Referer ヘッダーを送らないで
ルールを全部いったん止めて、また戻して
実際に変更を許可されているサイトはどれ?
```

最初と最後は読み取りです。`status`、`site ls`、`rule ls`、`state get` が何も書かずに
答えます。中の 3 つは書き込みで、ひとつ知っておくとよい点があります。サイトの追加は
ルールの適用範囲を決めるだけで、そのサイトへのアクセス権を与えるわけではありません。
ポップアップで Grant を押すまで、そのサイトは保留のままです。スキルには、すでに有効に
なったかのように流さず、この事実を伝えるよう指示してあります。

### エージェントブリッジ

ブリッジは、上の 2 つのどちらかを動作中の拡張機能へ運ぶものです:

```bash
headerlab site add staging.example.com
headerlab rule add --target request --op set --name Authorization --value "Bearer $TOKEN"
```

ブリッジは、人がポップアップでスイッチを入れるまで無効です。CLI はサイトへのアクセス権を
付与することも、ブリッジを有効にすることもできません。Chrome がどちらも
ユーザージェスチャーからしか受け取らないからです。マシンの外に出ていくものはありません。
CLI・ホスト・拡張機能は、ユーザーごとのディレクトリにある Unix ドメインソケットで
出会います。ネットワークソケットは使いません。

[`docs/agent-bridge.ja.md`](agent-bridge.ja.md) にそのすべてがあります。プロトコル、
コマンド、終了コード、有効にする手順、そして取り違えてはいけない 5 つのことです。

## できること

- 任意のヘッダーを、**リクエスト**側でも**レスポンス**側でも**設定・追加・削除**できます。
  `append` は Chrome によってリクエストヘッダー 21 個の許可リストに制限されており、
  HeaderLab はその外にあるルールを名指しします。これは聞こえるより重要です。Chrome は
  ルールセットをルール単位ではなく丸ごと拒否するため、そうしたルールが 1 つあると他の
  すべても止まります。黙って起きることはありません。ポップアップが登録の失敗を表示します。
- **サイト単位のスコープ。** サイトはホストで一致を見ます。ポートやパスは追加時に落とされ、
  保存された値がそのまま動作する値になります。レールに見えているものが、実際に回線へ出て
  いくものです。
- **すべてのサイトに適用。** 空のサイト一覧ではなく、明示的なモードとして扱います。この
  モードは `<all_urls>` を必要としますが、スイッチ自体はそれを要求しません。要求するのは
  隣の Grant ボタンです。
- **リクエストタイプでの絞り込み。** Chrome のリソースタイプ 8 種を個別にチェックできます。
  `main_frame` が既定で有効なのは、DNR 自身の既定がそれを黙って除外するからです。
- スイッチひとつで**全体を一時停止**できます。ツールバーのアイコンも合わせて灰色になり、
  Service Worker が起きたときに再適用されます。
- **OS のテーマに従います。** ライトでもダークでも、最初の描画より前に決まります。

権限はサイトごとに、そのサイト名が書かれた行で要求します。ホスト名を入力したりスイッチを
切り替えたりした副作用として要求することはありません。**Grant** を押すまで、その行は
アンバー色でその状態を告げます。**Rules** 見出しの横のカウントも、その状態を実際より
良くは見せません。許可していないホストにだけ掛かったルールは **blocked** として数え、
live として数えることは決してありません。まだ待っているホストはその横に名前で挙がります。
カウントは両端で正直なままです("3 of 4 live · 1 off · 1 site needs access"):

![internal.example.com のサイト行が保留状態のアンバー色で、Grant ボタンとともに表示され、Rules 見出しの横のカウントが 3 of 4 live, 1 off, 1 site needs access を示している様子](screenshots/popup-permission.png)

ルールが出ていくのを妨げるものは、何であれそのルール自身の行で語られ、**Rules** 見出しの
横で数えられます。下は 2 番目のルールが、Chrome が追加しないリクエストヘッダーへの
`append` を要求
した場合です。行はどのヘッダーかと、代わりに何をすべきかを告げます。読み取り部は
**2 of 4 live · 1 off · 1 blocked** を示し、そのメッセージのために何も動きません:

![2 番目の行の値の位置に "Use Set. Chrome does not append request headers." が赤で表示されたルール一覧と、2 of 4 live, 1 off, 1 blocked を示す Rules 見出し横のカウント](screenshots/popup-blocked.png)

<sub>Chrome に読み込んだ実際の本番ビルドから撮影しています。手を入れたのはマニフェストだけ
です。例示用の 2 ホストを事前に許可しておかないと、ネイティブの権限ダイアログなしに許可
済みの状態を撮影できないためです。</sub>

## 信頼方針

- **インストール時点でホスト権限なし。** マニフェストの `permissions` はちょうど `storage`
  と `declarativeNetRequestWithHostAccess` だけです。`optional_host_permissions:
  ["<all_urls>"]` も宣言していますが、それ自体は何も付与しません。Chrome は、宣言して
  いないオリジンを拡張機能が要求することを拒みます。つまりあの行は、ランタイムの Grant
  ボタンを合法にするものであって、不要にするものではありません。サイトへのアクセスは
  ユーザーがホストごとにランタイムで付与し、Chrome からいつでも取り消せます。
- **ネットワーク呼び出しなし。** 分析も、テレメトリも、リモート設定も、更新 ping も
  ありません。配布されるバンドルはネットワークプリミティブを*呼び出しません*。信じる
  必要はなく、自分で確認できます:

  ```bash
  pnpm build
  grep -rE 'fetch\(|XMLHttpRequest|WebSocket|sendBeacon' .output/chrome-mv3
  ```

  何も出ません。このパターンが呼び出しとコンストラクタの形だけに一致するのは意図的です。
  大文字小文字を無視して単語をそのまま検索すると、バンドルに 16 回当たります。しかし
  そのすべてが呼び出しではなく、文字列か識別子です。React DOM の `prefetchDNS`、
  `fetchPriority`、`dns-prefetch`、そしてリテラルの `"xmlhttprequest"` と `"websocket"`
  です。後の 2 つは declarativeNetRequest のリソースタイプ名ですが、入ってくる経路が
  違います。`xmlhttprequest` はポップアップがチェックボックスとして提供する 8 つのうちの
  1 つで、そこでは `xhr` と表示されます。`websocket` のほうは、保存された状態を検証する
  15 個のリソースタイプ enum の要素にすぎません。見つけたときに「見破った嘘」ではなく
  「想定どおり」と読めるよう、ここに書いておきます。
- **コンテンツスクリプトなし。** どのページにも何も注入しません。ヘッダーを変更するのは
  Chrome の `declarativeNetRequest` エンジンで、このエンジンがリクエストの中身を拡張機能に
  渡すことはありません。
- **外部リソースなし。** CDN もウェブフォントもリモート画像もありません。
- **黙った失敗なし。** ルールが出ていくのを妨げるものは画面に出ます。足りない権限、使えない
  ホスト名、Chrome が拒否するヘッダー名。適用されていないルールは、必ずその理由を語ります。

## 制約

詳しくは [MDN のブラウザ互換性データ](https://github.com/mdn/browser-compat-data)を参照してください。

| | Chrome | Edge | Firefox | Safari |
|---|---|---|---|---|
| リクエストヘッダー (`RuleAction.requestHeaders`) | 86 | ✓ | 113 | 16.4 |
| レスポンスヘッダー (`RuleAction.responseHeaders`) | 86 | ✓ | 113 | **なし** |
| サイト単位のランタイム権限 (`optional_host_permissions`) | 102 | ✓ | 128 | 15.5 |
| タブスコープのルール (`RuleCondition.tabIds`) | 92 | ✓ | 113 | **なし** |
| ネイティブメッセージング (`runtime.connectNative`) | 29 | ✓ | 50 | 14 (包含アプリ) |

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

**正しさはすべて、`chrome.*` を決して import しない純粋な層にあります。** `compile()` は
アプリケーションの状態全体を declarativeNetRequest のルールと診断の一覧に変換します。
ポップアップも同じ状態に同じ関数を走らせます。だから、画面が語ることとブラウザに告げた
ことが食い違うことはありません。

**reconcile ループはひとつだけです。** ストレージの変更、ワーカーの起動、権限の付与や
取り消し。どのトリガーも `lib/sync/ruleSync.ts` の `reconcile()` に集まり、そこで一から
再コンパイルしてルールセットを丸ごと置き換えます。冪等であり、状態が下流へ漏れていく
第二の経路はありません。

この形は選んだものではなく強制されたものです。`@webext-core/fake-browser` は
`declarativeNetRequest` と `permissions.*` を throw するスタブとして実装しているため、
ブラウザを模したテストができません。ロジックからブラウザを無関係にする、というのがその
答えです。

設計文書は `docs/superpowers/specs/` にあります。その背後にある、計測された
プラットフォーム制約は `docs/research/` にあります。

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
いるので、`corepack enable` だけでそのバージョンが入り、ほかに入れるものはありません。
`package-lock.json` はありません。CI が `--frozen-lockfile` で読むロックファイルは
`pnpm-lock.yaml` です。

**素の `pnpm exec vitest run` ではなく `pnpm test` を実行してください。** いくつかの
スイートは*ビルド済み*の成果物に対して検証しますが、素のツールはビルドをしません。古い
成果物は、ガードを黙って無効にした偽のグリーンと、1 時間を溶かした偽のレッドの両方を
生んだことがあります。そのため `tests/support/build.ts` が古さを検知し、実行すべき
コマンドを添えて失敗します。

**`pnpm test:e2e`、`pnpm screenshots`、`pnpm store:assets` は、Playwright が既定では
インストールしないブラウザを必要とします:**

```bash
pnpm exec playwright install --with-deps --no-shell chromium
```

`--no-shell` が重要です。Playwright が既定でダウンロードするヘッドレス版は
`chromium-headless-shell` で、これは拡張機能を読み込めない縮小ビルドです。ところが上の
2 つのコマンドは、拡張機能を読み込むために存在します。完全なバイナリがないと、依存の
欠落ではなくコードの問題に見える形で失敗します。

**`pnpm screenshots` と `pnpm store:assets` は追跡中の PNG を上書きします。** 対象は
それぞれ `docs/screenshots/` と `docs/store/assets/` で、後者はディレクトリを空にしてから
8 枚を書き直します。それがこれらのコマンドの仕事ですが、一度実行すると `git status` に
変更が残ります。UI が実際に変わったときだけコミットしてください。

**e2e ビルドは配布ビルドにないホスト権限を持ちます。このページ冒頭の主張を考えれば、
声に出して言う価値があります。** `pnpm test:e2e` は本番ディレクトリの隣に
`.output/chrome-mv3-e2e` と `.output/chrome-mv3-bridge-e2e` を作ります。前者は
`http://127.0.0.1/*` を宣言し(`wxt.config.ts`)、Playwright がクリックできないランタイムの
ダイアログなしにローカルのエコーサーバを動かせるようにします。後者は `nativeMessaging` を
そのまま付与します。どちらも本番には届かないことを `tests/unit/manifest.test.ts` が表明
しており、e2e スイートを走らせても `.output/chrome-mv3` には触れません。新しい本番ビルドは
`pnpm build` で作ってください。

残りは `../CLAUDE.md` にあります。`lint` がなぜ `wxt prepare` を連結するのか、
`postinstall` がなぜ一度も走らないことがあるのか、oxfmt が何をフォーマットして何をしない
のか、そしてすでに誰かの時間を奪ったプラットフォームの罠です。

## テスト

層は 3 つです。ブラウザなしの純粋なロジック、手で仕込んだスパイで駆動するアダプタ、そして
実際に読み込まれた拡張機能に対するエンドツーエンド。e2e のうち 2 つは、ローカルのエコー
サーバを通じて実際のリクエストを回線に流し、ヘッダーを読み返します。これがこのリポジトリで
最も強い証拠です。ブリッジも自身の分を持っており、実際の `headerlab site add` を実際に
インストールされたホストとソケットを経て実際のストレージまで届けるものがその 1 つです。

`packages/headerlab` は自前のスイートを持ち、vitest ではなく Node 組み込みのテストランナー
で走ります。そのパッケージには依存がなく、持つべきでもないからです。`vitest.config.ts` の
glob はそこに届きません。それが、独自の CI ジョブを持つ理由です。しばらくの間それらは
実行されないままマージされていました。何も走らせないスイートは、存在しないものより悪い
です。成功を報告してしまうからです。

## ライセンス

Apache-2.0。[LICENSE](../LICENSE) を参照してください。
