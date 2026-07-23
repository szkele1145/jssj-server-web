// ============================================================
// 建设世界 · 后端 API
// Worker 名称: jsapi
// ============================================================

const SERVER_START_DATE = '2024-06-28';
const ADMIN_KEY = 'jssjapi';

const ALLOWED_ORIGINS = [
  'https://jssj.cc.cd',
  'http://localhost:5500',
  'http://127.0.0.1:5500',
];

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const origin = request.headers.get('Origin') || '';

    const corsHeaders = {
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    };

    const isAllowed = ALLOWED_ORIGINS.some(allowed => origin === allowed);
    if (isAllowed) {
      corsHeaders['Access-Control-Allow-Origin'] = origin;
    } else {
      if (!origin || origin === 'null') {
        corsHeaders['Access-Control-Allow-Origin'] = '*';
      }
    }

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    // ============================================================
    // POST /api/auth - 验证密码
    // ============================================================
    if (path === '/api/auth' && request.method === 'POST') {
      try {
        const body = await request.json();
        const { password } = body;

        if (password === ADMIN_KEY) {
          return new Response(JSON.stringify({ success: true, message: '验证通过' }), {
            headers: { 'Content-Type': 'application/json', ...corsHeaders },
          });
        } else {
          return new Response(JSON.stringify({ success: false, error: '密码错误' }), {
            status: 401,
            headers: { 'Content-Type': 'application/json', ...corsHeaders },
          });
        }
      } catch (error) {
        return new Response(JSON.stringify({ success: false, error: error.message }), {
          status: 500,
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      }
    }

    // ============================================================
    // GET /api/uptime - 运行天数
    // ============================================================
    if (path === '/api/uptime' && request.method === 'GET') {
      try {
        const startDate = new Date(SERVER_START_DATE);
        const now = new Date();
        const diffDays = Math.ceil(Math.abs(now - startDate) / (1000 * 60 * 60 * 24));

        return new Response(JSON.stringify({ success: true, days: diffDays, startDate: SERVER_START_DATE }), {
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      } catch (error) {
        return new Response(JSON.stringify({ success: false, error: error.message }), {
          status: 500,
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      }
    }

    // ============================================================
    // GET /api/mc-status - 服务器实时状态（代理 mcsrvstat.us，重试3次）
    // ============================================================
    if (path === '/api/mc-status' && request.method === 'GET') {
      async function fetchJson(url, signal) {
        const resp = await fetch(url, { signal });
        if (!resp.ok) throw new Error('HTTP ' + resp.status);
        return resp.json();
      }

      function parseMcStatus(json) {
        const raw = json.players?.list || [];
        const names = raw.length && typeof raw[0] === 'object' ? raw.map(p => p.name) : raw;
        const info = json.info?.clean || json.info?.raw || [];
        return {
          online: json.online || false, motd: json.motd || null,
          players: json.online && json.players ? {
            online: json.players.online ?? 0, max: json.players.max ?? 0,
            names, info,
          } : null,
        };
      }

      function parseMcStatusIO(json) {
        if (!json.online) return { online: false, motd: null, players: null };
        const list = json.players?.list || [];
        const real = list.filter(p => p.uuid !== '00000000-0000-0000-0000-000000000000').map(p => p.name_clean || p.name_raw);
        const bots = list.filter(p => p.uuid === '00000000-0000-0000-0000-000000000000').length;
        return {
          online: true,
          motd: json.motd ? { html: [json.motd.html || json.motd.clean], clean: [json.motd.clean || json.motd.raw] } : null,
          players: { online: json.players.online ?? 0, max: json.players.max ?? 0, names: real, info: ['Anonymous Player'.repeat(Math.max(0, json.players.online - real.length))] },
        };
      }

      function mergeData(results) {
        let online = false, maxP = 0, real = [], extra = [], motd = null;
        for (const r of results) {
          if (!r) continue;
          if (r.online) online = true;
          if (r.motd && !motd) motd = r.motd;
          if (r.players) {
            maxP = Math.max(maxP, r.players.max);
            real = [...new Set([...real, ...(r.players.names || [])])];
            extra = [...new Set([...extra, ...(r.players.info || [])])];
          }
        }
        // 从 real 中分离 Java/Bedrock（名字带 . 的是基岩版）
        const java = real.filter(n => n && !n.startsWith('.'));
        const bedrock = [...new Set([
          ...real.filter(n => n && n.startsWith('.')).map(n => n.slice(1)),
          ...extra.filter(n => n && n.startsWith('.')).map(n => n.slice(1)),
        ])];
        // 机器人 = 在线总数 - (Java + 基岩)
        const totalOnline = Math.max(java.length + bedrock.length, ...results.filter(r => r?.players).map(r => r.players.online));
        const bots = Math.max(0, totalOnline - java.length - bedrock.length);
        return {
          success: true, online,
          players: { online: totalOnline, max: maxP, java, bedrock, bots },
          motd,
        };
      }

      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 8000);
        const results = [];

        // 1) mcstatus.io（主）
        try {
          const json = await fetchJson('https://api.mcstatus.io/v2/status/java/jssj.cc.cd', controller.signal);
          results.push(parseMcStatusIO(json));
        } catch {}

        // 2) mcsrvstat.us v3
        try {
          const json = await fetchJson('https://api.mcsrvstat.us/3/jssj.cc.cd', controller.signal);
          results.push(parseMcStatus(json));
        } catch {}

        // 3) mcsrvstat.us v2
        try {
          const json = await fetchJson('https://api.mcsrvstat.us/2/jssj.cc.cd', controller.signal);
          results.push(parseMcStatus(json));
        } catch {}

        clearTimeout(timeout);
        if (results.length === 0) return new Response(JSON.stringify({ success: false, error: '所有 API 均查询失败' }), { status: 502, headers: { 'Content-Type': 'application/json', ...corsHeaders } });
        const result = mergeData(results);
        return new Response(JSON.stringify(result), {
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      } catch (error) {
        return new Response(JSON.stringify({ success: false, error: error.message || '请求失败' }), {
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      }
    }

    // ============================================================
    // GET /api/posts - 获取帖子列表
    // ============================================================
    if (path === '/api/posts' && request.method === 'GET') {
      try {
        let posts = await env.jsapi.get('posts', 'json');

        if (!posts) {
          posts = [];
        }

        const sortedPosts = [...posts].sort((a, b) => {
          if (a.pinned && !b.pinned) return -1;
          if (!a.pinned && b.pinned) return 1;
          return new Date(b.date) - new Date(a.date);
        });

        return new Response(JSON.stringify({ success: true, posts: sortedPosts }), {
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      } catch (error) {
        return new Response(JSON.stringify({ success: false, error: error.message }), {
          status: 500,
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      }
    }

    // ============================================================
    // POST /api/posts - 发布帖子
    // ============================================================
    if (path === '/api/posts' && request.method === 'POST') {
      try {
        const authHeader = request.headers.get('Authorization');
        if (authHeader !== `Bearer ${ADMIN_KEY}`) {
          return new Response(JSON.stringify({ success: false, error: 'Unauthorized' }), {
            status: 401,
            headers: { 'Content-Type': 'application/json', ...corsHeaders },
          });
        }

        const body = await request.json();
        const { title, author, excerpt, content, pinned } = body;

        if (!title || !author) {
          return new Response(JSON.stringify({ success: false, error: '标题和发布人为必填项' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json', ...corsHeaders },
          });
        }

        let posts = await env.jsapi.get('posts', 'json');
        if (!posts) posts = [];

        const newPost = {
          id: Date.now().toString(),
          title,
          author,
          excerpt: excerpt || content || '',
          content: content || excerpt || '',
          pinned: pinned || false,
          date: new Date().toISOString().split('T')[0],
        };

        posts.push(newPost);
        await env.jsapi.put('posts', JSON.stringify(posts));

        return new Response(JSON.stringify({ success: true, message: '帖子发布成功', post: newPost }), {
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      } catch (error) {
        return new Response(JSON.stringify({ success: false, error: error.message }), {
          status: 500,
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      }
    }

    // ============================================================
    // DELETE /api/posts/:id - 删除帖子
    // ============================================================
    if (path.startsWith('/api/posts/') && request.method === 'DELETE') {
      try {
        const postId = path.split('/').pop();
        const authHeader = request.headers.get('Authorization');

        if (authHeader !== `Bearer ${ADMIN_KEY}`) {
          return new Response(JSON.stringify({ success: false, error: 'Unauthorized' }), {
            status: 401,
            headers: { 'Content-Type': 'application/json', ...corsHeaders },
          });
        }

        let posts = await env.jsapi.get('posts', 'json');
        if (!posts || posts.length === 0) {
          return new Response(JSON.stringify({ success: false, error: '没有帖子可删除' }), {
            status: 404,
            headers: { 'Content-Type': 'application/json', ...corsHeaders },
          });
        }

        const filteredPosts = posts.filter(p => p.id !== postId);
        if (filteredPosts.length === posts.length) {
          return new Response(JSON.stringify({ success: false, error: '帖子不存在' }), {
            status: 404,
            headers: { 'Content-Type': 'application/json', ...corsHeaders },
          });
        }

        await env.jsapi.put('posts', JSON.stringify(filteredPosts));

        return new Response(JSON.stringify({ success: true, message: '帖子已删除' }), {
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      } catch (error) {
        return new Response(JSON.stringify({ success: false, error: error.message }), {
          status: 500,
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      }
    }

    // ============================================================
    // GET /api/votes - 获取投票列表
    // ============================================================
    if (path === '/api/votes' && request.method === 'GET') {
      try {
        let votes = await env.jsapi.get('votes', 'json');
        if (!votes) votes = [];
        return new Response(JSON.stringify({ success: true, votes }), {
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      } catch (error) {
        return new Response(JSON.stringify({ success: false, error: error.message }), {
          status: 500,
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      }
    }

    // ============================================================
    // POST /api/votes - 创建投票（需验证）
    // ============================================================
    if (path === '/api/votes' && request.method === 'POST') {
      try {
        const authHeader = request.headers.get('Authorization');
        if (authHeader !== `Bearer ${ADMIN_KEY}`) {
          return new Response(JSON.stringify({ success: false, error: 'Unauthorized' }), {
            status: 401,
            headers: { 'Content-Type': 'application/json', ...corsHeaders },
          });
        }

        const body = await request.json();
        const { title, description, deadline } = body;
        if (!title) {
          return new Response(JSON.stringify({ success: false, error: '标题为必填项' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json', ...corsHeaders },
          });
        }

        let votes = await env.jsapi.get('votes', 'json');
        if (!votes) votes = [];

        const newVote = {
          id: Date.now().toString(),
          title,
          description: description || '',
          deadline: deadline || null,
          yesCount: 0,
          noCount: 0,
          voters: {},
          active: true,
          date: new Date().toISOString().split('T')[0],
        };

        votes.push(newVote);
        await env.jsapi.put('votes', JSON.stringify(votes));

        return new Response(JSON.stringify({ success: true, message: '投票创建成功', vote: newVote }), {
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      } catch (error) {
        return new Response(JSON.stringify({ success: false, error: error.message }), {
          status: 500,
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      }
    }

    // ============================================================
    // POST /api/votes/:id/vote - 投票（同意/反对，一人一票）
    // ============================================================
    if (path.match(/^\/api\/votes\/[^/]+\/vote$/) && request.method === 'POST') {
      try {
        const voteId = path.split('/')[3];
        const body = await request.json();
        const { option } = body;

        if (!option || !['yes', 'no'].includes(option)) {
          return new Response(JSON.stringify({ success: false, error: '选项无效' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json', ...corsHeaders },
          });
        }

        let votes = await env.jsapi.get('votes', 'json');
        if (!votes) votes = [];

        const idx = votes.findIndex(v => v.id === voteId);
        if (idx === -1) {
          return new Response(JSON.stringify({ success: false, error: '投票不存在' }), {
            status: 404,
            headers: { 'Content-Type': 'application/json', ...corsHeaders },
          });
        }

        const vote = votes[idx];
        if (!vote.active) {
          return new Response(JSON.stringify({ success: false, error: '投票已关闭' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json', ...corsHeaders },
          });
        }

        // 用客户端 IP 防重复投票
        const voterIP = request.headers.get('CF-Connecting-IP') || request.headers.get('X-Real-IP') || 'unknown';
        if (vote.voters && vote.voters[voterIP]) {
          return new Response(JSON.stringify({ success: false, error: '你已经投过票了' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json', ...corsHeaders },
          });
        }

        if (!vote.voters) vote.voters = {};
        vote.voters[voterIP] = option;
        vote.yesCount = (vote.yesCount || 0) + (option === 'yes' ? 1 : 0);
        vote.noCount = (vote.noCount || 0) + (option === 'no' ? 1 : 0);

        votes[idx] = vote;
        await env.jsapi.put('votes', JSON.stringify(votes));

        return new Response(JSON.stringify({ success: true, message: '投票成功', vote: { yesCount: vote.yesCount, noCount: vote.noCount } }), {
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      } catch (error) {
        return new Response(JSON.stringify({ success: false, error: error.message }), {
          status: 500,
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      }
    }

    // ============================================================
    // PUT /api/votes/:id - 编辑投票（需验证）
    // ============================================================
    if (path.match(/^\/api\/votes\/[^/]+$/) && request.method === 'PUT') {
      try {
        const authHeader = request.headers.get('Authorization');
        if (authHeader !== `Bearer ${ADMIN_KEY}`) {
          return new Response(JSON.stringify({ success: false, error: 'Unauthorized' }), {
            status: 401,
            headers: { 'Content-Type': 'application/json', ...corsHeaders },
          });
        }
        const voteId = path.split('/').pop();
        const body = await request.json();
        let votes = await env.jsapi.get('votes', 'json');
        if (!votes) votes = [];
        const idx = votes.findIndex(v => v.id === voteId);
        if (idx === -1) {
          return new Response(JSON.stringify({ success: false, error: '投票不存在' }), {
            status: 404,
            headers: { 'Content-Type': 'application/json', ...corsHeaders },
          });
        }
        if (body.title !== undefined) votes[idx].title = body.title;
        if (body.description !== undefined) votes[idx].description = body.description;
        if (body.deadline !== undefined) votes[idx].deadline = body.deadline;
        await env.jsapi.put('votes', JSON.stringify(votes));
        return new Response(JSON.stringify({ success: true, message: '投票已更新', vote: votes[idx] }), {
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      } catch (error) {
        return new Response(JSON.stringify({ success: false, error: error.message }), {
          status: 500,
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      }
    }

    // ============================================================
    // DELETE /api/votes/:id - 删除投票（需验证）
    // ============================================================
    if (path.match(/^\/api\/votes\/[^/]+$/) && request.method === 'DELETE') {
      try {
        const authHeader = request.headers.get('Authorization');
        if (authHeader !== `Bearer ${ADMIN_KEY}`) {
          return new Response(JSON.stringify({ success: false, error: 'Unauthorized' }), {
            status: 401,
            headers: { 'Content-Type': 'application/json', ...corsHeaders },
          });
        }

        const voteId = path.split('/').pop();
        let votes = await env.jsapi.get('votes', 'json');
        if (!votes) votes = [];

        const filtered = votes.filter(v => v.id !== voteId);
        if (filtered.length === votes.length) {
          return new Response(JSON.stringify({ success: false, error: '投票不存在' }), {
            status: 404,
            headers: { 'Content-Type': 'application/json', ...corsHeaders },
          });
        }

        await env.jsapi.put('votes', JSON.stringify(filtered));
        return new Response(JSON.stringify({ success: true, message: '投票已删除' }), {
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      } catch (error) {
        return new Response(JSON.stringify({ success: false, error: error.message }), {
          status: 500,
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      }
    }

    // ============================================================
    // GET /api/img - 图片代理（解决图床 Content-Type 不正确）
    // ============================================================
    if (path === '/api/img' && request.method === 'GET') {
      try {
        const url = new URL(request.url).searchParams.get('url');
        if (!url) return new Response('missing url', { status: 400 });
        const resp = await fetch(url);
        const contentType = resp.headers.get('Content-Type') || 'image/jpeg';
        // 如果源站返回 octet-stream，强制转成图片类型
        const forcedType = contentType.includes('octet-stream') ? 'image/jpeg' : contentType;
        return new Response(resp.body, {
          headers: { 'Content-Type': forcedType, 'Cache-Control': 'public, max-age=86400' },
        });
      } catch (error) {
        return new Response('proxy error', { status: 502 });
      }
    }

    // ============================================================
    // GET /api/stories - 获取神人榜
    // ============================================================
    if (path === '/api/stories' && request.method === 'GET') {
      try {
        let stories = await env.jsapi.get('stories', 'json');
        if (!stories) stories = [];
        stories.sort((a, b) => new Date(b.date) - new Date(a.date));
        return new Response(JSON.stringify({ success: true, stories }), {
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      } catch (error) {
        return new Response(JSON.stringify({ success: false, error: error.message }), {
          status: 500,
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      }
    }

    // ============================================================
    // POST /api/stories - 添加记录（需验证）
    // ============================================================
    if (path === '/api/stories' && request.method === 'POST') {
      try {
        const authHeader = request.headers.get('Authorization');
        if (authHeader !== `Bearer ${ADMIN_KEY}`) {
          return new Response(JSON.stringify({ success: false, error: 'Unauthorized' }), {
            status: 401,
            headers: { 'Content-Type': 'application/json', ...corsHeaders },
          });
        }
        const body = await request.json();
        const { title, content: rawContent } = body;
        if (!title || !rawContent) {
          return new Response(JSON.stringify({ success: false, error: '标题和内容为必填项' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json', ...corsHeaders },
          });
        }

        // 内容处理：图片链接转 <img>，换行转 <br>
        const imgExts = ['png','jpg','jpeg','gif','webp','bmp','svg'];
        let content = rawContent.split('\n').map(line => {
          let t = line.trim();
          if (t.startsWith('http') && imgExts.some(ext => t.toLowerCase().endsWith('.' + ext) || t.toLowerCase().includes('.' + ext + '?'))) {
            if (t.includes('img.remit.ee')) t = '/api/img?url=' + encodeURIComponent(t);
            return "<img src='" + t + "'>";
          }
          return line;
        }).join('\n').replace(/\n/g, '<br>');

        let stories = await env.jsapi.get('stories', 'json');
        if (!stories) stories = [];
        const newStory = {
          id: Date.now().toString(),
          title,
          content,
          date: new Date().toISOString().split('T')[0],
        };
        stories.push(newStory);
        await env.jsapi.put('stories', JSON.stringify(stories));
        return new Response(JSON.stringify({ success: true, message: '添加成功', story: newStory }), {
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      } catch (error) {
        return new Response(JSON.stringify({ success: false, error: error.message }), {
          status: 500,
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      }
    }

    // ============================================================
    // DELETE /api/stories/:id - 删除记录（需验证）
    // ============================================================
    if (path.startsWith('/api/stories/') && request.method === 'DELETE') {
      try {
        const authHeader = request.headers.get('Authorization');
        if (authHeader !== `Bearer ${ADMIN_KEY}`) {
          return new Response(JSON.stringify({ success: false, error: 'Unauthorized' }), {
            status: 401,
            headers: { 'Content-Type': 'application/json', ...corsHeaders },
          });
        }
        const storyId = path.split('/').pop();
        let stories = await env.jsapi.get('stories', 'json');
        if (!stories) stories = [];
        const filtered = stories.filter(s => s.id !== storyId);
        if (filtered.length === stories.length) {
          return new Response(JSON.stringify({ success: false, error: '记录不存在' }), {
            status: 404,
            headers: { 'Content-Type': 'application/json', ...corsHeaders },
          });
        }
        await env.jsapi.put('stories', JSON.stringify(filtered));
        return new Response(JSON.stringify({ success: true, message: '已删除' }), {
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      } catch (error) {
        return new Response(JSON.stringify({ success: false, error: error.message }), {
          status: 500,
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      }
    }

    return new Response(JSON.stringify({ success: false, error: 'Not Found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  },
};
