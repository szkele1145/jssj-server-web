const API_BASE = 'https://api.jssj.cc.cd';
let serverRefreshTimer = null;

function showError(msg) {
  const container = document.getElementById('serverStatusContent');
  container.innerHTML = `<div class="server-status-card" style="text-align:center;padding:3rem;"><i class="fas fa-exclamation-triangle" style="font-size:2rem;opacity:0.2;"></i><div style="margin-top:1rem;opacity:0.3;">${msg}</div><button class="refresh-btn" onclick="fetchServerStatus()" style="margin-top:0.8rem;">重试</button></div>`;
  scheduleRefresh();
}

function renderServerStatus(data) {
  const container = document.getElementById('serverStatusContent');
  if (!data.online) {
    console.warn('[服务器状态] 查询返回离线，视为查询失败:', data);
    showError('无法获取数据');
    return;
  }
  const count = data.players?.online ?? 0;
  let motdHtml = '';
  if (data.motd?.html?.length) motdHtml = data.motd.html.join('<br>');
  else if (data.motd?.clean?.length) motdHtml = data.motd.clean.join('<br>');
  else motdHtml = '<span style="opacity:0.3;">无 MOTD</span>';

  const javaPlayers = data.players?.java || [];
  const bedrockPlayers = data.players?.bedrock || [];
  const botCount = data.players?.bots ?? 0;
  const timeStr = new Date().toLocaleTimeString('zh-CN', { hour12: false });

  let bodyHtml = '';
  if (javaPlayers.length === 0 && bedrockPlayers.length === 0 && botCount === 0) {
    bodyHtml = '<div style="opacity:0.3;text-align:center;padding:1.5rem 0;">暂无玩家在线</div>';
  } else {
    let cols = '';
    if (javaPlayers.length > 0) cols += `<div class="player-section"><div class="section-label"><span class="badge java">Java</span> ${javaPlayers.length} 人</div><div class="player-list">${javaPlayers.map(n => `<span class="player-name">${n}</span>`).join('')}</div></div>`;
    if (bedrockPlayers.length > 0) cols += `<div class="player-section"><div class="section-label"><span class="badge bedrock">BE</span> ${bedrockPlayers.length} 人</div><div class="player-list">${bedrockPlayers.map(n => `<span class="player-name">${n}</span>`).join('')}</div></div>`;
    if (botCount > 0) cols += `<div class="player-section bot-section"><div class="section-label" style="margin-bottom:0;"><span><span class="badge bot">Bot</span> ${botCount}</span></div></div>`;
    bodyHtml = cols ? `<div class="player-grid">${cols}</div>` : '<div style="opacity:0.3;text-align:center;padding:1.5rem 0;">暂无玩家在线</div>';
  }

  container.innerHTML = `
    <div class="server-status-card">
      <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:0.5rem;">
        <div class="status-badge online"><span class="dot"></span> 在线</div>
        <div class="online-count"><i class="fas fa-users" style="opacity:0.3;margin-right:6px;"></i> ${count} 人在线</div>
      </div>
      ${bodyHtml}
      <div class="motd-display">${motdHtml}</div>
    </div>
    <div class="server-updated">
      <i class="fas fa-sync-alt"></i> 更新于 ${timeStr}
      <button class="refresh-btn" onclick="fetchServerStatus()"><i class="fas fa-redo"></i> 刷新</button>
    </div>`;
  scheduleRefresh();
}

function scheduleRefresh() {
  if (serverRefreshTimer) clearTimeout(serverRefreshTimer);
  serverRefreshTimer = setTimeout(fetchServerStatus, 30000);
}

async function fetchServerStatus() {
  const container = document.getElementById('serverStatusContent');
  // Worker 代理
  try {
    const resp = await fetch(API_BASE + '/api/mc-status');
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    const data = await resp.json();
    if (data.success && data.online) { renderServerStatus(data); return; }
    if (data.success && !data.online) throw new Error('后端查询返回离线: ' + JSON.stringify(data));
    throw new Error(data.error || 'Worker 返回失败');
  } catch (err) {
    console.warn('[服务器状态] Worker 代理失败:', err.message);
  }

  // 降级：直连 mcsrvstat.us v3+v2
  console.log('[服务器状态] 尝试直连 mcsrvstat.us v3/v2...');
  try {
    let merged = { online: false, players: null, motd: null };
    for (const ver of ['3', '2']) {
      try {
        const resp = await fetch(`https://api.mcsrvstat.us/${ver}/jssj.cc.cd`);
        if (!resp.ok) { console.warn('[服务器状态] v' + ver + ' HTTP ' + resp.status); continue; }
        const d = await resp.json();
        console.log('[服务器状态] v' + ver + ' 返回:', JSON.stringify(d).slice(0, 300));
        if (d.online) merged.online = true;
        if (d.motd && !merged.motd) merged.motd = d.motd;
        if (d.players) {
          if (!merged.players) merged.players = { online: 0, max: 0, names: [], info: [] };
          merged.players.online = Math.max(merged.players.online, d.players.online ?? 0);
          merged.players.max = Math.max(merged.players.max, d.players.max ?? 0);
          const raw = d.players.list || [];
          const names = raw.length && typeof raw[0] === 'object' ? raw.map(p => p.name) : raw;
          merged.players.names = [...new Set([...merged.players.names, ...names])];
          const info = d.info?.clean || d.info?.raw || [];
          merged.players.info = [...new Set([...merged.players.info, ...info])];
        }
      } catch (e) { console.warn('[服务器状态] v' + ver + ' 异常:', e.message); }
    }
    if (!merged.players) merged.players = { online: 0, max: 0, names: [], info: [] };
    const p = merged.players;
    console.log('[服务器状态] 直连合并结果:', JSON.stringify({ online: merged.online, players: { online: p.online, max: p.max, names: p.names.length, info: p.info.length } }));
    renderServerStatus({
      success: true, online: merged.online,
      players: {
        online: p.online, max: p.max,
        java: p.names.filter(n => n && !n.startsWith('.')),
        bedrock: [...new Set([...p.names.filter(n => n && n.startsWith('.')).map(n => n.slice(1)), ...p.info.filter(n => n && n.startsWith('.')).map(n => n.slice(1))])],
        bots: p.info.filter(n => n === 'Anonymous Player').length,
      },
      motd: merged.motd,
    });
  } catch (e) {
    console.error('[服务器状态] 直连完全失败:', e);
    showError('无法获取数据');
  }
}

fetchServerStatus();
