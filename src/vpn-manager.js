'use strict';

const { spawn } = require('child_process');
const { EventEmitter } = require('events');
const fs = require('fs');
const os = require('os');
const path = require('path');

const CONNECTED_RE = /Tunnel is up and running/i;
const CERT_RE = /--trusted-cert\s+([0-9a-fA-F]{20,})/;
const SUDO_FAIL_RE = /Sorry, try again|incorrect password|a password is required/i;
const AUTH_FAIL_RE = /authentication failed|could not authenticate|wrong credentials|invalid credentials|access denied|permission denied/i;

/**
 * openfortivpn プロセスの起動・監視・自動再接続を司る。
 * 状態: disconnected | connecting | connected | reconnecting | error
 */
class VpnManager extends EventEmitter {
  constructor() {
    super();
    this.proc = null;
    this.state = 'disconnected';
    this.desiredOn = false;       // トグルの状態（ON を維持したいか）
    this.attempts = 0;            // 連続再接続試行回数
    this.reconnectTimer = null;
    this.keepaliveTimer = null;
    this.keepaliveFails = 0;
    this.confPath = null;
    this.settings = null;
    this.sudoPassword = null;
    this.lastError = null;
    this.connectedSince = null;
    this._buf = '';
    this._sawAuthFail = false;
  }

  getStatus() {
    return {
      state: this.state,
      desiredOn: this.desiredOn,
      attempts: this.attempts,
      lastError: this.lastError,
      connectedSince: this.connectedSince,
      keepaliveFails: this.keepaliveFails,
    };
  }

  _setState(state) { this.state = state; this.emit('status', this.getStatus()); }
  _log(line) { this.emit('log', line); }

  connect(settings, sudoPassword) {
    this.settings = settings;
    if (sudoPassword != null) this.sudoPassword = sudoPassword;
    this.desiredOn = true;
    this.attempts = 0;
    this.lastError = null;
    this._clearReconnect();
    this._spawn();
  }

  async disconnect() {
    this.desiredOn = false;
    this._clearReconnect();
    this._stopKeepalive();
    await this._killVpn();
    if (!this.proc) this._setState('disconnected');
  }

  shutdown() {
    this.desiredOn = false;
    this._clearReconnect();
    this._stopKeepalive();
    this._killVpn();
  }

