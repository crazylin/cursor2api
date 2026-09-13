'use strict';
const { app, BrowserWindow, Tray, Menu, nativeImage, shell, ipcMain } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const isDev = process.argv.includes('--dev');
const isMac = process.platform === 'darwin';

// dev 模式下确保 app 名称一致，使 userData 路径正确
if (isDev) app.setName('Cursor2API');

// ── 路径 ──
const APP_ROOT = isDev
  ? path.resolve(__dirname, '..')
  : path.join(process.resourcesPath, 'app');

// 配置文件和服务保持同一路径（服务 cwd=APP_ROOT，读取 ./config.yaml）
const CONFIG_PATH = path.join(APP_ROOT, 'config.yaml');

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

/** 实际实现见下方 getConfigForDesktop（需在 normalizeConfigYamlTextDuplicates 之后定义，运行时再解析） */
function readPort() {
  return getConfigForDesktop().port;
}

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
  const listenPort = readPort();
  addLog('[INFO] 正在启动服务... (node: ' + nodeBin + ')');
  svcProc = spawn(nodeBin, [script], {
    cwd: APP_ROOT,
    env: {
      ...process.env,
      NODE_ENV: 'production',
      PORT: String(listenPort),
      CURSOR2API_CONFIG: CONFIG_PATH,
      CURSOR2API_REQUEST_LOG: '1',
      TESSDATA_DIR: APP_ROOT
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
  addLog('[INFO] 服务已启动，端口 ' + listenPort);
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

/** 托盘/窗口图标：优先专用 tray.png，否则 icon.png；Windows 可用 icon.ico（仓库常见仅有 ico，因根目录 .gitignore 忽略 *.png） */
function loadAssetNativeImage() {
  const assets = path.join(__dirname, 'assets');
  const names = ['tray.png', 'icon.png'];
  if (process.platform === 'darwin') names.push('icon.icns');
  names.push('icon.ico');
  for (let i = 0; i < names.length; i++) {
    const p = path.join(assets, names[i]);
    if (!fs.existsSync(p)) continue;
    try {
      const img = nativeImage.createFromPath(p);
      if (!img.isEmpty()) return img;
    } catch (_) { /* 尝试下一项 */ }
  }
  return null;
}

/** 1×1 PNG，仅作极端兜底（正常应能加载 icon.ico） */
function fallbackTrayImage() {
  try {
    const buf = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmWQQAAAABJRU5ErkJggg==',
      'base64'
    );
    return nativeImage.createFromBuffer(buf);
  } catch (_) {
    return null;
  }
}

// ── 托盘 ──
function createTray() {
  let icon = loadAssetNativeImage();
  if (!icon || icon.isEmpty()) {
    console.warn('[Tray] assets 下无 tray.png/icon.png/icon.ico，使用占位图；请将托盘图放入 desktop/assets/');
    icon = fallbackTrayImage();
  }
  if (!icon || icon.isEmpty()) {
    console.error('[Tray] 无法创建托盘图标');
    return;
  }
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
    { label: '在浏览器中打开', enabled: svcRunning, click: () => shell.openExternal('http://localhost:' + readPort()) },
    { type: 'separator' },
    { label: '退出', click: () => { stopService(); app.exit(0); } }
  ]);
  tray.setContextMenu(menu);
  tray.setToolTip('Cursor2API — ' + (svcRunning ? '运行中 :' + readPort() : '已停止'));
}

