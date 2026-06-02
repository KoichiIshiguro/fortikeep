# FortiKeep

openfortivpn の接続を「保ち続ける」ための小さな Electron アプリ（macOS / Windows）。トグルで ON/OFF し、裏で ping 監視して切断時に自動再接続する常駐ツール。

## 機能

- **トグルで接続 / 切断** — ON で接続、OFF で切断。
- **常時監視 + 自動再接続** — 次の2系統で切断を検知し、トグルが ON の間は指数バックオフで張り直す:
  1. openfortivpn のログ（`modem hanging up` でプロセスが終了）
  2. keepalive ping の連続失敗
- **keepalive ping** — トンネル経由の内部ホストへ定期 ping。NAT セッションを維持して「アイドルだと切れる」を抑止しつつ、切断検知も兼ねる。
- **設定フォーム** — host / port / user / password / trusted-cert / 追加 .conf 行 / keepalive / 再接続をフォームで編集し、アプリ内に保存。
- **設定ファイルのドロップ取り込み** — 既存の openfortivpn `.conf` をウィンドウにドロップすると、`key = value` を解析して各項目へ自動反映・保存。未知のキーは「追加の設定行」へ振り分け。
- **証明書の自動提案** — 初回接続で未知の証明書を検出すると、ログから `trusted-cert` を自動抽出してワンクリックで保存。
- **秘密情報の保護** — 設定と sudo パスワードは OS の暗号化（Electron `safeStorage` = Keychain / DPAPI）で保存。接続時のみ `0600` の一時 conf を生成し、切断時に削除。

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