  // ---- プロセス起動 ----
  _spawn() {
    if (this.proc) return;
    this._sawAuthFail = false;
    try {
      this._writeConf();
    } catch (e) {
      this.lastError = 'config 書き込み失敗: ' + e.message;
      this._setState('error');
      return;
    }

    const s = this.settings;
    const ovpnArgs = ['-c', this.confPath];
    if (s.verbose) ovpnArgs.push('-v');

    let cmd, args;
    if (process.platform === 'win32') {
      cmd = s.binaryPath;
      args = ovpnArgs;
    } else {
      cmd = 'sudo';
      args = ['-S', '-p', '', s.binaryPath, ...ovpnArgs];
    }

    this._log(`$ ${cmd} ${args.map((a) => (a === this.confPath ? '<conf>' : a)).join(' ')}`);
    this._setState(this.attempts > 0 ? 'reconnecting' : 'connecting');

    let proc;
    try {
      proc = spawn(cmd, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (e) {
      this.lastError = 'spawn 失敗: ' + e.message + '（バイナリパスを確認）';
      this._setState('error');
      return;
    }
    this.proc = proc;

    // sudo にパスワードを渡す
    if (process.platform !== 'win32' && this.sudoPassword != null) {
      try { proc.stdin.write(this.sudoPassword + '\n'); } catch {}
    }

    const onData = (chunk) => this._onOutput(chunk.toString());
    proc.stdout.on('data', onData);
    proc.stderr.on('data', onData);
    proc.on('error', (e) => {
      this._log('プロセスエラー: ' + e.message);
      this.lastError = e.message;
    });
    proc.on('exit', (code, signal) => this._handleExit(code, signal));
  }

  _onOutput(text) {
    this._buf += text;
    let idx;
    while ((idx = this._buf.indexOf('\n')) >= 0) {
      const line = this._buf.slice(0, idx).replace(/\r$/, '');
      this._buf = this._buf.slice(idx + 1);
      if (line.length) this._processLine(line);
    }
  }

  _processLine(line) {
    this._log(line);

    const cert = line.match(CERT_RE);
    if (cert) this.emit('certSuggested', cert[1]);

    if (SUDO_FAIL_RE.test(line)) {
      this._sawAuthFail = true;
      this.lastError = 'sudo（管理者）パスワードが正しくありません';
    }
    if (AUTH_FAIL_RE.test(line)) {
      this._sawAuthFail = true;
      this.lastError = 'VPN 認証に失敗（ユーザー名/パスワード/証明書を確認）';
    }
    if (CONNECTED_RE.test(line)) {
      this.attempts = 0;
      this.keepaliveFails = 0;
      this.connectedSince = Date.now();
      this.lastError = null;
      this._setState('connected');
      this._startKeepalive();
    }
  }

  _handleExit(code, signal) {
    this.proc = null;
    this._stopKeepalive();
    this._cleanupConf();
    this._log(`--- プロセス終了 (code=${code} signal=${signal || '-'}) ---`);

    if (!this.desiredOn) {
      this._setState('disconnected');
      return;
    }
    if (this._sawAuthFail) {
      // 認証エラーで無限ループしないよう停止
      this.desiredOn = false;
      this._setState('error');
      return;
    }
    this._setState('reconnecting');
    this._scheduleReconnect();
  }

  _scheduleReconnect() {
    if (!this.settings.reconnectEnabled) {
      this.desiredOn = false;
      this._setState('disconnected');
      return;
    }
    const init = Number(this.settings.reconnectInitialSec) || 2;
    const max = Number(this.settings.reconnectMaxSec) || 30;
    const delay = Math.min(max, init * Math.pow(2, Math.min(this.attempts, 6)));
    this.attempts += 1;
    this._log(`--- ${delay} 秒後に再接続します（試行 ${this.attempts}）---`);
    this.emit('status', this.getStatus());
    this._clearReconnect();
    this.reconnectTimer = setTimeout(() => {
      if (this.desiredOn) this._spawn();
    }, delay * 1000);
  }

  _clearReconnect() {
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
  }

  // ---- 停止 ----
  _killVpn() {
    return new Promise((resolve) => {
      if (process.platform === 'win32') {
        try { spawn('taskkill', ['/IM', 'openfortivpn.exe', '/F']); } catch {}
        try { if (this.proc) this.proc.kill(); } catch {}
        return resolve();
      }
      // openfortivpn は root 所有のため、ユーザーからは直接 kill できない。sudo 経由で停止。
      if (this.sudoPassword == null) {
        try { if (this.proc) this.proc.kill('SIGTERM'); } catch {}
        return resolve();
      }
      let done = false;
      const finish = () => { if (!done) { done = true; resolve(); } };
      let k;
      try {
        k = spawn('sudo', ['-S', '-p', '', 'pkill', '-TERM', 'openfortivpn']);
      } catch {
        try { if (this.proc) this.proc.kill('SIGTERM'); } catch {}
        return finish();
      }
      try { k.stdin.write(this.sudoPassword + '\n'); k.stdin.end(); } catch {}
      k.on('exit', finish);
      k.on('error', () => { try { if (this.proc) this.proc.kill('SIGTERM'); } catch {} finish(); });
      setTimeout(finish, 4000);
    });
  }

  // ---- keepalive (NAT 維持 + 切断検知) ----
  _startKeepalive() {
    this._stopKeepalive();
    const s = this.settings;
    if (!s.keepaliveEnabled || !s.keepaliveHost) return;
    const interval = (Number(s.keepaliveIntervalSec) || 20) * 1000;
    this.keepaliveTimer = setInterval(() => this._doKeepalive(), interval);
  }

  _stopKeepalive() {
    if (this.keepaliveTimer) { clearInterval(this.keepaliveTimer); this.keepaliveTimer = null; }
  }

  async _doKeepalive() {
    if (this.state !== 'connected') return;
    const s = this.settings;
    const ok = await pingOnce(s.keepaliveHost, 3000);
    if (ok) {
      if (this.keepaliveFails) {
        this.keepaliveFails = 0;
        this.emit('status', this.getStatus());
      }
      return;
    }
    this.keepaliveFails += 1;
    const threshold = Number(s.keepaliveFailThreshold) || 3;
    this._log(`keepalive ping 失敗 (${this.keepaliveFails}/${threshold}) -> ${s.keepaliveHost}`);
    this.emit('status', this.getStatus());
    if (this.keepaliveFails >= threshold) {
      this._log('--- keepalive 失敗閾値に達したため再接続します ---');
      this.keepaliveFails = 0;
      this._stopKeepalive();
      // 現プロセスを落とすと exit ハンドラが再接続を起動する
      this._killVpn();
    }
  }

  // ---- conf 生成 ----
  _writeConf() {
    const s = this.settings;
    const lines = [];
    if (s.host) lines.push(`host = ${s.host}`);
    lines.push(`port = ${s.port || 443}`);
    if (s.username) lines.push(`username = ${s.username}`);
    if (s.vpnPassword) lines.push(`password = ${s.vpnPassword}`);
    if (s.trustedCert) lines.push(`trusted-cert = ${s.trustedCert}`);
    if (s.extraConfig && s.extraConfig.trim()) lines.push(s.extraConfig.trim());
    const content = lines.join('\n') + '\n';
    this.confPath = path.join(os.tmpdir(), `ofv-${process.pid}.conf`);
    fs.writeFileSync(this.confPath, content, { mode: 0o600 });
  }

  _cleanupConf() {
    if (this.confPath) {
      try { fs.unlinkSync(this.confPath); } catch {}
      this.confPath = null;
    }
  }
}

function pingOnce(host, timeoutMs = 3000) {
  return new Promise((resolve) => {
    const args = process.platform === 'win32'
      ? ['-n', '1', '-w', String(timeoutMs), host]
      : ['-c', '1', host];
    let p;
    try { p = spawn('ping', args); } catch { return resolve(false); }
    let done = false;
    const t = setTimeout(() => {
      if (!done) { done = true; try { p.kill('SIGKILL'); } catch {} resolve(false); }
    }, timeoutMs + 500);
    p.on('exit', (code) => { if (!done) { done = true; clearTimeout(t); resolve(code === 0); } });
    p.on('error', () => { if (!done) { done = true; clearTimeout(t); resolve(false); } });
  });
}

module.exports = VpnManager;