// ── 主窗口 ──
function createMainWindow() {
  const winIcon = loadAssetNativeImage();
  mainWindow = new BrowserWindow({
    width: 920, height: 660, minWidth: 720, minHeight: 500,
    title: 'Cursor2API 管理面板',
    icon: winIcon && !winIcon.isEmpty() ? winIcon : undefined,
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
/** 无 config.yaml 时展示：与 config.yaml.example 骨架一致（推荐值） */
const DEFAULT_CONFIG_DISPLAY = [
  'port: 3010',
  'timeout: 120',
  'cursor_model: "anthropic/claude-sonnet-4.6"',
  'max_auto_continue: 0',
  'max_history_tokens: 120000',
  '',
  'thinking:',
  '  enabled: false',
  '',
  'compression:',
  '  enabled: true',
  '  level: 2',
  '',
  'tools:',
  "  schema_mode: 'compact'",
  '',
  'vision:',
  '  enabled: true',
  "  mode: 'ocr'",
  ''
].join('\n');
ipcMain.handle('get-config',  () => {
  if (!fs.existsSync(CONFIG_PATH)) return DEFAULT_CONFIG_DISPLAY;
  const rawText = fs.readFileSync(CONFIG_PATH, 'utf-8');
  return normalizeConfigYamlTextDuplicates(rawText);
});
ipcMain.handle('get-port',    () => readPort());
ipcMain.handle('get-version', () => SVC_VERSION);
ipcMain.handle('get-platform', () => process.platform);
ipcMain.handle('get-runtime-arch', () => process.arch);

/** 桌面内嵌全链路日志：127.0.0.1 + 当前 config.yaml 中的 port / 首个 auth_token */
ipcMain.handle('get-logs-embed-url', () => {
  const { port, firstToken } = getConfigForDesktop();
  const base = 'http://127.0.0.1:' + port + '/logs';
  return firstToken ? base + '?token=' + encodeURIComponent(firstToken) : base;
});

ipcMain.handle('start-service',   () => { startService(); return true; });
ipcMain.handle('stop-service',    () => { stopService();  return true; });
ipcMain.handle('restart-service', () => new Promise(r => { stopService(); setTimeout(() => { startService(); r(true); }, 600); }));
ipcMain.handle('save-config', (_e, content) => {
  try {
    fs.writeFileSync(CONFIG_PATH, roundTripYamlDedupeAllKeys(String(content)), 'utf-8');
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
});

/** 与 renderer app.js 一致：规范化重复的顶层 auth_tokens / vision 块 */
function isTopLevelKeyLineCfg(line) {
  const t = line.trim();
  return t && !/^\s/.test(line) && /^[a-zA-Z_][\w-]*:\s*(\S|$)/.test(line);
}

function removeAllBlocksNamedCfg(yaml, keyName) {
  const prefix = keyName + ':';
  const lines = String(yaml).split(/\r?\n/);
  const out = [];
  let skipping = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const t = line.trim();
    const isTop = isTopLevelKeyLineCfg(line);
    if (isTop && line.trimStart().startsWith(prefix)) {
      skipping = true;
      continue;
    }
    if (skipping) {
      if (!t) continue;
      if (/^\s/.test(line)) continue;
      skipping = false;
    }
    out.push(line);
  }
  return out.join('\n');
}

function collectAllAuthTokenValuesCfg(yaml) {
  const lines = String(yaml).split(/\r?\n/);
  const tokens = [];
  const seen = new Set();
  let inBlock = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (isTopLevelKeyLineCfg(line) && /^auth_tokens:/.test(line.trimStart())) {
      inBlock = true;
      continue;
    }
    if (inBlock) {
      if (!line.trim()) continue;
      if (/^\s/.test(line)) {
        const m = line.match(/^\s+-\s+["']?([^"'\n]+)["']?/);
        if (m) {
          const v = m[1].trim().replace(/^["']|["']$/g, '');
          if (v && !seen.has(v)) {
            seen.add(v);
            tokens.push(v);
          }
        }
        continue;
      }
      inBlock = false;
      i--;
    }
  }
  return tokens;
}

function extractLastBlockNamedCfg(yaml, keyName) {
  const prefix = keyName + ':';
  const lines = String(yaml).split(/\r?\n/);
  let lastStart = -1;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() && !/^\s/.test(line) && line.trimStart().startsWith(prefix)) lastStart = i;
  }
  if (lastStart < 0) return null;
  const chunk = [];
  for (let i = lastStart; i < lines.length; i++) {
    const line = lines[i];
    if (i > lastStart) {
      const t = line.trim();
      if (t && !/^\s/.test(line) && isTopLevelKeyLineCfg(line)) break;
    }
    chunk.push(line);
  }
  return chunk.join('\n');
}

/** 去掉重复 auth_tokens（合并去重）、只保留最后一个 vision 块；不改其他行顺序 */
function normalizeConfigYamlTextDuplicates(text) {
  let t = String(text);
  const authToks = collectAllAuthTokenValuesCfg(t);
  t = removeAllBlocksNamedCfg(t, 'auth_tokens').replace(/\n+$/, '');
  if (authToks.length > 0) {
    t += '\n\nauth_tokens:\n' + authToks.map(x => '  - "' + String(x).replace(/"/g, '\\"') + '"').join('\n');
  }
  const lastVision = extractLastBlockNamedCfg(t, 'vision');
  t = removeAllBlocksNamedCfg(t, 'vision').replace(/\n+$/, '');
  if (lastVision && lastVision.trim()) {
    t += '\n\n' + lastVision.trim();
  }
  return t.trimEnd() + (t.trimEnd() ? '\n' : '');
}

/** vision 子项误入顶层时 stringify 会写成文件开头的 enabled/mode，需在写入前剔除 */
function stripStrayVisionKeysFromRaw(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return;
  if (!raw.vision || typeof raw.vision !== 'object' || Array.isArray(raw.vision)) return;
  if ('enabled' in raw && typeof raw.enabled === 'boolean') delete raw.enabled;
  if ('mode' in raw && typeof raw.mode === 'string') delete raw.mode;
  if ('base_url' in raw) delete raw.base_url;
  if ('api_key' in raw) delete raw.api_key;
  if ('model' in raw && typeof raw.model === 'string') delete raw.model;
}

/**
 * 先文本层合并多段 auth_tokens / vision，再 parse→对象→stringify。
 * 可消掉其余重复顶层键（fingerprint、compression、thinking、tools、logging 等，同键多段通常保留解析结果的一份）。
 */
function roundTripYamlDedupeAllKeys(text) {
  const YAML = require('yaml');
  const mergedText = normalizeConfigYamlTextDuplicates(String(text));
  try {
    const raw = YAML.parseDocument(mergedText).toJS() || {};
    stripStrayVisionKeysFromRaw(raw);
    if (Array.isArray(raw.auth_tokens)) {
      raw.auth_tokens = [...new Set(raw.auth_tokens.map(String))];
    }
    return YAML.stringify(raw, { lineWidth: 0 });
  } catch {
    return mergedText;
  }
}

/**
 * 每次从磁盘读 config（与保存/结构化表单同一套 normalize + YAML），供端口、内嵌日志 URL、子进程 PORT 环境变量使用。
 * 其他参数（timeout、cursor_model、proxy、vision、auth_tokens 等）由子进程启动时读 yaml，主进程不缓存。
 */
function getConfigForDesktop() {
  let port = 3010;
  let firstToken = '';
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const YAML = require('yaml');
      const text = normalizeConfigYamlTextDuplicates(fs.readFileSync(CONFIG_PATH, 'utf-8'));
      const raw = YAML.parseDocument(text).toJS() || {};
      if (raw.port != null && !Number.isNaN(Number(raw.port))) port = Number(raw.port);
      if (Array.isArray(raw.auth_tokens) && raw.auth_tokens.length > 0) {
        firstToken = String(raw.auth_tokens[0]);
      }
    }
  } catch (_) { /* 默认 port */ }
  return { port, firstToken };
}

/** 从磁盘读入并解析为对象（与 save-config-fields 一致） */
function loadConfigRawObject() {
  const YAML = require('yaml');
  let raw = {};
  if (fs.existsSync(CONFIG_PATH)) {
    const normalizedText = normalizeConfigYamlTextDuplicates(fs.readFileSync(CONFIG_PATH, 'utf-8'));
    raw = YAML.parseDocument(normalizedText).toJS() || {};
    stripStrayVisionKeysFromRaw(raw);
    if (Array.isArray(raw.auth_tokens)) {
      raw.auth_tokens = [...new Set(raw.auth_tokens.map(String))];
    }
  }
  return raw;
}

/**
 * 将桌面表单字段合并进已解析的 raw（保留各块内未在表单暴露的键）
 */
function mergeConfigFields(raw, fields) {
  delete raw.enable_thinking;
  delete raw.enable_progressive_truncation;

  if (fields.port !== undefined) raw.port = fields.port;
  if (fields.timeout !== undefined) raw.timeout = fields.timeout;
  if (fields.cursor_model !== undefined) raw.cursor_model = fields.cursor_model;

  if ('proxy' in fields) {
    if (fields.proxy) raw.proxy = fields.proxy;
    else delete raw.proxy;
  }

  if ('auth_tokens' in fields) {
    if (fields.auth_tokens && fields.auth_tokens.length > 0) raw.auth_tokens = fields.auth_tokens;
    else delete raw.auth_tokens;
  }

  if (fields['vision.enabled'] !== undefined || fields['vision.mode'] !== undefined) {
    if (!raw.vision || typeof raw.vision !== 'object' || Array.isArray(raw.vision)) raw.vision = {};
    if (fields['vision.enabled'] !== undefined) raw.vision.enabled = fields['vision.enabled'];
    if (fields['vision.mode'] !== undefined) raw.vision.mode = fields['vision.mode'];
    if (raw.vision.mode === 'ocr') {
      delete raw.vision.base_url;
      delete raw.vision.api_key;
      delete raw.vision.model;
    } else {
      if (fields['vision.base_url'] !== undefined) raw.vision.base_url = fields['vision.base_url'];
      if (fields['vision.api_key'] !== undefined) raw.vision.api_key = fields['vision.api_key'];
      if (fields['vision.model'] !== undefined) raw.vision.model = fields['vision.model'];
    }
  }

  if (fields.thinking_mode !== undefined) {
    if (fields.thinking_mode === 'follow') delete raw.thinking;
    else raw.thinking = { enabled: fields.thinking_mode === 'on' };
  }

  if (fields.compression_enabled !== undefined || fields.compression_level !== undefined) {
    const prev = raw.compression && typeof raw.compression === 'object' && !Array.isArray(raw.compression) ? raw.compression : {};
    raw.compression = { ...prev };
    if (fields.compression_enabled !== undefined) raw.compression.enabled = fields.compression_enabled;
    if (fields.compression_level !== undefined) raw.compression.level = fields.compression_level;
  }

  if ('max_history_tokens' in fields) {
    if (fields.max_history_tokens == null) delete raw.max_history_tokens;
    else raw.max_history_tokens = fields.max_history_tokens;
  }

  if ('context_pressure' in fields) {
    if (fields.context_pressure == null) delete raw.context_pressure;
    else raw.context_pressure = fields.context_pressure;
  }

  if (fields.max_auto_continue !== undefined) raw.max_auto_continue = fields.max_auto_continue;

  const toolKeys = ['tools_schema_mode', 'tools_passthrough', 'tools_disabled', 'tools_adaptive_budget', 'tools_smart_truncation'];
  if (toolKeys.some(k => fields[k] !== undefined)) {
    const prev = raw.tools && typeof raw.tools === 'object' && !Array.isArray(raw.tools) ? raw.tools : {};
    raw.tools = { ...prev };
    if (fields.tools_schema_mode !== undefined) raw.tools.schema_mode = fields.tools_schema_mode;
    if (fields.tools_passthrough !== undefined) raw.tools.passthrough = fields.tools_passthrough;
    if (fields.tools_disabled !== undefined) raw.tools.disabled = fields.tools_disabled;
    if (fields.tools_adaptive_budget !== undefined) raw.tools.adaptive_budget = fields.tools_adaptive_budget;
    if (fields.tools_smart_truncation !== undefined) raw.tools.smart_truncation = fields.tools_smart_truncation;
  }

  if (fields.logging_db_enabled !== undefined || fields.logging_file_enabled !== undefined) {
    const prev = raw.logging && typeof raw.logging === 'object' && !Array.isArray(raw.logging) ? raw.logging : {};
    raw.logging = { ...prev };
    if (fields.logging_db_enabled !== undefined) raw.logging.db_enabled = fields.logging_db_enabled;
    if (fields.logging_file_enabled !== undefined) raw.logging.file_enabled = fields.logging_file_enabled;
  }

  stripStrayVisionKeysFromRaw(raw);
  if (Array.isArray(raw.auth_tokens)) {
    raw.auth_tokens = [...new Set(raw.auth_tokens.map(String))];
  }
}

ipcMain.handle('save-config-fields', (_e, fields) => {
  try {
    const YAML = require('yaml');
    const raw = loadConfigRawObject();
    mergeConfigFields(raw, fields);
    fs.writeFileSync(CONFIG_PATH, YAML.stringify(raw, { lineWidth: 0 }), 'utf-8');
    return { ok: true };
  } catch (e) {
    addLog('[ERROR] save-config-fields: ' + e.message);
    return { ok: false, error: e.message };
  }
});

/**
 * 将表单字段合并进 YAML 文本（用于「常用设置 → 原始 YAML」预览；baseYaml 为当前文本框内容时可保留未保存的 raw 编辑）
 */
ipcMain.handle('preview-config-fields', (_e, payload) => {
  try {
    const YAML = require('yaml');
    let fields = payload;
    let baseYaml = '';
    if (payload && typeof payload === 'object' && 'fields' in payload) {
      fields = payload.fields;
      baseYaml = typeof payload.baseYaml === 'string' ? payload.baseYaml : '';
    }
    let raw = {};
    if (baseYaml.trim()) {
      const mergedText = normalizeConfigYamlTextDuplicates(baseYaml);
      raw = YAML.parseDocument(mergedText).toJS() || {};
    } else {
      raw = loadConfigRawObject();
    }
    stripStrayVisionKeysFromRaw(raw);
    if (Array.isArray(raw.auth_tokens)) {
      raw.auth_tokens = [...new Set(raw.auth_tokens.map(String))];
    }
    mergeConfigFields(raw, fields);
    return YAML.stringify(raw, { lineWidth: 0 });
  } catch (e) {
    addLog('[ERROR] preview-config-fields: ' + e.message);
    return '';
  }
});
/** 打开 config.yaml 所在目录（与读写 CONFIG_PATH 一致），勿用 userData — 二者不是同一路径 */
ipcMain.handle('open-config-folder', () => shell.openPath(path.dirname(CONFIG_PATH)));
ipcMain.handle('open-in-browser',    () => shell.openExternal('http://localhost:' + readPort()));
ipcMain.handle('open-external-url', async (_e, url) => {
  const u = String(url || '').trim();
  if (!/^https:\/\//i.test(u)) return { ok: false, error: '仅允许 https 链接' };
  try {
    await shell.openExternal(u);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

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

/** dist.zip 根目录含 package.json 与 dist/；先删 APP_ROOT/dist 再解压到 APP_ROOT */
function extractDistZipToAppRoot(tmpZip, dstRoot, cb) {
  const distDir = path.join(dstRoot, 'dist');
  if (process.platform === 'win32') {
    const z = tmpZip.replace(/'/g, "''").replace(/\\/g, '/');
    const dst = dstRoot.replace(/'/g, "''").replace(/\\/g, '/');
    const psCmd = [
      `$z = '${z}'`,
      `$dst = '${dst}'`,
      `$distDir = Join-Path $dst 'dist'`,
      `if (Test-Path $distDir) { Remove-Item $distDir -Recurse -Force }`,
      `Expand-Archive -Force -Path $z -DestinationPath $dst`,
      `Write-Host 'OK'`
    ].join('; ');
    const ps = spawn('powershell.exe', ['-NoProfile', '-Command', psCmd], { stdio: 'pipe' });
    let psOut = '', psErr = '';
    ps.stdout.on('data', d => { psOut += d.toString(); });
    ps.stderr.on('data', d => { psErr += d.toString(); });
    ps.on('close', code => {
      cb(code === 0, code === 0 ? '' : (psErr || psOut || 'powershell exit ' + code));
    });
    ps.on('error', e => cb(false, e.message));
    return;
  }
  try {
    if (fs.existsSync(distDir)) fs.rmSync(distDir, { recursive: true, force: true });
  } catch (e) {
    cb(false, 'rm dist: ' + e.message);
    return;
  }
  const uz = spawn('unzip', ['-o', '-q', tmpZip, '-d', dstRoot], { stdio: 'pipe' });
  let err = '';
  uz.stderr.on('data', d => { err += d.toString(); });
  uz.on('close', code => {
    cb(code === 0, code === 0 ? '' : (err.trim() || 'unzip exit ' + code));
  });
  uz.on('error', e => cb(false, e.message));
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
        extractDistZipToAppRoot(tmpZip, APP_ROOT, (ok, errMsg) => {
          if (ok) {
            const newVer = readVersion();
            addLog('[UPDATE] 解压成功 (v' + newVer + ')，正在重启服务...');
            mainWindow && mainWindow.webContents.send('download-progress', 100);
            mainWindow && mainWindow.webContents.send('version-updated', newVer);
            stopService();
            setTimeout(() => { startService(); resolve({ ok: true, version: newVer }); }, 800);
          } else {
            addLog('[UPDATE] 解压失败: ' + errMsg);
            resolve({ ok: false, error: 'unzip failed: ' + errMsg });
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
