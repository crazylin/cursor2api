'use strict';
const { app, BrowserWindow, Tray, Menu, nativeImage, shell, ipcMain } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const isDev = process.argv.includes('--dev');
const isMac = process.platform === 'darwin';

// ── 路径 ──
const APP_ROOT = isDev
  ? path.resolve(__dirname, '..')
  : path.join(process.resourcesPath, 'app');

const USER_DATA = app.getPath('userData');
const CONFIG_SRC  = path.join(APP_ROOT, 'config.yaml');
const CONFIG_USER = path.join(USER_DATA, 'config.yaml');

fs.mkdirSync(USER_DATA, { recursive: true });
if (!fs.existsSync(CONFIG_USER)) {
  if (fs.existsSync(CONFIG_SRC)) {
    fs.copyFileSync(CONFIG_SRC, CONFIG_USER);
  } else {
    // 写入完整默认配置
    const defaultCfg = [
      '# Cursor2API 配置文件',
      '',
      '# 服务端口',
      'port: 3010',
      '',
      '# 请求超时（秒）',
      'timeout: 120',
      '',
      '# 代理设置（可选）',
      '# proxy: "http://127.0.0.1:7890"',
      '',
      '# Cursor 使用的模型',
      'cursor_model: "anthropic/claude-sonnet-4.6"',
      '',
      '# 视觉处理配置',
      'vision:',
      '  enabled: true',
      '  mode: ocr',
      '',
    ].join('\n');
    fs.writeFileSync(CONFIG_USER, defaultCfg, 'utf-8');
  }
}
const CONFIG_PATH = CONFIG_USER;

// ── 全局变量 ──
let tray = null;
let mainWindow = null;
let svcProc = null;
let svcRunning = false;
let logs = [];
const MAX_LOG = 500;

function readVersion() {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(APP_ROOT, 'package.json'), 'utf-8'));
    return pkg.version || '?';
  } catch { return '?'; }
}
const SVC_VERSION = readVersion();

function readPort() {
  try {
    const c = fs.readFileSync(CONFIG_PATH, 'utf-8');
    const m = c.match(/^port:\s*(\d+)/m);
    return m ? parseInt(m[1]) : 3010;
  } catch { return 3010; }
}
const PORT = readPort();

// ── 查找 node 可执行文件 ──
function findNodeBin() {
  // 1. 优先用打包进来的 node（resources/node/node.exe）
  const bundled = path.join(process.resourcesPath || '', 'node', 'node.exe');
  if (fs.existsSync(bundled)) return bundled;
  // 2. dev 模式：用 process.execPath 同目录找 node（npx electron 时）
  const devNode = path.join(path.dirname(process.execPath), 'node.exe');
  if (fs.existsSync(devNode)) return devNode;
  // 3. 回退：用 PATH 里的 node
  return 'node';
}

