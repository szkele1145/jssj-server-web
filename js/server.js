const API_BASE = 'https://api.jssj.cc.cd';
let serverRefreshTimer = null;

function renderServerStatus(data) {
  const container = document.getElementById('serverStatusContent');
  const online = data.online;
  const statusClass = online ? 'online' : 'offline';
  const label = online ? '在线' : '离线';
  const count = online ? (data.players?.online ?? 0) : 0;

  let motdHtml = '';
  if (online && data.motd?.html?.length) motdHtml = data.motd.html.join('<br>');
  else if (online && data.motd?.clean?.length) motdHtml = data.motd.clean.join('<br>');
  else if (online) motdHtml = '<span style="opacity:0.3;">无 MOTD</span>';

  const javaPlayers = data.players?.java || [];
  const bedrockPlayers = data.players?.bedrock || [];
  const botCount = data.players?.bots ?? 0;
  const now = new Date();
  const timeStr = now.toLocaleTimeString('zh-CN', { hour12: false });

  let bodyHtml = '';
  if (!online) {
    bodyHtml = '<div style="opacity:0.3;text-align:center;padding:2rem 0;">服务器离线</div>';
  } else if (javaPlayers.length === 0 && bedrockPlayers.length === 0 && botCount === 0) {
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
        <div class="status-badge ${statusClass}"><span class="dot"></span> ${label}</div>
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
  try {
    const resp = await fetch(API_BASE + '/api/mc-status');
    const data = await resp.json();
    if (data.success) { renderServerStatus(data); return; }
    throw new Error(data.error || '获取失败');
  } catch (err) {
    console.warn('Worker 失败，尝试直连:', err);
    try {
      const resp = await fetch('https://api.mcsrvstat.us/3/jssj.cc.cd');
      const d = await resp.json();
      const raw = d.players?.list || [];
      const names = raw.length && typeof raw[0] === 'object' ? raw.map(p => p.name) : raw;
      const info = d.info?.clean || d.info?.raw || [];
      renderServerStatus({
        success: true, online: d.online || false,
        players: d.online && d.players ? {
          online: d.players.online ?? 0, max: d.players.max ?? 0,
          java: names.filter(n => n && !n.startsWith('.')),
          bedrock: [...new Set([...names.filter(n => n && n.startsWith('.')).map(n => n.slice(1)), ...info.filter(n => n && n.startsWith('.')).map(n => n.slice(1))])],
          bots: info.filter(n => n === 'Anonymous Player').length,
        } : { online: 0, max: 0, java: [], bedrock: [], bots: 0 },
        motd: d.motd || null,
      });
    } catch {
      container.innerHTML = `<div class="server-status-card" style="text-align:center;padding:3rem;"><i class="fas fa-exclamation-triangle" style="font-size:2rem;opacity:0.2;"></i><div style="margin-top:1rem;opacity:0.3;">无法获取数据</div><button class="refresh-btn" onclick="fetchServerStatus()" style="margin-top:0.8rem;">重试</button></div>`;
      scheduleRefresh();
    }
  }
}

fetchServerStatus();
