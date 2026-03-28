'use strict';

let running = false, autoScroll = true, startTime = null, uptimeTimer = null, port = 3010;
let rawYaml = '';
let activeTab = 'simple';
/** 常用设置内子 Tab：conn | vision | ctx | tools */
let activeSimpleSub = 'conn';

/** 日志页子视图：console = 运行日志（进程输出），viewer = 请求日志（内嵌 /logs） */
let logViewMode = 'console';
let lastLogsEmbedUrl = '';
let logsEmbedPollTimer = null;

function switchLogView(mode, btn) {
  logViewMode = mode;
  document.querySelectorAll('#log-main-tabs .log-main-tab').forEach(b => {
    b.classList.toggle('active', b.getAttribute('data-sub') === mode);
  });
  const consoleWrap = document.getElementById('log-console-wrap');
  const viewerWrap = document.getElementById('log-viewer-wrap');
  const consoleOnly = document.querySelectorAll('.log-console-only');
  if (!consoleWrap || !viewerWrap) return;
  if (mode === 'console') {
    consoleWrap.classList.add('is-active');
    viewerWrap.classList.remove('is-active');
    const ifr = document.getElementById('logs-web-view');
    if (ifr) {
      ifr.removeAttribute('src');
      lastLogsEmbedUrl = '';
    }
    consoleOnly.forEach(el => { el.style.removeProperty('display'); });
    if (logsEmbedPollTimer) {
      clearInterval(logsEmbedPollTimer);
      logsEmbedPollTimer = null;
    }
  } else {
    consoleWrap.classList.remove('is-active');
    viewerWrap.classList.add('is-active');
    consoleOnly.forEach(el => { el.style.display = 'none'; });
    lastLogsEmbedUrl = '';
    refreshLogsEmbed();
    if (!logsEmbedPollTimer) {
      logsEmbedPollTimer = setInterval(() => {
        if (logViewMode === 'viewer') refreshLogsEmbed();
      }, 3000);
    }
  }
}

async function refreshLogsEmbed() {
  try {
    const url = await window.api.getLogsEmbedUrl();
    const ifr = document.getElementById('logs-web-view');
    const hint = document.getElementById('logs-embed-hint');
    if (hint) {
      hint.textContent = '嵌入：' + url + '（请先启动服务；修改端口或鉴权 Token 并保存后会自动刷新）';
    }
    if (ifr && logViewMode === 'viewer' && url !== lastLogsEmbedUrl) {
      lastLogsEmbedUrl = url;
      ifr.src = url;
    }
  } catch (e) {
    const hint = document.getElementById('logs-embed-hint');
    if (hint) hint.textContent = '无法生成嵌入地址：' + (e && e.message ? e.message : e);
  }
}

// ── 主题切换 ──
function toggleTheme() {
  const html = document.documentElement;
  const isDark = html.getAttribute('data-theme') !== 'light';
  const next = isDark ? 'light' : 'dark';
  html.setAttribute('data-theme', next);
  document.getElementById('theme-label').textContent = isDark ? '深色' : '浅色';
  try { localStorage.setItem('theme', next); } catch(e) {}
}
// 恢复上次主题
(function() {
  try {
    const saved = localStorage.getItem('theme');
    if (saved === 'light') {
      document.documentElement.setAttribute('data-theme', 'light');
      // label 在 DOM ready 后设置
      window.addEventListener('DOMContentLoaded', () => {
        const el = document.getElementById('theme-label');
        if (el) el.textContent = '深色';
      });
    }
  } catch(e) {}
})();

// ── 导航 ──
document.querySelectorAll('.nav-item').forEach(el => {
  el.addEventListener('click', () => {
    document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    el.classList.add('active');
    document.getElementById('page-' + el.dataset.page).classList.add('active');
    if (el.dataset.page === 'logs' && logViewMode === 'viewer') refreshLogsEmbed();
  });
});