// ── 服务控制 ──
function startService() {
  if (svcRunning) return;
  svcRunning = true;  // 立即设置，防止重入
  const script = path.join(APP_ROOT, 'dist', 'index.js');
  if (!fs.existsSync(script)) { svcRunning = false; addLog('[ERROR] 找不到服务文件: ' + script); return; }
  const nodeBin = isDev ? 'node' : findNodeBin();
  addLog('[INFO] 正在启动服务... (node: ' + nodeBin + ')');
  svcProc = spawn(nodeBin, [script], {
    cwd: APP_ROOT,
    env: {
      ...process.env,
      NODE_ENV: 'production',
      PORT: String(PORT),
      CURSOR2API_CONFIG: CONFIG_PATH,
      CURSOR2API_REQUEST_LOG: '1'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let outBuf = '';
  let errBuf = '';
  const flushLines = (buf, prefix) => {
    const s = buf;
    const parts = s.split(/\r?\n/);
    const tail = parts.pop() ?? '';
    for (const line of parts) {
      if (line.length) addLog(prefix + line);
    }
    return tail;
  };
  svcProc.stdout.on('data', d => {
    outBuf += d.toString();
    outBuf = flushLines(outBuf, '');
  });
  svcProc.stderr.on('data', d => {
    errBuf += d.toString();
    errBuf = flushLines(errBuf, '[ERR] ');
  });
  const flushStdoutTail = () => {
    if (outBuf.trimEnd()) { addLog(outBuf.trimEnd()); outBuf = ''; }
  };
  const flushStderrTail = () => {
    if (errBuf.trimEnd()) { addLog('[ERR] ' + errBuf.trimEnd()); errBuf = ''; }
  };
  svcProc.stdout.on('end', flushStdoutTail);
  svcProc.stderr.on('end', flushStderrTail);
  svcProc.on('exit', () => { flushStdoutTail(); flushStderrTail(); });
  svcProc.on('exit', code => {
    svcRunning = false;
    addLog('[INFO] 服务已停止 (code: ' + code + ')');
    updateTray();
    mainWindow && mainWindow.webContents.send('svc-status', false);
  });
  updateTray();
  mainWindow && mainWindow.webContents.send('svc-status', true);
  addLog('[INFO] 服务已启动，端口 ' + PORT);
  addLog('[INFO] 等待请求中...（有 API 请求时会实时显示日志）');
}

function stopService() {
  if (!svcRunning || !svcProc) return;
  addLog('[INFO] 正在停止服务...');
  svcProc.kill();
  svcProc = null;
  svcRunning = false;
  updateTray();
  mainWindow && mainWindow.webContents.send('svc-status', false);
}

function addLog(line) {
  const ts = new Date().toLocaleTimeString('zh-CN', { hour12: false });
  const entry = '[' + ts + '] ' + line;
  logs.push(entry);
  if (logs.length > MAX_LOG) logs.shift();
  mainWindow && mainWindow.webContents.send('log', entry);
}

// ── 托盘 ──
function createTray() {
  const iconPath = path.join(__dirname, 'assets', 'tray.png');
  const icon = fs.existsSync(iconPath)
    ? nativeImage.createFromPath(iconPath)
    : nativeImage.createEmpty();
  tray = new Tray(icon);
  updateTray();
  tray.on('click', () => {
    if (mainWindow) { mainWindow.isVisible() ? mainWindow.hide() : mainWindow.show(); }
    else createMainWindow();
  });
}

function updateTray() {
  if (!tray) return;
  const menu = Menu.buildFromTemplate([
    { label: 'Cursor2API  ' + (svcRunning ? '[运行中]' : '[已停止]'), enabled: false },
    { type: 'separator' },
    { label: svcRunning ? '停止服务' : '启动服务', click: () => svcRunning ? stopService() : startService() },
    { label: '重启服务', enabled: svcRunning, click: () => { stopService(); setTimeout(startService, 500); } },
    { type: 'separator' },
    { label: '打开管理界面', click: () => { if (mainWindow) { mainWindow.show(); mainWindow.focus(); } else createMainWindow(); } },
    { label: '在浏览器中打开', enabled: svcRunning, click: () => shell.openExternal('http://localhost:' + PORT) },
    { type: 'separator' },
    { label: '退出', click: () => { stopService(); app.exit(0); } }
  ]);
  tray.setContextMenu(menu);
  tray.setToolTip('Cursor2API — ' + (svcRunning ? '运行中 :' + PORT : '已停止'));
}

// ── 主窗口 ──
function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 920, height: 660, minWidth: 720, minHeight: 500,
    title: 'Cursor2API 管理面板',
    icon: path.join(__dirname, 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    },
    show: false,
    backgroundColor: '#0f1117'
  });
  mainWindow.setMenu(null);  // 去掉菜单栏
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });
  mainWindow.on('close', e => { e.preventDefault(); mainWindow.hide(); });
  mainWindow.on('closed', () => { mainWindow = null; });
}

// ── IPC ──
ipcMain.handle('get-status',  () => svcRunning);
ipcMain.handle('get-logs',    () => logs);
ipcMain.handle('get-config',  () => fs.readFileSync(CONFIG_PATH, 'utf-8'));
ipcMain.handle('get-port',    () => PORT);
ipcMain.handle('get-version', () => SVC_VERSION);
ipcMain.handle('start-service',   () => { startService(); return true; });
ipcMain.handle('stop-service',    () => { stopService();  return true; });
ipcMain.handle('restart-service', () => new Promise(r => { stopService(); setTimeout(() => { startService(); r(true); }, 600); }));
ipcMain.handle('save-config', (_e, content) => {
  try { fs.writeFileSync(CONFIG_PATH, content, 'utf-8'); return { ok: true }; }
  catch (e) { return { ok: false, error: e.message }; }
});
ipcMain.handle('open-config-folder', () => shell.openPath(USER_DATA));
ipcMain.handle('open-in-browser',    () => shell.openExternal('http://localhost:' + PORT));

// ── 版本更新 ──
const https = require('https');
const os = require('os');

function httpsGet(url, opts = {}) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': 'cursor2api-desktop' }, ...opts }, res => {
      if (res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 307 || res.statusCode === 308) {
        return httpsGet(res.headers.location, opts).then(resolve).catch(reject);
      }
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => resolve({ status: res.statusCode, body: data, headers: res.headers }));
    });
    req.on('error', reject);
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('timeout')); });
  });
}

ipcMain.handle('get-releases', async () => {
  try {
    const r = await httpsGet('https://api.github.com/repos/crazylin/cursor2api/releases?per_page=20');
    const list = JSON.parse(r.body);
    return list.map(rel => ({
      tag: rel.tag_name,
      name: rel.name,
      body: rel.body,
      published_at: rel.published_at,
      assets: (rel.assets || []).map(a => ({ name: a.name, url: a.browser_download_url, size: a.size }))
    }));
  } catch (e) {
    return { error: e.message };
  }
});

