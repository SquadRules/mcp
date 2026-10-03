// squadrules-compat-surface: reads or aliases KAIROS_* environment variable names still honored for existing deployments
/** Inline boot script for {@link ./activate-widget-html.ts} (MCP Apps HTML bundle). */
import { minifyInlineWidgetScript } from './widget-inline-minify.js';

export const ACTIVATE_WIDGET_INLINE_SCRIPT = minifyInlineWidgetScript(`
    (function () {
      var el = document.getElementById('out'), headerTitle = document.getElementById('header-title');
      var headerTopMatch = document.getElementById('header-top-match'), PROTO = '2026-01-26';
      var nextId = 1, pending = {}, hostCtxState = {};
      var ACTIVATE_VISIBLE_CHOICES = 3, BATCH = 10, PRESENTATION_ONLY = __KAIROS_WIDGET_PRESENTATION_ONLY__;

      window.addEventListener('message', function (ev) {
        var d = ev.data;
        if (!d || d.jsonrpc !== '2.0') return;
        if (d.id != null && Object.prototype.hasOwnProperty.call(pending, d.id)) {
          var h = pending[d.id];
          delete pending[d.id];
          if (d.error) h.reject(d.error);
          else h.resolve(d.result);
          return;
        }
        var m = d.method;
        if (m === 'ui/notifications/host-context-changed' && d.params) {
          hostCtxState = mergeHostContextDelta(hostCtxState, d.params);
          paintHostContext(hostCtxState);
          return;
        }
        if (m === 'ui/notifications/tool-result' && d.params) {
          applyToolResult(d.params);
          return;
        }
        if (m === 'notifications/tool-result' && d.params) {
          applyToolResult(d.params);
          return;
        }
      });

      function mergeHostContextDelta(prev, delta) {
        var base = {};
        var pk;
        for (pk in prev) {
          if (Object.prototype.hasOwnProperty.call(prev, pk)) base[pk] = prev[pk];
        }
        if (!delta || typeof delta !== 'object') return base;
        var k;
        for (k in delta) {
          if (!Object.prototype.hasOwnProperty.call(delta, k)) continue;
          var v = delta[k];
          if (k === 'styles' && v && typeof v === 'object') {
            base.styles = base.styles || {};
            if (v.variables && typeof v.variables === 'object') {
              base.styles.variables = base.styles.variables || {};
              var vk;
              for (vk in v.variables) {
                if (Object.prototype.hasOwnProperty.call(v.variables, vk)) {
                  base.styles.variables[vk] = v.variables[vk];
                }
              }
            }
            if (v.css && typeof v.css === 'object') {
              base.styles.css = base.styles.css || {};
              var ck;
              for (ck in v.css) {
                if (Object.prototype.hasOwnProperty.call(v.css, ck)) base.styles.css[ck] = v.css[ck];
              }
            }
          } else if (v !== undefined) {
            base[k] = v;
          }
        }
        return base;
      }

      function paintHostContext(ctx) {
        if (!ctx || typeof ctx !== 'object') return;
        if (ctx.theme === 'light' || ctx.theme === 'dark') {
          document.documentElement.setAttribute('data-theme', ctx.theme);
          document.documentElement.style.colorScheme = ctx.theme;
          if (ctx.theme === 'dark') document.documentElement.classList.add('dark');
          else document.documentElement.classList.remove('dark');
        }
        var st = ctx.styles;
        if (st && st.variables && typeof st.variables === 'object') {
          var root = document.documentElement;
          var name;
          for (name in st.variables) {
            if (!Object.prototype.hasOwnProperty.call(st.variables, name)) continue;
            var val = st.variables[name];
            if (val != null && val !== '') root.style.setProperty(name, String(val));
          }
        }
        if (st && st.css && st.css.fonts && typeof st.css.fonts === 'string' && st.css.fonts.trim()) {
          var fid = 'kairos-host-fonts';
          var styleEl = document.getElementById(fid);
          if (!styleEl) {
            styleEl = document.createElement('style');
            styleEl.id = fid;
            document.head.appendChild(styleEl);
          }
          styleEl.textContent = st.css.fonts;
        }
      }

      function post(msg) {
        try { window.parent.postMessage(msg, '*'); } catch (e) {}
      }

      function sendRequest(method, params, timeoutMs) {
        timeoutMs = timeoutMs || 10000;
        return new Promise(function (resolve, reject) {
          var id = nextId++;
          var t = setTimeout(function () {
            delete pending[id];
            reject(new Error('Request timeout: ' + method));
          }, timeoutMs);
          pending[id] = {
            resolve: function (r) { clearTimeout(t); resolve(r); },
            reject: function (err) { clearTimeout(t); reject(err); }
          };
          post({ jsonrpc: '2.0', id: id, method: method, params: params });
        });
      }

      function sendNotification(method, params) {
        post({ jsonrpc: '2.0', method: method, params: params || {} });
      }

      function notifySize() {
        requestAnimationFrame(function () {
          var h = document.documentElement.scrollHeight;
          sendNotification('ui/notifications/size-changed', { height: h });
        });
      }

      function escapeHtml(s) {
        return String(s)
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;');
      }

      function headerHtmlIdle() {
        return '<span class="ht-brand">SQUADRULES</span><span class="ht-sep"> • </span><span class="ht-protocol-label">Activate • </span><span class="ht-protocol-name muted">…</span>';
      }

      function headerHtmlWithQuery(q) {
        var safe = escapeHtml(q && String(q).trim() ? String(q).trim() : '—');
        return (
          '<span class="ht-brand">SQUADRULES</span><span class="ht-sep"> • </span><span class="ht-protocol-label">Activate • </span><span class="ht-protocol-label">query: </span><span class="ht-protocol-name">' +
          safe +
          '</span>'
        );
      }

      function clearTopMatch() {
        if (!headerTopMatch) return;
        headerTopMatch.hidden = true;
        headerTopMatch.removeAttribute('data-tier');
        headerTopMatch.removeAttribute('aria-label');
        headerTopMatch.innerHTML = '';
      }

      function paintTopMatch(list) {
        if (!headerTopMatch) return;
        var bestScore = -1;
        var i;
        for (i = 0; i < list.length; i++) {
          var ch = list[i];
          if (!ch || normRole(ch.role) !== 'match') continue;
          var s = ch.activation_score;
          if (s == null || typeof s !== 'number' || isNaN(s)) continue;
          if (s > bestScore) bestScore = s;
        }
        if (bestScore < 0) {
          clearTopMatch();
          return;
        }
        var pct = Math.round(bestScore * 1000) / 10;
        var tier = tierFromScore(bestScore);
        headerTopMatch.hidden = false;
        headerTopMatch.setAttribute('data-tier', tier);
        headerTopMatch.setAttribute('aria-label', 'Top match ' + pct + ' percent');
        headerTopMatch.innerHTML =
          '<div class="header-top-match-inner">' +
          '<span class="top-match-label">Top match</span>' +
          '<span class="top-match-pct">' +
          pct +
          '%</span></div>';
      }

      function stringifyJson(obj) {
        try { return JSON.stringify(obj, null, 2); } catch (e) { return String(obj); }
      }

      function summaryLineFromPayload(obj) {
        if (obj == null) return '';
        if (typeof obj === 'string') {
          var ts = obj.trim();
          if (!ts) return '';
          return ts.length > 90 ? ts.slice(0, 87) + '…' : ts;
        }
        if (typeof obj !== 'object') return '';
        if (typeof obj.message === 'string' && obj.message.trim()) {
          var msg = obj.message.trim();
          if (msg.indexOf('Input validation error:') === 0) return 'Invalid tool input.';
          return msg.length > 90 ? msg.slice(0, 87) + '…' : msg;
        }
        if (typeof obj.error === 'string' && obj.error.length) {
          if (obj.error === 'INVALID_TOOL_INPUT') return 'Invalid tool input.';
          if (obj.error === 'WIDGET_BOOT') return 'Panel could not start.';
          return 'Something went wrong.';
        }
        if (obj.isError === true || obj.error_code != null) return 'Something went wrong.';
        return '';
      }

      function showRawJson(obj) {
        clearTopMatch();
        if (headerTitle) headerTitle.innerHTML = headerHtmlIdle();
        document.title = 'Activate — SQUADRULES';
        if (el) {
          var pre = document.createElement('pre');
          pre.className = 'raw';
          pre.textContent = stringifyJson(obj);
          el.replaceChildren(pre);
        }
        notifySize();
      }

      function showJson(obj) {
        var summary = summaryLineFromPayload(obj);
        if (!summary) {
          showRawJson(obj);
          return;
        }
        clearTopMatch();
        if (headerTitle) headerTitle.innerHTML = headerHtmlIdle();
        document.title = 'Activate — SQUADRULES';
        if (!el) return;
        var wrap = document.createElement('div');
        var msgEl = document.createElement('p');
        msgEl.className = 'sub activate-json-summary';
        msgEl.textContent = summary;
        wrap.appendChild(msgEl);
        var det = document.createElement('details');
        det.className = 'activate-json-details';
        var sum = document.createElement('summary');
        sum.textContent = 'Technical details';
        det.appendChild(sum);
        var pre = document.createElement('pre');
        pre.className = 'raw activate-json-raw';
        pre.textContent = stringifyJson(obj);
        det.appendChild(pre);
        wrap.appendChild(det);
        el.replaceChildren(wrap);
        det.addEventListener('toggle', notifySize);
        notifySize();
      }

      function isActivateStructured(sc) {
        return sc && typeof sc === 'object' && typeof sc.must_obey === 'boolean' &&
          Array.isArray(sc.choices) && typeof sc.next_action === 'string' && typeof sc.message === 'string';
      }

      function normRole(r) {
        var s = r && String(r);
        if (s === 'match' || s === 'refine' || s === 'create') return s;
        return 'match';
      }

      function tierFromScore(score) {
        if (score == null || typeof score !== 'number' || isNaN(score)) return null;
        return score >= 0.8 ? '4' : score >= 0.65 ? '3' : score >= 0.5 ? '2' : '1';
      }

      function buildChoiceEl(ch, index) {
        var li = document.createElement('li');
        li.className = 'choice';
        var role = normRole(ch && ch.role);
        var label = ch && ch.label != null ? String(ch.label) : 'Choice ' + (index + 1);
        var adapterName = ch && ch.adapter_name != null && String(ch.adapter_name).trim()
          ? String(ch.adapter_name).trim() : '';
        var space = ch && ch.space_name != null && String(ch.space_name).trim()
          ? String(ch.space_name).trim() : '';
        var slug = ch && ch.slug != null && String(ch.slug).trim()
          ? String(ch.slug).trim() : '';
        var score = ch && ch.activation_score;
        var row = document.createElement('div');
        row.className = 'choice-row choice-row-top';
        var pill = document.createElement('span');
        pill.className = 'pill';
        pill.setAttribute('data-role', role);
        if (role === 'match' && score != null && typeof score === 'number' && !isNaN(score)) {
          var tier = tierFromScore(score);
          if (tier) pill.setAttribute('data-tier', tier);
          var pct = Math.round(score * 1000) / 10;
          var roleSpan = document.createElement('span');
          roleSpan.className = 'pill-role';
          roleSpan.textContent = role + ' ';
          var pctSpan = document.createElement('span');
          pctSpan.className = 'pill-pct';
          pctSpan.textContent = pct + '%';
          pill.appendChild(roleSpan);
          pill.appendChild(pctSpan);
        } else {
          pill.textContent = role;
        }
        row.appendChild(pill);
        if (space) {
          var spEl = document.createElement('span');
          spEl.className = 'choice-space';
          spEl.textContent = 'Space: ' + space;
          row.appendChild(spEl);
        }
        li.appendChild(row);
        var titleRow = document.createElement('div');
        titleRow.className = 'choice-title-row';
        var title = document.createElement('span');
        title.className = 'choice-title';
        title.textContent = label;
        titleRow.appendChild(title);
        li.appendChild(titleRow);
        if (adapterName && adapterName !== label) {
          var mp = document.createElement('p');
          mp.className = 'sub';
          mp.textContent = adapterName;
          li.appendChild(mp);
        }
        if (slug) {
          var sp = document.createElement('p');
          sp.className = 'sub choice-slug';
          sp.textContent = 'Slug: ' + slug;
          li.appendChild(sp);
        }
        return li;
      }

      function appendChoicesBatched(slice, listEl, indexOffset, onDone) {
        var i = 0;
        function pump() {
          var end = Math.min(i + BATCH, slice.length);
          for (; i < end; i++) listEl.appendChild(buildChoiceEl(slice[i], indexOffset + i));
          if (i < slice.length) requestAnimationFrame(pump);
          else onDone();
        }
        if (!slice.length) onDone();
        else requestAnimationFrame(pump);
      }

      function renderActivate(sc) {
        var all = Array.isArray(sc.choices) ? sc.choices : [];
        var visN = ACTIVATE_VISIBLE_CHOICES;
        var vis = all.slice(0, visN);
        var rest = all.slice(visN);
        if (headerTitle) headerTitle.innerHTML = headerHtmlWithQuery(sc.query != null ? sc.query : '');
        paintTopMatch(all);
        var qt = sc.query != null && String(sc.query).trim() ? String(sc.query).trim() : 'Activate';
        document.title = qt.length > 48 ? qt.slice(0, 45) + '… — SQUADRULES' : qt + ' — SQUADRULES';
        if (!el) return;
        el.replaceChildren();
        var ul = document.createElement('ul');
        ul.className = 'choices-list';
        ul.setAttribute('role', 'list');
        el.appendChild(ul);
        appendChoicesBatched(vis, ul, 0, function () {
          if (!rest.length) {
            notifySize();
            return;
          }
          var det = document.createElement('details');
          det.className = 'activate-more-choices';
          var sum = document.createElement('summary');
          sum.textContent = 'More choices (' + rest.length + ')';
          det.appendChild(sum);
          var innerUl = document.createElement('ul');
          innerUl.className = 'choices-list choices-list-more';
          innerUl.setAttribute('role', 'list');
          det.appendChild(innerUl);
          el.appendChild(det);
          det.addEventListener('toggle', notifySize);
          appendChoicesBatched(rest, innerUl, visN, notifySize);
        });
      }

      function applyToolResult(p) {
        if (PRESENTATION_ONLY) return;
        if (!p) return;
        if (p.isError) {
          showJson({ isError: true, content: p.content, message: p.message });
          return;
        }
        if (p.structuredContent != null && isActivateStructured(p.structuredContent)) {
          renderActivate(p.structuredContent);
          return;
        }
        if (p.structuredContent != null) {
          showJson(p.structuredContent);
          return;
        }
        if (p.content && p.content[0] && p.content[0].text) {
          try {
            var parsed = JSON.parse(p.content[0].text);
            if (isActivateStructured(parsed)) renderActivate(parsed);
            else showJson(parsed);
          } catch (e) { showJson(p.content[0].text); }
          return;
        }
        showJson(p);
      }

      function boot() {
        if (PRESENTATION_ONLY) {
          clearTopMatch();
          if (headerTitle) headerTitle.innerHTML = headerHtmlIdle();
          if (el) {
            el.replaceChildren();
            var ph = document.createElement('span');
            ph.className = 'waiting';
            ph.textContent =
              'Presentation-only: MCP bridge disabled (set KAIROS_MCP_WIDGET_PRESENTATION_ONLY=false for live data).';
            el.appendChild(ph);
          }
          return;
        }
        sendRequest('ui/initialize', {
          appInfo: { name: 'squadrules-activate-view', version: '1.0.0' },
          appCapabilities: {},
          protocolVersion: PROTO
        }).then(function (result) {
          if (result && result.hostContext) {
            hostCtxState = mergeHostContextDelta({}, result.hostContext);
            paintHostContext(hostCtxState);
          }
          sendNotification('ui/notifications/initialized', {});
        }).catch(function (err) {
          clearTopMatch();
          if (headerTitle) headerTitle.innerHTML = headerHtmlIdle();
          if (el) {
            var msg = (err && err.message) ? err.message : String(err);
            showJson({
              isError: true,
              message: 'This panel could not finish starting (' + msg + '). The same data may still appear as normal text in the chat.',
              error: 'WIDGET_BOOT',
              detail: String(err)
            });
          }
        });
      }

      boot();
    })();
`);