// ── 初始化 ──
(async () => {
  port = await window.api.getPort();
  updateEP();
  document.getElementById('s-port').textContent = port;
  const ver = await window.api.getVersion();
  const verCore = String(ver || '').replace(/^v/i, '');
  const vEl = document.getElementById('s-version');
  if (vEl) vEl.textContent = verCore || '--';
  const aboutVer = document.getElementById('about-ver');
  if (aboutVer && verCore) aboutVer.textContent = 'v' + verCore;
  const initRunning = await window.api.getStatus();
  setStatus(initRunning);
  if (initRunning) setTimeout(fetchModels, 1000);  // 启动时服务已运行则直接获取模型
  const logs = await window.api.getLogs();
  logs.forEach(addLine);
  scrollBot();
  rawYaml = await window.api.getConfig();
  document.getElementById('raw-cfg').value = rawYaml;
  yamlToForm(rawYaml);
  const cb = document.getElementById('cb-scroll');
  if (cb) cb.addEventListener('change', () => { autoScroll = cb.checked; });
  const vmodeSel = document.getElementById('f-vmode');
  if (vmodeSel) vmodeSel.addEventListener('change', updateVisionModeUi);
  updateVisionModeUi();
  switchSimpleSub(activeSimpleSub);
  document.querySelectorAll('.about-link[data-about-url]').forEach(btn => {
    btn.addEventListener('click', () => {
      const u = btn.getAttribute('data-about-url');
      if (u) void window.api.openExternalUrl(u);
    });
  });
  // 历史日志加载完后再注册实时监听，避免重复显示
  window.api.onServiceStatus(s => {
    setStatus(s);
    if (s) {
      void refreshPortFromMain();
      setTimeout(fetchModels, 1500);
    }
  });
  window.api.onLog(line => { addLine(line); if (autoScroll) scrollBot(); });
})();

function updateVisionModeUi() {
  const sel = document.getElementById('f-vmode');
  const wrap = document.getElementById('vision-api-fields');
  if (!sel || !wrap) return;
  const isApi = sel.value === 'api';
  if (isApi) {
    wrap.classList.remove('vision-api--off');
    wrap.removeAttribute('hidden');
    wrap.style.removeProperty('display');
  } else {
    wrap.classList.add('vision-api--off');
    wrap.setAttribute('hidden', '');
    wrap.style.display = 'none';
  }
}

function updateEP() {
  document.getElementById('ep1').textContent = 'http://localhost:' + port;
  document.getElementById('ep2').textContent = 'http://localhost:' + port + '/v1';
  document.getElementById('ep3').textContent = 'export ANTHROPIC_BASE_URL=http://localhost:' + port;
}

/** 保存端口或重启后，与主进程 config 同步（主进程不再缓存 PORT） */
async function refreshPortFromMain() {
  try {
    port = await window.api.getPort();
    updateEP();
    const sp = document.getElementById('s-port');
    if (sp) sp.textContent = port;
  } catch (_) {}
}

// onServiceStatus / onLog 在初始化 IIFE 拉完历史日志后再注册（见下方 IIFE）

// ── 状态 ──
function setStatus(s) {
  running = s;
  const el = document.getElementById('s-status');
  el.textContent = s ? 'Running' : 'Stopped';
  el.className = 'stat-value ' + (s ? 'green' : 'red');
  document.getElementById('b-start').disabled   =  s;
  document.getElementById('b-stop').disabled    = !s;
  document.getElementById('b-restart').disabled = !s;
  if (s && !startTime) { startTime = Date.now(); uptimeTimer = setInterval(tick, 1000); }
  if (!s) { clearInterval(uptimeTimer); startTime = null; document.getElementById('s-uptime').textContent = '--'; }
}

function tick() {
  if (!startTime) return;
  const sc = Math.floor((Date.now() - startTime) / 1000);
  const h = String(Math.floor(sc/3600)).padStart(2,'0');
  const m = String(Math.floor((sc%3600)/60)).padStart(2,'0');
  const s = String(sc%60).padStart(2,'0');
  document.getElementById('s-uptime').textContent = h+':'+m+':'+s;
}

// ── 日志 ──
function addLine(line) {
  const box = document.getElementById('log-box');
  const parts = String(line).split(/\n/);
  for (let i = 0; i < parts.length; i++) {
    const seg = parts[i];
    const d = document.createElement('div');
    const isErr = seg.includes('[ERR') || seg.includes('ERROR');
    const isOk  = seg.includes('success') || seg.includes('started') || seg.includes('成功');
    d.className = 'log-line' + (isErr ? ' err' : isOk ? ' ok' : '');
    d.textContent = seg;
    box.appendChild(d);
  }
  while (box.children.length > 600) box.removeChild(box.firstChild);
}
function scrollBot() {
  const b = document.getElementById('log-box');
  if (!b) return;
  const run = () => {
    b.scrollTop = b.scrollHeight;
    const last = b.lastElementChild;
    if (last) {
      try {
        last.scrollIntoView({ block: 'end', behavior: 'auto' });
      } catch (e) {
        b.scrollTop = b.scrollHeight;
      }
    }
  };
  requestAnimationFrame(() => requestAnimationFrame(run));
  setTimeout(run, 0);
  setTimeout(run, 80);
}
function clearLog()  { document.getElementById('log-box').innerHTML = ''; }

