# 読むだけ

[viewer.2-38.com](https://viewer.2-38.com/) を開いて、読みたい文章を貼り付けるか入力します。
ヒラギノ優先の26pxで文章を表示し、その場で編集やコピーができます。
スマートフォンではページを長押しして貼り付けられます。

文章はページのメモリ内で扱います。
再読み込みや履歴からページを開き直すと、本文と入力欄が空になります。

## 開発と公開

```sh
npx wrangler dev --local
npx wrangler deploy --dry-run
```

ブラウザーでの回帰テストは `npm ci` と `npx playwright install chromium` のあと、`npm test` で実行できます。

`public/` の静的ファイルを Cloudflare Workers に配信します。
`2-38.com` ゾーンを管理する Cloudflare アカウントで `npx wrangler deploy` を実行すると、設定済みのカスタムドメインに公開できます。
