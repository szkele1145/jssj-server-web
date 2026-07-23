const API_BASE = 'https://api.jssj.cc.cd';

async function fetchUptime() {
  const el = document.getElementById('uptimeDays');
  try {
    const resp = await fetch(API_BASE + '/api/uptime');
    const data = await resp.json();
    if (data.success) el.textContent = data.days;
    else throw new Error('API returned failure');
  } catch {
    const start = new Date('2024-06-28');
    const diff = Math.ceil(Math.abs(new Date() - start) / 86400000);
    el.textContent = diff;
  }
}
fetchUptime();