// ── 控制 ──
async function doStart()   { await window.api.startService(); }
async function doStop()    { await window.api.stopService(); }
async function doRestart() { await window.api.restartService(); }

// ── 复制 ──
function cp(id) {
  navigator.clipboard.writeText(document.getElementById(id).textContent);
  const btn = document.querySelector('[onclick="cp(\''+id+'\')"');
  if (btn) { const o = btn.textContent; btn.textContent = '已复制'; setTimeout(() => btn.textContent = o, 1500); }
}

/** 从「常用设置」表单收集字段，供 save-config-fields / 预览 YAML 使用 */
function collectFieldsFromForm() {
  const port = document.getElementById('f-port').value;
  const timeout = document.getElementById('f-timeout').value;
  const model = document.getElementById('f-model').value;
  const proxy = document.getElementById('f-proxy').value.trim();
  const authRaw = document.getElementById('f-auth-tokens').value.trim();
  const authTokens = authRaw ? authRaw.split('\n').map(s => s.trim()).filter(Boolean) : [];
  const vision = document.getElementById('f-vision').checked;
  const vmode = document.getElementById('f-vmode').value;
  const vkey = document.getElementById('f-vkey').value.trim();
  const vurl = document.getElementById('f-vurl').value.trim();
  const vmodel = document.getElementById('f-vmodel').value.trim();

  const fields = {};
  if (port) fields.port = parseInt(port, 10);
  if (timeout) fields.timeout = parseInt(timeout, 10);
  if (model) fields.cursor_model = model;
  if (proxy) fields.proxy = proxy;
  else fields.proxy = null;
  fields['vision.enabled'] = vision;
  fields['vision.mode'] = vmode === 'api' ? 'api' : 'ocr';
  if (vmode === 'api') {
    if (vurl) fields['vision.base_url'] = vurl;
    if (vkey) fields['vision.api_key'] = vkey;
    if (vmodel) fields['vision.model'] = vmodel;
  }
  if (authTokens.length > 0) fields.auth_tokens = authTokens;
  else fields.auth_tokens = null;

  const tm = document.getElementById('f-thinking-mode');
  if (tm) fields.thinking_mode = tm.value;

  const mhts = document.getElementById('f-max-history-tokens').value.trim();
  if (mhts === '') fields.max_history_tokens = null;
  else {
    const n = parseInt(mhts, 10);
    if (!Number.isNaN(n)) fields.max_history_tokens = n;
  }

  const cps = document.getElementById('f-context-pressure').value.trim();
  if (cps === '') fields.context_pressure = null;
  else {
    const n = parseFloat(cps);
    if (!Number.isNaN(n)) fields.context_pressure = n;
  }

  const fce = document.getElementById('f-compression-enabled');
  const fcl = document.getElementById('f-compression-level');
  if (fce) fields.compression_enabled = fce.checked;
  if (fcl) fields.compression_level = parseInt(fcl.value, 10);

  const fmac = document.getElementById('f-max-auto-continue');
  if (fmac) {
    const n = parseInt(fmac.value, 10);
    fields.max_auto_continue = Number.isNaN(n) ? 0 : n;
  }

  const fsm = document.getElementById('f-schema-mode');
  if (fsm) fields.tools_schema_mode = fsm.value;

  const ta = document.getElementById('f-tools-adaptive');
  const ts = document.getElementById('f-tools-smart');
  const tp = document.getElementById('f-tools-passthrough');
  const td = document.getElementById('f-tools-disabled');
  if (ta) fields.tools_adaptive_budget = ta.checked;
  if (ts) fields.tools_smart_truncation = ts.checked;
  if (tp) fields.tools_passthrough = tp.checked;
  if (td) fields.tools_disabled = td.checked;

  const fld = document.getElementById('f-log-db');
  const flf = document.getElementById('f-log-file');
  if (fld) fields.logging_db_enabled = fld.checked;
  if (flf) fields.logging_file_enabled = flf.checked;

  return fields;
}

function switchSimpleSub(sub) {
  const allowed = ['conn', 'vision', 'ctx', 'tools'];
  if (!allowed.includes(sub)) sub = 'conn';
  activeSimpleSub = sub;
  document.querySelectorAll('.cfg-subtab[data-simple-sub]').forEach(b => {
    const on = b.getAttribute('data-simple-sub') === sub;
    b.classList.toggle('active', on);
    b.setAttribute('aria-selected', on ? 'true' : 'false');
  });
  document.querySelectorAll('.cfg-simple-subpanel').forEach(p => {
    p.classList.toggle('active', p.id === 'simple-sub-' + sub);
  });
}

