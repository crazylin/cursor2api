'use strict';

let running = false, autoScroll = true, startTime = null, uptimeTimer = null, port = 3010;
let rawYaml = '';
let activeTab = 'simple';

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
  });
});

// ── 初始化 ──
(async () => {
  port = await window.api.getPort();
  updateEP();
  document.getElementById('s-port').textContent = port;
  const ver = await window.api.getVersion();
  const vEl = document.getElementById('s-version');
  if (vEl) vEl.textContent = 'v' + ver;
  setStatus(await window.api.getStatus());
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
  // 历史日志加载完后再注册实时监听，避免重复显示
  window.api.onServiceStatus(s => { setStatus(s); if (s) setTimeout(fetchModels, 1500); });
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

// ── 配置 Tab 切换 ──
function switchTab(tab) {
  activeTab = tab;
  document.querySelectorAll('.cfg-tab').forEach((el, i) => {
    el.classList.toggle('active', (i === 0 && tab === 'simple') || (i === 1 && tab === 'raw'));
  });
  document.getElementById('panel-simple').classList.toggle('active', tab === 'simple');
  document.getElementById('panel-raw').classList.toggle('active', tab === 'raw');
  if (tab === 'raw') {
    // 切换到原始 YAML 时，先把表单内容同步过去
    document.getElementById('raw-cfg').value = formToYaml();
  } else {
    // 切换到表单时，把 raw-cfg 内容解析到表单
    yamlToForm(document.getElementById('raw-cfg').value);
  }
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

  // auth_tokens：解析列表
  const authBlock = yaml.match(/^auth_tokens:\s*\n((?:\s+-\s+.+\n?)*)/m);
  if (authBlock) {
    const tokens = authBlock[1].match(/^\s+-\s+["']?([^"'\n]+)["']?/mg) || [];
    document.getElementById('f-auth-tokens').value = tokens.map(t => t.replace(/^\s+-\s+["']?|["']\s*$/g, '').trim()).join('\n');
  } else {
    document.getElementById('f-auth-tokens').value = '';
  }

  // vision enabled
  const visionBlock = yaml.match(/^vision:[\s\S]*?(?=^\w|$)/m);
  if (visionBlock) {
    const vb = visionBlock[0];
    const ve = vb.match(/enabled:\s*(true|false)/);
    document.getElementById('f-vision').checked = ve ? ve[1] === 'true' : false;
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
    document.getElementById('f-vmode').value = 'ocr';
    document.getElementById('f-vkey').value = '';
    document.getElementById('f-vurl').value = '';
    document.getElementById('f-vmodel').value = '';
  }
  updateVisionModeUi();

  // thinking
  const thinkM = yaml.match(/^#?\s*enable_thinking:\s*(true|false)/m);
  document.getElementById('f-thinking').checked = thinkM ? thinkM[1] === 'true' : true;

  // truncation
  const truncM = yaml.match(/^#?\s*enable_progressive_truncation:\s*(true|false)/m);
  document.getElementById('f-truncation').checked = truncM ? truncM[1] === 'true' : true;
}

// ── 表单 -> YAML ──
function formToYaml() {
  let yaml = rawYaml || '';

  const set = (key, val) => {
    const re = new RegExp('^(' + key + ':\\s*).*', 'm');
    if (re.test(yaml)) {
      yaml = yaml.replace(re, '$1' + val);
    } else {
      yaml += '\n' + key + ': ' + val;
    }
  };

  const setBoolLine = (key, val) => {
    // 取消注释并设置值，或新增
    const commentedRe = new RegExp('^#\\s*(' + key + ':\\s*).*', 'm');
    const plainRe     = new RegExp('^(' + key + ':\\s*).*', 'm');
    if (plainRe.test(yaml)) {
      yaml = yaml.replace(plainRe, '$1' + val);
    } else if (commentedRe.test(yaml)) {
      yaml = yaml.replace(commentedRe, '$1' + val);
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
  const thinking = document.getElementById('f-thinking').checked;
  const truncation = document.getElementById('f-truncation').checked;
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

  // auth_tokens
  const authBlockRe = /^auth_tokens:[\s\S]*?(?=^\w|\Z)/m;
  if (authTokens.length > 0) {
    const newAuthBlock = 'auth_tokens:\n' + authTokens.map(t => '  - "' + t + '"').join('\n') + '\n';
    if (authBlockRe.test(yaml)) yaml = yaml.replace(authBlockRe, newAuthBlock);
    else yaml += '\n' + newAuthBlock;
  } else {
    // 移除 auth_tokens 块
    yaml = yaml.replace(authBlockRe, '');
  }

  setBoolLine('enable_thinking', String(thinking));
  setBoolLine('enable_progressive_truncation', String(truncation));

  // vision 块（ocr 仅写 enabled+mode；api 写 Key/URL/模型）
  const visionBlockRe = /(^vision:[\s\S]*?)(?=^\w|\Z)/m;
  let newVisionBlock = 'vision:\n' +
    '  enabled: ' + String(vision) + '\n' +
    "  mode: '" + (vmode === 'api' ? 'api' : 'ocr') + "'\n";
  if (vmode === 'api') {
    if (vurl) newVisionBlock += '  base_url: "' + vurl + '"\n';
    if (vkey) newVisionBlock += '  api_key: "' + vkey + '"\n';
    if (vmodel) newVisionBlock += '  model: "' + vmodel + '"\n';
  }

  if (visionBlockRe.test(yaml)) {
    yaml = yaml.replace(visionBlockRe, newVisionBlock);
  } else {
    yaml += '\n' + newVisionBlock;
  }

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
  let content;
  if (activeTab === 'raw') {
    content = document.getElementById('raw-cfg').value;
  } else {
    content = formToYaml();
    document.getElementById('raw-cfg').value = content;
  }
  rawYaml = content;
  const res = await window.api.saveConfig(content);
  if (!res.ok) {
    tip.className = 'err';
    tip.textContent = '保存失败: ' + res.error;
    setTimeout(() => { tip.className = ''; tip.textContent = '保存后需重启服务生效'; }, 3000);
    return;
  }
  // 保存成功后自动重启服务
  tip.className = 'ok';
  tip.textContent = '保存成功，正在重启服务...';
  await window.api.restartService();
  setTimeout(() => { tip.className = ''; tip.textContent = '保存后需重启服务生效'; }, 3000);
}

// ── 版本更新 ──
let _releases = null;
let _currentVer = '';

async function initUpdate() {
  const ver = await window.api.getVersion();
  _currentVer = ver;
  const el = document.getElementById('u-current');
  if (el) el.textContent = 'v' + ver;
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
    _currentVer = ver;  // 更新全局版本号
    const el = document.getElementById('u-current');
    if (el) el.textContent = 'v' + ver;
    const sEl = document.getElementById('s-version');
    if (sEl) sEl.textContent = 'v' + ver;
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
