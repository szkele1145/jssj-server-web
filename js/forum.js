const API_BASE = 'https://api.jssj.cc.cd';

async function fetchForumPosts() {
  try {
    const resp = await fetch(API_BASE + '/api/posts');
    const data = await resp.json();
    renderPosts(data.success ? data.posts : null);
  } catch {
    renderPosts(null);
  }
}

function renderPosts(posts) {
  const container = document.getElementById('forumPosts');
  if (!container) return;
  if (!posts || posts.length === 0) {
    container.innerHTML = '<div class="forum-post"><div class="post-excerpt" style="text-align:center;opacity:0.3;">暂无动态</div></div>';
    return;
  }
  container.innerHTML = posts.map(p => `
    <div class="forum-post">
      <div class="post-title">${p.title || '未命名'}${p.pinned ? '<span class="pin-badge">置顶</span>' : ''}</div>
      <div class="post-meta">${p.author || '匿名'} · ${p.date || ''}</div>
      <div class="post-excerpt">${p.excerpt || p.content || ''}</div>
    </div>`).join('');
}

fetchForumPosts();
