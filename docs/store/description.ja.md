# Detailed description — 日本語 (`ja`)

Paste the block below into **Store listing → Description**, with the language
dropdown set to Japanese. It is plain text: the store keeps line breaks and
renders nothing else, so the bullets and headings are literal characters.

```text
HeaderLab は、あなたが選んだサイトの HTTP リクエスト・レスポンスヘッダーを、Chrome 自身の declarativeNetRequest エンジンで設定・追加・削除します。

インストール時点では何も要求しません。マニフェストが要求する権限はちょうど 2 つ — "storage" と "declarativeNetRequestWithHostAccess" — だけで、ホストへのアクセス権限は一切ありません。サイトが変更の対象になるのは、そのサイト名が書かれた行で Grant（許可）を押したあとだけで、その許可は Chrome からいつでも取り消せます。

できること

• 任意のヘッダーを、リクエスト側でもレスポンス側でも設定・追加・削除します。
• サイト単位のスコープ。サイトはホストでマッチするので、追加するときにポートやパスは落とされます — ポップアップに表示されているものが、そのまま実際の通信で使われます。
• すべてのサイトに適用。空のサイト一覧ではなく、明示的なモードとして扱います。このモードはすべてのサイトへのアクセス権限を必要としますが、スイッチはそれを要求しません。要求するのは別に置かれた Grant ボタンで、押すまではその行にその旨が表示されます。
• リクエストタイプでの絞り込み。Chrome のリソースタイプ 8 種を、それぞれ個別のチェックボックスで扱います。main_frame が既定で有効なのは、Chrome 自身の既定がそれを黙って除外するからです。
• スイッチひとつで全体を一時停止。ツールバーのアイコンもそれに合わせて灰色になり、ブラウザを再起動しても灰色のままです。
• OS のライト／ダーク設定に従います。最初の描画より前に決まります。

静かに失敗することはありません

ルールの適用を妨げるものは何であれ、そのルール自身の行に表示され、Rules 見出しの隣で数えられます — 足りない権限、使えないホスト名、Chrome が拒否するヘッダー名。

この数字は水増ししません。まだ許可していないホストだけを対象にしたルールは、live ではなく blocked として数えます。そして、許可待ちのホスト名がその隣に並びます。

これは些細に聞こえますが、実際にはもっと重要です。Chrome はルールセットをルール単位ではなく丸ごと受け入れるか拒否するため、不正な行が 1 つあると他のすべての行も適用されなくなります。HeaderLab はその行を名指しし、代わりに何をすべきかを示します。

しないこと

• ネットワーク呼び出しなし。分析も、テレメトリも、リモート設定も、更新 ping もありません。
• コンテンツスクリプトなし。どのページにも何も注入せず、拡張機能がページの中身を受け取ることもありません。
• リモートコードなし。パッケージの外から何かを取得することも、実行することもありません。
• 外部リソースなし。CDN も、ウェブフォントも、リモート画像もありません。
• マシンの外に出るものはありません。ルールは Chrome 自身の拡張機能ストレージに保存されます。

ソースは公開されているので、ここまでのどれも鵜呑みにする必要はありません。自分で確認できます:
https://github.com/say8425/headerlab

オプション: ターミナルから操作する

別途提供されているオプションのコマンドラインツールが、ルールの変更を代わりに適用できます — クリックより入力のほうがよい人や、AI コーディングアシスタントに、作業しながらヘッダーを設定させたい人に向いています。ポップアップでスイッチを入れるまでは無効で、自分でインストールする補助プログラムを必要とし、ネットワークではなく自分のマシン上のローカルソケットで通信します。スイッチに触れなければ、どれも動きません。

オープンソース、Apache-2.0。
```

## How this was produced

Translated from [`description.en.md`](description.en.md), then reviewed against
the English source and revised — 13 issues were raised on this
locale and applied. Terminology follows [`../README.ja.md`](../README.ja.md),
the project's own README in this language, so a reader arriving from the
repository meets the same words.

`tests/unit/storeListing.test.ts` holds the structure to the English source:
the same number of bullets in the same order, every verbatim token intact, and
no Markdown that would render as literal junk in the store. Edit the prose
freely; that test is what stops an edit quietly breaking the shape.

**The English file is the source.** If a claim changes, change
`description.en.md` first and bring the five into line from there — five
descriptions making four different promises about the same extension is the
failure this ordering exists to prevent.
