'use strict';

const { app, safeStorage } = require('electron');
const fs = require('fs');
const path = require('path');

const DEFAULTS = {
  // openfortivpn config
  host: '',
  port: 443,
  username: '',
  vpnPassword: '',
  trustedCert: '',
  extraConfig: '', // 追加で .conf に書き込む生の行
  binaryPath: process.platform === 'win32' ? 'openfortivpn.exe' : 'openfortivpn',
  verbose: true,

  // keepalive (NAT 維持 + 切断検知を兼ねる)
  keepaliveEnabled: true,
  keepaliveHost: '',        // トンネル経由で到達できる内部ホスト
  keepaliveIntervalSec: 20,
  keepaliveFailThreshold: 3,

  // 自動再接続
  reconnectEnabled: true,
  reconnectInitialSec: 2,
  reconnectMaxSec: 30,
};

/**
 * 設定の永続化。可能なら OS の暗号化 (safeStorage) を使う。
 * sudo（管理者）パスワードは別ファイルに暗号化して保存（任意）。
 */
class ConfigStore {
  constructor() {
    this.dir = app.getPath('userData');
    this.encPath = path.join(this.dir, 'settings.enc');
    this.jsonPath = path.join(this.dir, 'settings.json');
    this.sudoPath = path.join(this.dir, 'sudo.enc');
    this.data = this._load();
  }

  _encAvailable() {
    try { return safeStorage.isEncryptionAvailable(); } catch { return false; }
  }

  _load() {
    try {
      if (fs.existsSync(this.encPath) && this._encAvailable()) {
        const json = safeStorage.decryptString(fs.readFileSync(this.encPath));
        return { ...DEFAULTS, ...JSON.parse(json) };
      }
      if (fs.existsSync(this.jsonPath)) {
        return { ...DEFAULTS, ...JSON.parse(fs.readFileSync(this.jsonPath, 'utf8')) };
      }
    } catch (e) {
      // 壊れている場合はデフォルトに戻す
    }
    return { ...DEFAULTS };
  }

  save(partial) {
    this.data = { ...this.data, ...partial };
    const json = JSON.stringify(this.data, null, 2);
    if (this._encAvailable()) {
      fs.writeFileSync(this.encPath, safeStorage.encryptString(json), { mode: 0o600 });
      try { if (fs.existsSync(this.jsonPath)) fs.unlinkSync(this.jsonPath); } catch {}
    } else {
      fs.writeFileSync(this.jsonPath, json, { mode: 0o600 });
    }
    return this.data;
  }

  get() { return { ...this.data }; }

  setSudo(pw) {
    if (!pw || !this._encAvailable()) return;
    fs.writeFileSync(this.sudoPath, safeStorage.encryptString(pw), { mode: 0o600 });
  }

  getSudo() {
    try {
      if (fs.existsSync(this.sudoPath) && this._encAvailable()) {
        return safeStorage.decryptString(fs.readFileSync(this.sudoPath));
      }
    } catch {}
    return null;
  }

  hasSudo() { return fs.existsSync(this.sudoPath); }

  clearSudo() { try { fs.unlinkSync(this.sudoPath); } catch {} }
}

module.exports = ConfigStore;
