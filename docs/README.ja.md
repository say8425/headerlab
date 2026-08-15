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

## エージェントブリッジ

AI エージェントが、人がポップアップをクリックする代わりにターミナルから HeaderLab を操作
できます:

```bash
headerlab site add staging.example.com
headerlab rule add --target request --op set --name Authorization --value "Bearer $TOKEN"
```

端末では人が読むための出力を、パイプに渡すか `--json` を付ければ成功でも失敗でも 1 つの
JSON オブジェクトを出します。終了コードが失敗の種類に名前を与えます:

| 終了コード | 意味 |
|---|---|
| `0` | 成功 |
| `2` | あなたの入力 — CLI が自分で拒否し、何もこの機械の外に出ていません |
| `3` | 話しかけるブリッジがありません |
| `4` | 接続はできましたが、やり取りが失敗しました |
| `1` | 拡張機能が要求を拒否しました |

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

**この図が運びたい唯一の事実は方向です: ホストから拡張機能へ先に話しかけることはできません。**
Chromium にはネイティブ側から接続する経路もありますが、既定でオフのフラグの向こうにあるため、
設計は拡張機能を唯一の開始者として扱います。拡張機能がポートを開き、その副作用として Chrome
がホストプロセスを起動し、ホストが Unix ソケットで待ち受け、そこに接続するのが CLI です —
逆方向はありません。書き込みは JSON 1 行として入り、stdio 上でフレーミングされて拡張機能へ
渡り、`local:state` に適用され、他のあらゆるトリガーがすでに集まるその `reconcile()` が
拾います: **新しいトリガーであって、新しい writer ではありません。**

### コマンド

4 つは読むだけで何も変えません: `status`、`site ls`、`rule ls`、`state get`。1 つのクエリを
送り、ポップアップが描画に使うのと**同じ純粋関数**から答えます。だから CLI の言うことと
レールの見せるものが食い違う余地がありません。

```bash
headerlab status
headerlab state get --json | jq .state | headerlab state set - --force
```

`status` は、ブリッジがないことをエラーではなく事実として扱う唯一のコマンドです — ローカルに
インストールされているものだけで答え、`live: false` と言って終了コード 0 で終わります。
コミットのないリポジトリでの `git status` と同じ振る舞いです。残りの 3 つは 3 で終わります。

9 つは書き込みとしてブリッジのソケットを通ります: ルールセットのスコープを決める
`site add|rm` と `site all-sites on|off`、ヘッダールールを編集する `rule add|rm|toggle`、
全体を止めて再開する `pause`/`resume`、そして保存された状態を丸ごと置き換える
`state set <file|->` — 最後のものは stdin が端末でないとき `--force` を要求します。取り消せ
ない上書きだからです。

残りの 3 つはそのソケットに一切触れません — ネイティブメッセージングのホストマニフェストと
Chrome が実行するランチャースクリプトを管理するもので、そもそもソケットを可能にしているのが
それです: `bridge install`、`bridge uninstall`、`bridge status`。最後のものは、ランチャーが
指すファイルがもう存在しないときに `entryMissing` を報告します —
`npm uninstall -g headerlab`、アップグレード、あるいはグローバル prefix を移動させる nvm の
切り替えの症状です。`bridge install` を再実行すれば直ります。

フラグとエラーコードまでの完全なリファレンスは
[`packages/plugin/skills/headerlab/SKILL.md`](../packages/plugin/skills/headerlab/SKILL.md)
にあります。

### 取り違えてはいけない 5 つのこと

製品自身の主張です。ここで間違えるのは、この節を丸ごと省くより悪いことです。

- **人が有効にするまでブリッジは無効です。** `nativeMessaging` をオプション権限として使い、
  ポップアップのボタンから、Chrome 自身の同意ダイアログの向こう側で要求されます —
  インストール時点の `permissions` リストは変わりません。推測ではなく実測です:
  [`docs/research/2026-08-11-native-messaging-spike.md`](research/2026-08-11-native-messaging-spike.md)
  が同意ダイアログが実際に出ること、そして 2 回目の接続ではダイアログなしに権限が保たれることを
  記録しています。
- **CLI はサイト権限を付与できません。** `site add` と `site all-sites on` はルールが何に
  *スコープ*されるかを変えるだけです — その行は、手で追加したサイトと同じく、人が **Grant**
  を押すまで保留のままです。Chrome が権限付与にユーザージェスチャーを要求し、その制限は
  迂回せずに守られています。
- **CLI はブリッジも有効にできません。** `chrome.permissions.request()` は解決するのに
  ユーザージェスチャーを要求します。`headerlab bridge enable` はありませんし、動く形で
  生まれることもありません: 誰も **Enable** を押していないブリッジの傍らでの
  `bridge install` は、決して接続しないファイルを書くだけです。
