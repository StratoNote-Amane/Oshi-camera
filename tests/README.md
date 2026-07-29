# ADR-016 自動テスト(おまけ)

ADR-016のUI刷新にあたって新規に整備した、Node.js + jsdomによる自動テスト一式です。
今後もUIをいじった際の回帰チェックに使えるので同梱しました(必須ではありません)。

## 使い方

```
npm install jsdom css --no-save
node tests/dom_smoke_test.js      # ファン・ドック / ポーズカプセルの操作テスト
node tests/shadow_ui_test.mjs     # 影のハロー・ダイヤルの開閉・トグル・リセットのテスト
node tests/select_screen_test.mjs # キャラクター選択カルーセルの生成・選択ロジックのテスト
```

いずれも `oshi-camera` リポジトリのルート(index.html/main.jsがある階層)に
`tests/`ごと置いて実行してください。全て `PASS` になれば正常です。
