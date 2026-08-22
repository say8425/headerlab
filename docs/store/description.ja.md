# Detailed description — 日本語 (`ja`)

Paste the block below into **Store listing → Description**, with the language
dropdown set to Japanese. It is plain text: the store keeps line breaks and
renders nothing else, so the bullets and headings are literal characters.

```text
HeaderLab は、あなたが選んだサイトの HTTP リクエスト・レスポンスヘッダーを、Chrome 自身の declarativeNetRequest エンジンで設定・追加・削除します。あなたが許可するまで、どのサイトへのアクセス権限も持ちません。

できること

• 任意のヘッダーを、リクエスト側でもレスポンス側でも設定・追加・削除します。
• サイト単位のスコープ。サイトはホストでマッチするので、ポップアップに表示されているものが、そのまま実際の通信で使われます。
• すべてのサイトに適用するのは、明示的なモードです。すべてのサイトへのアクセス権限を必要としますが、スイッチはそれを要求しません — 要求するのは別に置かれた Grant ボタンです。
• リクエストタイプでの絞り込み。Chrome のリソースタイプ 8 種を、それぞれ個別のチェックボックスで扱います。Chrome 自身の既定が黙って除外する main_frame も含みます。
• スイッチひとつで全体を一時停止。ツールバーのアイコンもそれに合わせて灰色になり、ブラウザを再起動しても灰色のままです。

AI コーディングエージェントから操作する

HeaderLab には、オプションのコマンドラインツールと、Claude Code・Codex 向けのスキルが付属します。つまり、エージェントが作業しながらヘッダールールを読み書きできます。普通の言葉で頼むだけです — X-Debug ヘッダーを追加して staging.example.com にスコープして、API には Referer を送らないで — そして結果は、自分で入力したときとまったく同じようにポップアップに現れます。

それで主導権を手放すことはありません。ブリッジはポップアップでスイッチを入れるまで無効で、ツールが自分でスイッチを入れることも、サイトへのアクセス権限を取得することもできません — Chrome はそのどちらも人の操作からしか受け取りません — そして通信はネットワークではなくローカルソケットで行われます。

しないこと

• ネットワーク呼び出しなし。分析も、テレメトリも、リモート設定も、更新 ping もありません。
• コンテンツスクリプトなし。どのページにも何も注入せず、拡張機能がページの中身を見ることもありません。
• リモートコードも、CDN も、ウェブフォントも、リモート画像もなし。パッケージの外から何も取得しません。
• マシンの外に出るものはありません。ルールは Chrome 自身の拡張機能ストレージに保存されます。

https://github.com/say8425/headerlab

オープンソース、Apache-2.0。
```

## How this was produced

Translated from [`description.en.md`](description.en.md). The first version was
reviewed against the English source and revised — 13 issues were raised on this
locale and applied.

**The 2026-08-22 rewrite did not go through that reviewer stage.** It was
translated straight from the new English, in the same pass that wrote it, so
this file is worth a proofread before it is pasted into the dashboard — the
structural guard below cannot read meaning. Terminology follows
[`../README.ja.md`](../README.ja.md), the project's own README in this language, so a
reader arriving from the repository meets the same words.

`tests/unit/storeListing.test.ts` holds the structure to the English source:
the same number of bullets in the same order, every verbatim token intact, and
no Markdown that would render as literal junk in the store. Edit the prose
freely; that test is what stops an edit quietly breaking the shape.

**The English file is the source.** If a claim changes, change
`description.en.md` first and bring the five into line from there — five
descriptions making four different promises about the same extension is the
failure this ordering exists to prevent.