- **マシンの外に出るものはありません。** CLI・ホスト・拡張機能は、権限が制限された
  ユーザーごとのディレクトリにある Unix ドメインソケットだけで会話し、ネットワークソケットは
  使いません。**`$TMPDIR` ではなく**、それは意図的です: `socketDir()` は各プロセスが継承した
  `$TMPDIR` を読む代わりに OS に尋ねます(`getconf DARWIN_USER_TEMP_DIR` を絶対パスで)。
  ホストは Chrome の環境を、CLI はターミナルの環境を継承するため、2 つのコピーが食い違っても
  それを示す失敗がないからです。上書きする変数は 1 つだけあり(`HEADERLAB_SOCKET_DIR`)、
  それは呼び出し側それぞれではなく関数の*内側*で一度だけ読まれます — 同じ理由でです。`tests/unit/outbound.test.ts` が `packages/headerlab/` 配下のすべての `.mjs`
  から外向きのプリミティブ — `fetch`、`WebSocket`、`node:https`、`.listen(<ポート番号>)`
  呼び出し — を禁じ、自身の docblock が見えないものを自分で述べています: ポート検査は
  ソース中のリテラルな数字に一致するので、`server.listen(8080)` は捕まり
  `server.listen(tcpPort)` は捕まりません。暗黙に任せず書いてあるのは、セキュリティの保証を
  誇張することがこのリポジトリの最も避けたいことだからです。
- **このビルドは正規表現フィルタを拒否します。** `state set` はペイロードを検証しますが、
  ポップアップに正規表現エディタはなく、ここで
  `chrome.declarativeNetRequest.isRegexSupported()` を呼ぶ場所もありません — パターンが有効な
  RE2 かどうかの唯一の権威です。ですから `filter.mode: 'regex'` のルールは目に見えないまま
  適用され、責任あるパターンをどの画面も示せないままヘッダーが変わることになります。
  `lib/bridge/port.ts` がそのようなペイロードをエラーコード `unsupported` で即座に拒否します
  — 一緒に使える正規表現エディタができるまで
  ([#33](https://github.com/say8425/headerlab/issues/33))。

### 有効にする

1. ポップアップのブリッジ行で **Enable** を押します — それまでは **Bridge off** と読めます。
   これが Chrome 自身の同意ダイアログを通じて `nativeMessaging` 権限を要求します。
2. `chrome://extensions` から id をコピーしてインストーラを実行します:

   ```bash
   headerlab bridge install --extension-id <id>
   ```

3. ポップアップが **Bridge live** になります。

`--extension-id` は CLI 自身の README も先に挙げる指示です。常に当てはまる側だからです —
npm で CLI を入れた人には、指し示すべき拡張機能のディレクトリがありません。
`--load-path <dir>` はローカルの展開ビルドで作業していてパスがすでに手元にあるときの代替
ですが、便利さと同じだけ落とし穴です: シンボリックリンク、末尾のスラッシュ、あるいは同じ
ディレクトリを違う綴りで書いたパスが、それぞれ別の id にハッシュされ、食い違ったマニフェストは
きれいにインストールされたうえで単に接続しません。

どちらの場合もインストーラは使った id をそのまま返します。CLI の内部には、それを Chrome が
実際に読み込んだものと照合する手段がないからです。返ってきた id を `chrome://extensions` と
見比べることが存在する唯一の検査であり、`tests/e2e/bridge.spec.ts` が動いているブラウザを
相手にまさにそれを行います。

**パッケージング。** `packages/headerlab` は `headerlab` コマンド**と** Chrome が起動する
ホストを、2 つではなく 1 つのパッケージとして配布します。`bridge install` はホストの
エントリファイルを絶対パスで名指すランチャーを書きますが、ホストなしで公開された CLI も
そのランチャーを書いてしまいます — インストール手順は、自分が名指したファイルが対象マシンに
存在しないことを見られません — そして Chrome はその失敗を、拒否されたマニフェストや食い違った
id と同じメッセージで報告します。1 つの tarball から両方を配ることで、その失敗の仕方が文書
ではなく構造として不可能になります。

設計自身の §2/§3 が名前を挙げたもののうち 2 つはまだ存在しません: `headerlab diagnostics`
は今後も作りません — `status` が同じペイロードを運んでおり、1 つのクエリに 2 つ目の名前を
与えるのは機能ではないからです — そして `state snapshots`/`state restore <id>` が読み戻す
はずだった、raw な書き込みの前のスナップショットもありません
([#35](https://github.com/say8425/headerlab/issues/35))。`state set` はスキーマ検証を行い
`--force` を要求しますが、履歴は残しません。

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
pnpm test:e2e        # e2e モード 2 つをビルドして playwright test — 本物の Chrome
pnpm typecheck       # wxt prepare && tsc --noEmit
pnpm lint            # wxt prepare && oxlint --deny-warnings   (lint:fix で修正)
pnpm format:check    # oxfmt --check             (pnpm format で書き込み)
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

**`pnpm screenshots` は追跡中の PNG を上書きします**(`docs/screenshots/`)。それがこの
コマンドの仕事ですが、一度実行すると `git status` に変更が残ります — UI が実際に変わった
ときだけコミットしてください。

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
