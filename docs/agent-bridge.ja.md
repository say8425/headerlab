# エージェントブリッジ

[English](agent-bridge.md) | [한국어](agent-bridge.ko.md) | 日本語 | [中文](agent-bridge.zh.md) | [Español](agent-bridge.es.md)

[HeaderLab](README.ja.md) の一部です。

AI エージェントが、人がポップアップをクリックする代わりにターミナルから HeaderLab を操作
できます:

```bash
headerlab site add staging.example.com
headerlab rule add --target request --op set --name Authorization --value "Bearer $TOKEN"
```

端末では人が読むための出力を、パイプに渡すか `--json` を付ければ成功でも失敗でも 1 つの
JSON オブジェクトを出します。`--human` は `--json` の逆で、パイプに渡しても人が読む形式を
強制します。機械ではなく人が読むログを残すときに使うものです。両方を渡すのは優先順位の
問題ではなく矛盾なので、CLI は何もせずに拒否し 2 で終了します。終了コードが失敗の種類に
名前を与えます:

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

## コマンド

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

## 取り違えてはいけない 5 つのこと

製品自身の主張です。ここで間違えるのは、この文書を丸ごと省くより悪いことです。

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

## 有効にする

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
