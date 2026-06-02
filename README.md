# FortiKeep

> **openfortivpn を、トグル一つで。落ちても、勝手に戻る。**

FortiKeep は openfortivpn を「いちばん手軽に・繋ぎっぱなしで」使うための超シンプルな常駐アプリ（macOS / Windows）。ターミナルもコマンドも要りません。トグルを ON にするだけで接続し、`modem hanging up` で切れても裏で監視して自動で張り直します。

## なぜ FortiKeep？ — 売り

- 🟢 **とにかくシンプル** — UI はトグル1つ。接続も切断もこれだけ。コマンドも端末も不要。
- 🔁 **落ちても勝手に戻る** — keepalive ping ＋ 指数バックオフの自動再接続。openfortivpn 最大の不満「アイドルで切れる / `modem hanging up`」を、ほっといても回復する形で解消。ここが本当の価値。
- 📄 **設定はドロップするだけ** — 既存の openfortivpn `.conf` をウィンドウに放り込めば全項目が自動で埋まる。証明書（trusted-cert）も初回ログから自動提案。
- 🪶 **軽い・じゃまにならない** — コンパクトなウィンドウ。ログは普段たたんでおける常駐向き UI。
- 🔒 **ローカル完結** — 待ち受けポートなし・外部通信なし。設定はローカルに `0600` 保存（元の openfortivpn `.conf` と同じ扱い）。

openfortivpn の CLI をそのまま叩くより手軽で、GUI ラッパーの中でも **「トグル＋自動復帰」だけに振り切った最小構成**。*繋いだら、あとは忘れていい* ためのアプリです。

## 機能

- **トグルで接続 / 切断** — ON で接続、OFF で切断。
- **常時監視 + 自動再接続** — 次の2系統で切断を検知し、トグルが ON の間は指数バックオフで張り直す:
  1. openfortivpn のログ（`modem hanging up` でプロセスが終了）
  2. keepalive ping の連続失敗
- **keepalive ping** — トンネル経由の内部ホストへ定期 ping。NAT セッションを維持して「アイドルだと切れる」を抑止しつつ、切断検知も兼ねる。
- **設定フォーム** — host / port / user / password / trusted-cert / 追加 .conf 行 / keepalive / 再接続をフォームで編集し、アプリ内に保存。
- **設定ファイルのドロップ取り込み** — 既存の openfortivpn `.conf` をウィンドウにドロップすると、`key = value` を解析して各項目へ自動反映・保存。未知のキーは「追加の設定行」へ振り分け。
- **証明書の自動提案** — 初回接続で未知の証明書を検出すると、ログから `trusted-cert` を自動抽出してワンクリックで保存。
- **設定の保存** — host / password 等はローカルに `0600`（本人のみ読取可）で保存。OS の暗号化（Electron `safeStorage` = Keychain / DPAPI）が使えれば暗号化、使えなければ平文 — いずれも元の openfortivpn `.conf` と同等の扱い。接続時のみ `0600` の一時 conf を生成し、切断時に削除。sudo パスワードは「記憶」した場合のみ別ファイルに保存（管理者権限のため、不安なら記憶せず毎回入力 or passwordless sudo を推奨）。

## 必要なもの

- Node.js 18+
- **openfortivpn 本体**
  - macOS: `brew install openfortivpn`（既定パス `/opt/homebrew/bin/openfortivpn`）
  - Windows: openfortivpn の Windows 向けビルドは一般的ではありません。動作には別途 Windows 対応バイナリが必要で、その入手は本アプリの範囲外です（UI 自体は動作します）。

## 開発

```bash
npm install
npm start
```

## 配布ビルド

```bash
npm run dist:mac   # dmg / zip
npm run dist:win   # nsis インストーラ
```

## 使い方

1. **設定**タブで接続先・認証情報を入力して保存。
2. keepalive の「監視先ホスト」に、VPN 経由でのみ届く内部ホスト（例: 社内サーバの IP）を入れると効果的。
3. **状態**タブに戻り、トグルを ON。初回は管理者（sudo）パスワードを聞かれます。
4. 切断されてもトグルが ON の間は自動で再接続します。

## 権限について（macOS / Linux）

openfortivpn は root 権限が必要です。本アプリは `sudo -S` に管理者パスワードを渡して起動します。

毎回の入力やパスワード保存を避けたい場合は、passwordless sudo を設定する方法もあります:

```
# sudo visudo -f /etc/sudoers.d/openfortivpn
your_username ALL=(ALL) NOPASSWD: /opt/homebrew/bin/openfortivpn, /usr/bin/pkill
```

この場合、sudo パスワード入力なしで接続できます（プロンプトが出たらキャンセルではなく空のまま接続を試みてください）。

## 既知の制限

- 終了時の openfortivpn 停止はベストエフォート（`sudo pkill openfortivpn`）。稀にプロセスが残る場合は手動で `sudo pkill openfortivpn`。
- 切断の真因切り分けには詳細ログ（設定の `-v`）を ON にし、ログの切断直前メッセージを確認してください。
  - `No response to N echo-requests` → LCP echo 起因
  - `read returned 0` / SSL 系 → 外側 TCP/TLS の死（NAT タイムアウト・回線）