// ── 配置 Tab 切换 ──
async function switchTab(tab) {
  activeTab = tab;
  document.querySelectorAll('.cfg-tab').forEach((el, i) => {
    el.classList.toggle('active', (i === 0 && tab === 'simple') || (i === 1 && tab === 'raw'));
  });
  document.getElementById('panel-simple').classList.toggle('active', tab === 'simple');
  document.getElementById('panel-raw').classList.toggle('active', tab === 'raw');
  if (tab === 'raw') {
    const base = document.getElementById('raw-cfg').value || rawYaml || '';
    const fields = collectFieldsFromForm();
    const text = await window.api.previewConfigFields({ fields, baseYaml: base });
    if (text && String(text).trim()) document.getElementById('raw-cfg').value = text;
    else document.getElementById('raw-cfg').value = formToYaml(); // 回退：不含 thinking/compression 等嵌套项
  } else {
    yamlToForm(document.getElementById('raw-cfg').value);
  }
}

/** 顶层 key 行（无缩进，如 port: / vision: / fingerprint:） */
function isTopLevelKeyLine(line) {
  const t = line.trim();
  return t && !/^\s/.test(line) && /^[a-zA-Z_][\w-]*:\s*(\S|$)/.test(line);
}

// 取最后一个顶层 vision: 块（避免文件中重复 vision: 时误读到第一项 false）
function extractLastVisionBlockText(yaml) {
  const lines = yaml.split(/\r?\n/);
  let lastStart = -1;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() && !/^\s/.test(line) && /^vision:\s*(\S|$)/.test(line)) lastStart = i;
  }
  if (lastStart < 0) return null;
  const chunk = [];
  for (let i = lastStart; i < lines.length; i++) {
    const line = lines[i];
    if (i > lastStart) {
      const t = line.trim();
      if (t && !/^\s/.test(line) && isTopLevelKeyLine(line)) break;
    }
    chunk.push(line);
  }
  return chunk.join('\n');
}

/** 取最后一个顶层 keyName: 块（与 vision 逻辑相同，供 thinking / compression / tools / logging 解析） */
function extractLastBlockNamedText(yaml, keyName) {
  const prefix = keyName + ':';
  const lines = yaml.split(/\r?\n/);
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
      if (t && !/^\s/.test(line) && isTopLevelKeyLine(line)) break;
    }
    chunk.push(line);
  }
  return chunk.join('\n');
}