ipcMain.handle('hot-update', async (_e, distZipUrl) => {
  const tmpZip = path.join(os.tmpdir(), 'cursor2api-dist.zip');
  return new Promise((resolve) => {
    try {
      addLog('[UPDATE] 开始热更新，下载 dist.zip...');
      mainWindow && mainWindow.webContents.send('download-progress', 0);
      // 使用 Electron net 模块，自动处理重定向和 TLS
      const { net } = require('electron');
      const request = net.request({ url: distZipUrl, redirect: 'follow' });
      const file = fs.createWriteStream(tmpZip);
      let total = 0, received = 0;
      request.on('response', (response) => {
        total = parseInt(response.headers['content-length'] || '0');
        response.on('data', (chunk) => {
          file.write(chunk);
          received += chunk.length;
          if (total) mainWindow && mainWindow.webContents.send('download-progress', Math.round(received / total * 100));
        });
        response.on('end', () => {
          file.end();
        });
        response.on('error', (e) => {
          file.destroy();
          resolve({ ok: false, error: e.message });
        });
      });
      file.on('finish', () => {
        addLog('[UPDATE] 下载完成 (' + Math.round(received/1024) + ' KB)，正在解压替换 dist/...');
        // dist.zip 结构: package.json + dist/xxx.js
        // 解压目标必须是 APP_ROOT（不是 APP_ROOT/dist）
        const psCmd = [
          `$z = '${tmpZip}'`,
          `$dst = '${APP_ROOT.replace(/\\/g, '\\\\')}'`,
          `$distDir = Join-Path $dst 'dist'`,
          `if (Test-Path $distDir) { Remove-Item $distDir -Recurse -Force }`,
          `Expand-Archive -Force -Path $z -DestinationPath $dst`,
          `Write-Host 'OK'`
        ].join('; ');
        const ps = spawn('powershell.exe', ['-NoProfile', '-Command', psCmd], { stdio: 'pipe' });
        let psOut = '', psErr = '';
        ps.stdout.on('data', d => psOut += d.toString());
        ps.stderr.on('data', d => psErr += d.toString());
        ps.on('close', code => {
          if (code === 0) {
            const newVer = readVersion();
            addLog('[UPDATE] 解压成功 (v' + newVer + ')，正在重启服务...');
            mainWindow && mainWindow.webContents.send('download-progress', 100);
            mainWindow && mainWindow.webContents.send('version-updated', newVer);
            stopService();
            setTimeout(() => { startService(); resolve({ ok: true, version: newVer }); }, 800);
          } else {
            addLog('[UPDATE] 解压失败: ' + (psErr || psOut));
            resolve({ ok: false, error: 'unzip failed: ' + (psErr || psOut) });
          }
        });
      });
      request.on('error', (e) => {
        file.destroy();
        resolve({ ok: false, error: e.message });
      });
      request.end();
    } catch (e) {
      resolve({ ok: false, error: e.message });
    }
  });
});

ipcMain.handle('download-and-install', async (_e, downloadUrl, fileName) => {
  const dest = path.join(os.tmpdir(), fileName);
  return new Promise((resolve) => {
    try {
      addLog('[UPDATE] 开始下载 ' + fileName + '...');
      const { net } = require('electron');
      const request = net.request({ url: downloadUrl, redirect: 'follow' });
      const file = fs.createWriteStream(dest);
      let total = 0, received = 0;
      request.on('response', (response) => {
        total = parseInt(response.headers['content-length'] || '0');
        response.on('data', (chunk) => {
          file.write(chunk);
          received += chunk.length;
          if (total) mainWindow && mainWindow.webContents.send('download-progress', Math.round(received / total * 100));
        });
        response.on('end', () => { file.end(); });
        response.on('error', (e) => { file.destroy(); resolve({ ok: false, error: e.message }); });
      });
      file.on('finish', () => {
        addLog('[UPDATE] 下载完成，正在启动安装程序...');
        shell.openPath(dest);
        resolve({ ok: true, path: dest });
      });
      request.on('error', (e) => { file.destroy(); resolve({ ok: false, error: e.message }); });
      request.end();
    } catch (e) {
      resolve({ ok: false, error: e.message });
    }
  });
});

// ── 单实例锁 ──
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  // 已有实例在运行，聚焦已有窗口后退出
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });

  // ── 生命周期 ──
  app.once('ready', () => {
    if (isMac && app.dock) app.dock.hide();
    createTray();
    createMainWindow();
    startService();
  });

  app.on('window-all-closed', e => e.preventDefault());
  app.on('before-quit', () => stopService());
}
