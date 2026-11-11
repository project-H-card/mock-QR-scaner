# mock-QR-scaner

イベント申込サービスの当日受付で、運営者のスマホが申込 QR を Web ページ内のカメラで読めるかを確かめるための mock です。DB も LINE ログインも使わず、静的なページだけで動きます。中身はすべてダミーで、どこにも送信しません。

公開先：https://project-h-card.github.io/mock-QR-scaner/

## ページ

| ページ | 役割 |
| --- | --- |
| `site/scan.html` | 受付スキャナ（運営者役）。読めたら音・振動・色で知らせ、ダミーの参加者を表示する。同じ QR を読み直すと「受付済み」と出す。参加者ごとに受付を取り消せる |
| `site/show.html` | 申込 QR（申込者役）。中身の種類・誤り訂正レベル・表示サイズを切り替えられる。画像として保存もできる |
| `site/print.html` | 印刷用シート。設定違いの QR 18 個を mm 単位のサイズで並べる |

- 参加者などのダミーの内容は QR の値から毎回同じものを作るので、どの端末で表示した QR でも同じ申込として読める。
- 受付状態と記録は、スキャナを開いた端末のブラウザに保存する（`localStorage`）。
- 「記録をコピー」で、条件メモごとの件数と平均の間隔を含むテキストをコピーできる。

## 試す条件の例

- 運営者の端末：当日使う iPhone と Android（古い機種を含める）、Safari と Chrome、Discord や LINE のアプリ内ブラウザ
- 申込者の画面：LINE のアプリ内ブラウザでの表示、スクリーンショット、画面の明るさが低い時、保護フィルムや割れた画面
- 紙：白黒印刷、20mm〜40mm、折り目やしわ
- 会場：暗めの照明、映り込み、距離
- 速さ：10人を続けて読むのにかかる時間

## 公開の設定（初回だけ）

1. リポジトリの Settings → Pages の「Build and deployment」で、Source を「GitHub Actions」にする。
2. `main` に push すると、`.github/workflows/pages.yml` が `site/` を公開する。Actions タブから手動でも実行できる。

## 手元で動かす

カメラは HTTPS か `localhost` でしか動かないため、スマホで試す時は GitHub Pages の URL を使う。PC で画面だけ確かめる時は次のようにする。

```sh
cd site && python3 -m http.server 8000
# http://localhost:8000/
```

## 使っているライブラリ（CDN から読み込む）

- [qr-scanner](https://github.com/nimiq/qr-scanner) 1.4.2：読み取り（標準）。ブラウザに `BarcodeDetector` があればそれを使う
- [@zxing/browser](https://github.com/zxing-js/browser) 0.1.5：読み取り（比較用）
- [qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator) 1.4.4：QR の生成