// 删除所有顶层 vision: 块（供 formToYaml 替换为单一整块）
function removeAllVisionBlocksText(yaml) {
  const lines = yaml.split(/\r?\n/);
  const out = [];
  let skipping = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const t = line.trim();
    const isTop = isTopLevelKeyLine(line);
    if (isTop && /^vision:/.test(line)) {
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

/** 从全文收集所有 auth_tokens 块里的 token（去重、保序）—— 避免重复 auth_tokens: 只保留读到的合并列表 */
function collectAllAuthTokenValues(yaml) {
  const lines = yaml.split(/\r?\n/);
  const tokens = [];
  const seen = new Set();
  let inBlock = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (isTopLevelKeyLine(line) && /^auth_tokens:/.test(line.trimStart())) {
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

/** 删除所有顶层 auth_tokens: 块（与 vision 同理，防止只替换第一段留下第二段） */
function removeAllAuthTokensBlocksText(yaml) {
  const lines = yaml.split(/\r?\n/);
  const out = [];
  let skipping = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const t = line.trim();
    const isTop = isTopLevelKeyLine(line);
    if (isTop && /^auth_tokens:/.test(line.trimStart())) {
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

// ── YAML -> 表单 ──
function yamlToForm(yaml) {
  const get = (key) => {
    const m = yaml.match(new RegExp('^' + key + ':\\s*["\']?([^"\' \n#]+)', 'm'));
    return m ? m[1].trim() : '';
  };
  const getBool = (key, def) => {
    const m = yaml.match(new RegExp('^' + key + ':\\s*(true|false)', 'm'));
    return m ? m[1] === 'true' : def;
  };
  const getCommented = (key) => {
    // 检查某行是否被注释掉
    const m = yaml.match(new RegExp('^#\\s*' + key + ':', 'm'));
    return !m; // 没注释 = 启用
  };

  const p = get('port'); if (p) document.getElementById('f-port').value = p;
  const t = get('timeout'); if (t) document.getElementById('f-timeout').value = t;
  const model = get('cursor_model'); if (model) {
    const sel = document.getElementById('f-model');
    // 如果下拉没有该选项，添加一个
    if (![...sel.options].find(o => o.value === model)) {
      const opt = document.createElement('option');
      opt.value = model; opt.textContent = model + '（当前）';
      sel.insertBefore(opt, sel.firstChild);
    }
    sel.value = model;
  }

  // 代理：找 proxy: "..." 行（未注释）
  const proxyM = yaml.match(/^proxy:\s*["']?([^"'\n#]+)/m);
  if (proxyM) document.getElementById('f-proxy').value = proxyM[1].trim().replace(/["']/g, '');

  // auth_tokens：合并所有块（重复 auth_tokens: 时与 YAML 解析行为一致且去重）
  const authToks = collectAllAuthTokenValues(yaml);
  document.getElementById('f-auth-tokens').value = authToks.length ? authToks.join('\n') : '';

  // vision：必须用「最后一个」vision 块；旧正则会在第二个 vision: 处截断，把开关读成 false
  const vb = extractLastVisionBlockText(yaml);
  if (vb) {
    const ve = vb.match(/enabled:\s*(true|false)/i);
    document.getElementById('f-vision').checked = ve ? ve[1].toLowerCase() === 'true' : true;
    const vm = vb.match(/mode:\s*['"]?(\w+)['"]?/);
    let mode = vm ? vm[1] : 'ocr';
    if (mode === 'openai' || mode === 'gemini') mode = 'api';
    document.getElementById('f-vmode').value = mode === 'api' ? 'api' : 'ocr';
    const vk = vb.match(/^\s+api_key:\s*["']?([^"'\n#]+)/m);
    if (vk) document.getElementById('f-vkey').value = vk[1].trim().replace(/["']$/g, '');
    const vu = vb.match(/^\s+base_url:\s*["']?([^"'\n#]+)/m);
    if (vu) document.getElementById('f-vurl').value = vu[1].trim().replace(/["']$/g, '');
    const vmod = vb.match(/^\s+model:\s*["']?([^"'\n#]+)/m);
    document.getElementById('f-vmodel').value = vmod ? vmod[1].trim().replace(/["']$/g, '') : '';
  } else {
    document.getElementById('f-vision').checked = true;
    document.getElementById('f-vmode').value = 'ocr';
    document.getElementById('f-vkey').value = '';
    document.getElementById('f-vurl').value = '';
    document.getElementById('f-vmodel').value = '';
  }
  updateVisionModeUi();

  let thinkingMode = 'follow';
  const tbThink = extractLastBlockNamedText(yaml, 'thinking');
  if (tbThink) {
    const en = tbThink.match(/^\s*enabled:\s*(true|false)/im);
    thinkingMode = en && en[1].toLowerCase() === 'false' ? 'off' : 'on';
  }
  const selThink = document.getElementById('f-thinking-mode');
  if (selThink) selThink.value = thinkingMode;

  const mht = yaml.match(/^max_history_tokens:\s*(-?\d+)/m);
  const elMht = document.getElementById('f-max-history-tokens');
  if (elMht) elMht.value = mht ? mht[1] : '150000';

  const cp = yaml.match(/^context_pressure:\s*([0-9.]+)/m);
  const elCp = document.getElementById('f-context-pressure');
  if (elCp) elCp.value = cp ? cp[1] : '';

  const tbComp = extractLastBlockNamedText(yaml, 'compression');
  const fce = document.getElementById('f-compression-enabled');
  const fcl = document.getElementById('f-compression-level');
  if (tbComp) {
    const cen = tbComp.match(/enabled:\s*(true|false)/i);
    if (fce) fce.checked = cen ? cen[1].toLowerCase() === 'true' : true;
    const lv = tbComp.match(/level:\s*([123])\b/);
    if (fcl) fcl.value = lv ? lv[1] : '2';
  } else {
    if (fce) fce.checked = true;
    if (fcl) fcl.value = '2';
  }

  const tbTools = extractLastBlockNamedText(yaml, 'tools');
  const fsm = document.getElementById('f-schema-mode');
  if (tbTools && fsm) {
    const sm = tbTools.match(/schema_mode:\s*['"]?(compact|full|names_only)['"]?/);
    fsm.value = sm ? sm[1] : 'full';
    const setToolChk = (id, re) => {
      const el = document.getElementById(id);
      if (!el) return;
      const m = tbTools.match(re);
      el.checked = m ? m[1].toLowerCase() === 'true' : false;
    };
    setToolChk('f-tools-adaptive', /adaptive_budget:\s*(true|false)/i);
    setToolChk('f-tools-smart', /smart_truncation:\s*(true|false)/i);
    setToolChk('f-tools-passthrough', /passthrough:\s*(true|false)/i);
    setToolChk('f-tools-disabled', /^\s*disabled:\s*(true|false)/im);
  } else if (fsm) {
    fsm.value = 'full';
    ['f-tools-adaptive', 'f-tools-smart', 'f-tools-passthrough', 'f-tools-disabled'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.checked = false;
    });
  }

  const tbLog = extractLastBlockNamedText(yaml, 'logging');
  const fld = document.getElementById('f-log-db');
  const flf = document.getElementById('f-log-file');
  if (tbLog) {
    const db = tbLog.match(/db_enabled:\s*(true|false)/i);
    const fe = tbLog.match(/file_enabled:\s*(true|false)/i);
    if (fld) fld.checked = db ? db[1].toLowerCase() === 'true' : false;
    if (flf) flf.checked = fe ? fe[1].toLowerCase() === 'true' : false;
  } else {
    if (fld) fld.checked = false;
    if (flf) flf.checked = false;
  }

  const mac = yaml.match(/^max_auto_continue:\s*(\d+)/m);
  const fmac = document.getElementById('f-max-auto-continue');
  if (fmac) fmac.value = mac ? mac[1] : '0';
}

// ── 表单 -> YAML ──
function formToYaml() {
  let yaml = rawYaml || '';
  yaml = yaml.replace(/^#?\s*enable_thinking:\s*.*$/mg, '');
  yaml = yaml.replace(/^#?\s*enable_progressive_truncation:\s*.*$/mg, '');

  const set = (key, val) => {
    const re = new RegExp('^(' + key + ':\\s*).*', 'm');
    if (re.test(yaml)) {
      yaml = yaml.replace(re, '$1' + val);
    } else {
      yaml += '\n' + key + ': ' + val;
    }
  };

  const port    = document.getElementById('f-port').value;
  const timeout = document.getElementById('f-timeout').value;
  const model   = document.getElementById('f-model').value;
  const proxy   = document.getElementById('f-proxy').value.trim();
  const authRaw  = document.getElementById('f-auth-tokens').value.trim();
  const authTokens = authRaw ? authRaw.split('\n').map(s => s.trim()).filter(Boolean) : [];
  const vision  = document.getElementById('f-vision').checked;
  const vmode   = document.getElementById('f-vmode').value;
  const vkey    = document.getElementById('f-vkey').value.trim();
  const vurl    = document.getElementById('f-vurl').value.trim();
  const vmodel  = document.getElementById('f-vmodel').value.trim();

  if (port)    set('port',    port);
  if (timeout) set('timeout', timeout);
  if (model)   set('cursor_model', '"' + model + '"');

  // 代理
  const proxyRe = /^(#\s*)?(proxy:\s*).*$/m;
  if (proxy) {
    if (proxyRe.test(yaml)) yaml = yaml.replace(proxyRe, 'proxy: "' + proxy + '"');
    else yaml += '\nproxy: "' + proxy + '"';
  } else {
    // 注释掉 proxy 行
    yaml = yaml.replace(/^proxy:.*$/m, '# proxy: "http://127.0.0.1:7890"');
  }

  // auth_tokens：先删光所有顶层块再写一处（避免旧正则遇第二段 auth_tokens: 提前结束留下重复）
  yaml = removeAllAuthTokensBlocksText(yaml).replace(/\n+$/, '');
  if (authTokens.length > 0) {
    yaml += '\n\nauth_tokens:\n' + authTokens.map(t => '  - "' + String(t).replace(/"/g, '\\"') + '"').join('\n') + '\n';
  }

  // vision：先去掉所有顶层 vision 块再写一个，避免重复 vision: 时只替换第一段
  yaml = removeAllVisionBlocksText(yaml).replace(/\n+$/, '');
  let newVisionBlock = 'vision:\n' +
    '  enabled: ' + String(vision) + '\n' +
    "  mode: '" + (vmode === 'api' ? 'api' : 'ocr') + "'\n";
  if (vmode === 'api') {
    if (vurl) newVisionBlock += '  base_url: "' + vurl + '"\n';
    if (vkey) newVisionBlock += '  api_key: "' + vkey + '"\n';
    if (vmodel) newVisionBlock += '  model: "' + vmodel + '"\n';
  }
  yaml += '\n\n' + newVisionBlock + '\n';

  return yaml;
}

// ── 保存 ──

// ── 模型列表 ──
async function fetchModels() {
  const el = document.getElementById('models-list');
  const btn = document.getElementById('btn-refresh-models');
  if (!running) { el.innerHTML = '<span style="color:var(--text2);font-size:12px">服务未运行，请先启动服务</span>'; return; }
  btn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="animation:spin .8s linear infinite"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg> 加载中...';
  try {
    const res = await fetch('http://localhost:' + port + '/v1/models');
    const json = await res.json();
    const models = json.data || [];
    if (models.length === 0) { el.innerHTML = '<span style="color:var(--text2);font-size:12px">暂无模型数据</span>'; return; }
    el.innerHTML = models.map(m => {
      const id = m.id || '';
      return '<div style="display:flex;align-items:center;justify-content:space-between;background:var(--bg3);border:1px solid var(--border);border-radius:6px;padding:8px 14px;margin-bottom:6px">'
        + '<span style="font-family:Consolas,monospace;font-size:13px;color:var(--green)">' + id + '</span>'
        + '<button class="copy-btn" onclick="navigator.clipboard.writeText(\'' + id + '\')">复制</button>'
        + '</div>';
    }).join('');
  } catch(e) {
    el.innerHTML = '<span style="color:var(--red);font-size:12px">获取失败: ' + e.message + '</span>';
  } finally {
    btn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg> 刷新';
  }
}

async function saveCfg() {
  const tip = document.getElementById('save-tip');
  let res;
  if (activeTab === 'raw') {
    const content = document.getElementById('raw-cfg').value;
    rawYaml = content;
    res = await window.api.saveConfig(content);
  } else {
    const fields = collectFieldsFromForm();
    res = await window.api.saveConfigFields(fields);
    // 保存后同步 raw-cfg 显示
    const newRaw = await window.api.getConfig();
    rawYaml = newRaw;
    document.getElementById('raw-cfg').value = newRaw;
  }
  if (!res.ok) {
    tip.className = 'err';
    tip.textContent = '保存失败: ' + res.error;
    setTimeout(() => { tip.className = ''; tip.textContent = '保存后需重启服务生效'; }, 3000);
    return;
  }
  tip.className = 'ok';
  tip.textContent = '保存成功，正在重启服务...';
  await window.api.restartService();
  await refreshPortFromMain();
  lastLogsEmbedUrl = '';
  if (logViewMode === 'viewer') refreshLogsEmbed();
  setTimeout(() => { tip.className = ''; tip.textContent = '保存后需重启服务生效'; }, 3000);
}

// ── 版本更新 ──
let _releases = null;
let _currentVer = '';

async function initUpdate() {
  const ver = await window.api.getVersion();
  _currentVer = String(ver || '').replace(/^v/i, '');
  const el = document.getElementById('u-current');
  if (el) el.textContent = _currentVer ? 'v' + _currentVer : '--';
  window.api.onDownloadProgress(pct => {
    const fill = document.getElementById('u-progress-fill');
    const label = document.getElementById('u-progress-label');
    const wrap = document.getElementById('u-progress');
    if (fill) fill.style.width = pct + '%';
    if (label) label.textContent = '下载中... ' + pct + '%';
    if (wrap) wrap.style.display = 'block';
  });
}

async function loadReleases() {
  const loading = document.getElementById('u-loading');
  const errEl   = document.getElementById('u-error');
  const listEl  = document.getElementById('u-list');
  const tbody   = document.getElementById('u-tbody');
  const latestEl = document.getElementById('u-latest');
  const stateEl  = document.getElementById('u-state');
  loading.style.display = 'block';
  errEl.style.display = 'none';
  listEl.style.display = 'none';
  tbody.innerHTML = '';

  const data = await window.api.getReleases();
  loading.style.display = 'none';

  if (!data || data.error) {
    errEl.textContent = '获取失败: ' + (data ? data.error : '无响应') + '\n（请检查网络，或前往 GitHub 手动下载）';
    errEl.style.display = 'block';
    if (stateEl) { stateEl.textContent = '获取失败'; stateEl.className = 'stat-value red'; }
    return;
  }

  _releases = data;
  const latest = data[0];
  if (latestEl) latestEl.textContent = latest ? latest.tag : '--';

  // 比较版本（strip v 前缀和 -desktop 后缀）
  const stripVer = s => s.replace(/^v/, '').replace(/-desktop$/, '');
  const isNewer = (a, b) => {
    const pa = stripVer(a).split('.').map(Number);
    const pb = stripVer(b).split('.').map(Number);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
      if ((pa[i]||0) > (pb[i]||0)) return true;
      if ((pa[i]||0) < (pb[i]||0)) return false;
    }
    return false;
  };
  if (stateEl) {
    if (!latest) { stateEl.textContent = '无版本'; stateEl.className = 'stat-value'; }
    else if (isNewer(latest.tag, _currentVer)) {
      stateEl.textContent = '有新版本'; stateEl.className = 'stat-value green';
    } else {
      stateEl.textContent = '已是最新'; stateEl.className = 'stat-value blue';
    }
  }

  data.forEach(rel => {
    const exeAssets = (rel.assets || []).filter(a => a.name.endsWith('.exe'));
    const date = rel.published_at ? rel.published_at.slice(0,10) : '--';
    const isCurrent = stripVer(rel.tag) === stripVer(_currentVer);
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><span class="rel-tag${isCurrent ? ' rel-tag--current' : ''}">${rel.tag}</span>${isCurrent ? ' <span class="badge">当前</span>' : ''}</td>
      <td style="color:var(--text2);font-size:12px">${date}</td>
      <td style="font-size:12px;color:var(--text2)">${exeAssets.length ? exeAssets.map(a => a.name).join('<br>') : '暂无安装包'}</td>
      <td>
        ${(() => {
          const distAsset = (rel.assets || []).find(a => a.name === 'dist.zip');
          const relVer = rel.tag.replace(/^v|-desktop$/g, '');
          const curVer = _currentVer;
          const newer = isNewer(rel.tag, 'v' + curVer);
          const btns = [];
          if (distAsset && newer) {
            btns.push(`<button class="btn btn-green btn-sm" onclick="doHotUpdate('${distAsset.url}')" title="只替换服务逻辑，无需重装">⬆ 热更新</button>`);
          }
          if (exeAssets.length && newer) {
            btns.push(...exeAssets.map(a => `<button class="btn btn-gray btn-sm" onclick="doDownload('${a.url}','${a.name}')" title="下载完整安装包重新安装">完整安装</button>`));
          }
          if (!newer && !isCurrent) btns.push('<span style="color:var(--text3);font-size:12px">旧版本</span>');
          if (isCurrent) btns.push('<span style="color:var(--blue);font-size:12px">当前版本</span>');
          return btns.length ? btns.join(' ') : '<span style="color:var(--text3)">--</span>';
        })()
        }
      </td>
    `;
    tbody.appendChild(tr);
  });
  listEl.style.display = 'block';
}

async function doHotUpdate(url) {
  const wrap  = document.getElementById('u-progress');
  const fill  = document.getElementById('u-progress-fill');
  const label = document.getElementById('u-progress-label');
  if (wrap)  wrap.style.display = 'block';
  if (fill)  fill.style.width = '0%';
  if (label) label.textContent = '正在热更新...';
  const res = await window.api.hotUpdate(url);
  if (!res.ok) {
    if (label) label.textContent = '热更新失败: ' + res.error;
  } else {
    if (label) label.textContent = '热更新完成，服务已自动重启！';
    if (fill)  fill.style.width = '100%';
    // 刷新当前版本号
    const ver = res.version || await window.api.getVersion();
    _currentVer = String(ver || '').replace(/^v/i, '');
    const el = document.getElementById('u-current');
    if (el) el.textContent = _currentVer ? 'v' + _currentVer : '--';
    const sEl = document.getElementById('s-version');
    if (sEl) sEl.textContent = _currentVer || '--';
    const aboutEl = document.getElementById('about-ver');
    if (aboutEl && _currentVer) aboutEl.textContent = 'v' + _currentVer;
    // 重新渲染版本列表（按钮状态随之更新）
    _releases = null;
    setTimeout(() => loadReleases(), 500);
  }
}

async function doDownload(url, name) {
  const wrap = document.getElementById('u-progress');
  const fill = document.getElementById('u-progress-fill');
  const label = document.getElementById('u-progress-label');
  if (wrap) { wrap.style.display = 'block'; }
  if (fill) fill.style.width = '0%';
  if (label) label.textContent = '准备下载...';
  const res = await window.api.downloadAndInstall(url, name);
  if (!res.ok) {
    if (label) label.textContent = '下载失败: ' + res.error;
  } else {
    if (label) label.textContent = '下载完成，安装程序已启动';
  }
}

// 切换到更新页面时自动加载
document.querySelectorAll('.nav-item').forEach(el => {
  if (el.dataset.page === 'update') {
    el.addEventListener('click', () => {
      if (!_releases) loadReleases();
    });
  }
});

// 初始化
initUpdate();
