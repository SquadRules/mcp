// squadrules-compat-surface: reads or aliases KAIROS_* environment variable names still honored for existing deployments
/** Inline boot script for {@link ./forward-widget-html.ts} (MCP Apps HTML bundle). */
import { minifyInlineWidgetScript } from './widget-inline-minify.js';
export const FORWARD_WIDGET_INLINE_SCRIPT = minifyInlineWidgetScript(`
    (function () {
      var el = document.getElementById('out'), headerTitle = document.getElementById('header-title');
      var runFooter = document.getElementById('run-footer'), stepText = document.getElementById('step-text');
      var segHost = document.getElementById('progress-segments'), PROTO = '2026-01-26';
      var nextId = 1, pending = {}, hostCtxState = {}, PRESENTATION_ONLY = __KAIROS_WIDGET_PRESENTATION_ONLY__;

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
          if (ctx.theme === 'dark') {
            document.documentElement.classList.add('dark');
          } else {
            document.documentElement.classList.remove('dark');
          }
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
        return '<span class="ht-brand">SQUADRULES</span><span class="ht-sep"> • </span><span class="ht-protocol-label">Protocol:</span>';
      }

      function headerHtmlWithProtocol(name) {
        var safe = escapeHtml(name || 'Forward run');
        return headerHtmlIdle() + ' <span class="ht-protocol-name">' + safe + '</span>';
      }

      function resetChrome() {
        if (headerTitle) headerTitle.innerHTML = headerHtmlIdle();
        if (runFooter) runFooter.hidden = true;
        document.title = 'Forward — SQUADRULES';
      }

      function isErrorLike(obj) {
        if (obj == null) return false;
        if (typeof obj === 'string') return true;
        if (typeof obj !== 'object') return false;
        if (obj.isError === true) return true;
        if (typeof obj.error === 'string' && obj.error.length > 0) return true;
        if (obj.error_code != null && String(obj.error_code).length > 0) return true;
        return false;
      }

      function shortHumanErrorMessage(obj) {
        if (obj == null) return 'Something went wrong.';
        if (typeof obj === 'string') {
          var ts = obj.trim();
          if (!ts) return 'Something went wrong.';
          return ts.length > 90 ? ts.slice(0, 87) + '…' : ts;
        }
        if (typeof obj !== 'object') return 'Something went wrong.';
        if (typeof obj.error === 'string' && obj.error.length) {
          if (obj.error === 'INVALID_TOOL_INPUT') return 'Invalid tool input.';
          if (obj.error === 'WIDGET_BOOT') return 'Panel could not start.';
          return 'Something went wrong.';
        }
        if (obj.isError === true) {
          var m = typeof obj.message === 'string' ? obj.message.trim() : '';
          if (m) {
            if (m.indexOf('Input validation error:') === 0) return 'Invalid tool input.';
            var dot = m.indexOf('. ');
            if (dot > 0 && dot < 120) return m.slice(0, dot + 1);
            return m.length > 90 ? m.slice(0, 87) + '…' : m;
          }
          return 'Something went wrong.';
        }
        if (typeof obj.message === 'string' && obj.message.trim()) {
          var m2 = obj.message.trim();
          if (m2.indexOf('Input validation error:') === 0) return 'Invalid tool input.';
          return m2.length > 90 ? m2.slice(0, 87) + '…' : m2;
        }
        return 'Something went wrong.';
      }

      function suggestNextStep(obj) {
        if (obj == null || typeof obj !== 'object') {
          return 'Read the last tool response for next_action, or run activate again with a short description of your goal.';
        }
        var err = obj.error;
        var tool = obj.tool;
        if (err === 'INVALID_TOOL_INPUT' && tool === 'forward') {
          return 'Match solution to contract.type. Omit solution on the start call (adapter URI or layer without execution_id); continuation calls with ?execution_id= must include solution.';
        }
        if (err === 'INVALID_TOOL_INPUT' && tool === 'activate') {
          return 'Check query and optional space against the activate schema.';
        }
        if (err === 'INVALID_TOOL_INPUT' && (tool === 'train' || tool === 'tune')) {
          return 'Check adapter body, space name, and required fields against the schema.';
        }
        if (err === 'INVALID_TOOL_INPUT' && tool === 'reward') {
          return 'Use the layer URI from forward, outcome, and any required fields.';
        }
        if (obj.isError === true) {
          return 'Retry the last step; expand Technical details if you need the raw payload.';
        }
        if (typeof obj.next_action === 'string' && obj.next_action.trim()) {
          return 'Follow next_action from this response when you retry.';
        }
        return 'Read the last successful tool result for next_action, or run activate with a clear description of what you want to do.';
      }

      function agentInstructionText(obj) {
        if (obj == null || typeof obj !== 'object') {
          return suggestNextStep(obj);
        }
        var na = typeof obj.next_action === 'string' ? obj.next_action.trim() : '';
        if (na) return na;
        return suggestNextStep(obj);
      }

      function errorStepLabel(obj) {
        if (obj && typeof obj === 'object') {
          var label = obj.current_layer_label != null && String(obj.current_layer_label).trim()
            ? String(obj.current_layer_label).trim() : '';
          if (label) return label;
          if (obj.error === 'INVALID_TOOL_INPUT') return 'Fix tool input and retry';
          if (obj.error === 'WIDGET_BOOT') return 'Restart the widget';
          if (obj.error_code != null && String(obj.error_code).trim()) {
            return String(obj.error_code).trim().replace(/_/g, ' ');
          }
        }
        return 'Review this forward error and retry';
      }

      function normalizeForwardErrorState(obj) {
        var idx = 1;
        var cnt = 1;
        var adapter = 'Forward run';
        if (obj && typeof obj === 'object') {
          if (obj.context_adapter_name != null && String(obj.context_adapter_name).trim()) {
            adapter = String(obj.context_adapter_name).trim();
          }
          if (typeof obj.adapter_layer_index === 'number' && obj.adapter_layer_index > 0) {
            idx = Math.floor(obj.adapter_layer_index);
          }
          if (typeof obj.adapter_layer_count === 'number' && obj.adapter_layer_count > 0) {
            cnt = Math.floor(obj.adapter_layer_count);
          } else {
            cnt = idx;
          }
        }
        return {
          context_adapter_name: adapter,
          current_layer_label: errorStepLabel(obj),
          adapter_layer_index: idx,
          adapter_layer_count: cnt,
          error_code: obj && typeof obj === 'object' && obj.error_code != null
            ? String(obj.error_code)
            : (obj && typeof obj === 'object' && typeof obj.error === 'string' ? obj.error : 'FORWARD_ERROR'),
          retry_count: obj && typeof obj === 'object' && typeof obj.retry_count === 'number'
            ? obj.retry_count
            : 1,
          next_action: agentInstructionText(obj),
        };
      }

      function showRawJson(obj) {
        resetChrome();
        if (el) {
          el.classList.remove('step-panel');
          el.classList.remove('step-panel-error');
        }
        var pre = document.createElement('pre');
        pre.className = 'raw';
        try { pre.textContent = JSON.stringify(obj, null, 2); } catch (e) { pre.textContent = String(obj); }
        el.replaceChildren(pre);
        notifySize();
      }

      function renderForwardError(sc, rawObj) {
        var adapterRaw = sc.context_adapter_name != null && String(sc.context_adapter_name).trim()
          ? String(sc.context_adapter_name).trim() : '';
        if (headerTitle) {
          headerTitle.innerHTML = headerHtmlWithProtocol(adapterRaw || 'Forward run');
        }
        document.title = (adapterRaw || 'Forward') + ' — SQUADRULES';
        if (el) {
          el.classList.add('step-panel');
          el.classList.add('step-panel-error');
        }
        var wrap = document.createElement('div');
        wrap.className = 'widget-error';
        wrap.setAttribute('role', 'alert');
        wrap.innerHTML = formatStepTitle(sc, false, true);
        var msgEl = document.createElement('p');
        msgEl.className = 'widget-error-msg';
        msgEl.textContent = shortHumanErrorMessage(rawObj);
        wrap.appendChild(msgEl);
        var nextEl = document.createElement('p');
        nextEl.className = 'widget-error-next';
        var nextLbl = document.createElement('span');
        nextLbl.className = 'widget-error-next-label';
        nextLbl.textContent = 'Your AI agent was asked to: ';
        nextEl.appendChild(nextLbl);
        nextEl.appendChild(document.createTextNode(agentInstructionText(rawObj)));
        wrap.appendChild(nextEl);
        var det = document.createElement('details');
        det.className = 'widget-error-details';
        var sum = document.createElement('summary');
        sum.textContent = 'Technical details';
        det.appendChild(sum);
        var pre = document.createElement('pre');
        pre.className = 'raw widget-error-raw';
        try {
          pre.textContent = typeof rawObj === 'string' ? rawObj : JSON.stringify(rawObj, null, 2);
        } catch (e) {
          pre.textContent = String(rawObj);
        }
        det.appendChild(pre);
        wrap.appendChild(det);
        el.replaceChildren(wrap);
        renderProgress(sc.adapter_layer_index, sc.adapter_layer_count, true, false);
        notifySize();
      }

      function renderHumanError(obj) {
        resetChrome();
        renderForwardError(normalizeForwardErrorState(obj), obj);
      }

      function showJson(obj) {
        if (isErrorLike(obj)) {
          renderHumanError(obj);
          return;
        }
        showRawJson(obj);
      }

      function isForwardStructured(sc) {
        return sc && typeof sc === 'object' && typeof sc.must_obey === 'boolean' &&
          sc.contract && typeof sc.contract === 'object' && typeof sc.contract.type === 'string' &&
          typeof sc.next_action === 'string';
      }

      function isRewardNext(sc) {
        var na = typeof sc.next_action === 'string' ? sc.next_action.trim() : '';
        return /call\\s+reward\\b/i.test(na);
      }

      function formatStepTitle(sc, rewardReady, hasIssue) {
        if (rewardReady) {
          return '<p class="step-running step-reward-ready"><span class="step-running-label">Status:</span> ' +
            '<span class="step-running-name">All steps complete</span></p>';
        }
        var runPrefix = hasIssue ? 'Retrying step:' : 'Running step:';
        var pCls = 'step-running' + (hasIssue ? ' step-retrying' : '');
        var label = sc.current_layer_label != null && String(sc.current_layer_label).trim()
          ? String(sc.current_layer_label).trim() : '';
        if (!label) {
          return '<p class="' + pCls + '"><span class="step-running-label">' + runPrefix + '</span> <span class="muted">No title in this response</span></p>';
        }
        return '<p class="' + pCls + '"><span class="step-running-label">' + runPrefix + '</span> <span class="step-running-name">' +
          escapeHtml(label) + '</span></p>';
      }

      function renderProgress(idx, cnt, hasIssue, rewardReady) {
        if (!segHost || !stepText || !runFooter) return;
        var i;
        var n = typeof cnt === 'number' && cnt > 0 ? Math.floor(cnt) : 0;
        var cur = typeof idx === 'number' && idx > 0 ? Math.floor(idx) : 1;
        if (n < 1) {
          runFooter.hidden = true;
          stepText.classList.remove('footer-step-done');
          return;
        }
        if (cur < 1) cur = 1;
        if (cur > n) cur = n;
        runFooter.hidden = false;
        runFooter.classList.toggle('run-has-issue', !!hasIssue);
        if (rewardReady && !hasIssue) {
          stepText.textContent = 'Done';
          stepText.classList.add('footer-step-done');
          segHost.replaceChildren();
          for (i = 1; i <= n; i++) {
            var sdone = document.createElement('span');
            sdone.className = 'seg seg-done';
            segHost.appendChild(sdone);
          }
          return;
        }
        stepText.classList.remove('footer-step-done');
        stepText.textContent = 'Step ' + cur + ' of ' + n;
        segHost.replaceChildren();
        for (i = 1; i <= n; i++) {
          var seg = document.createElement('span');
          seg.className = 'seg';
          if (i < cur) seg.classList.add('seg-done');
          else if (i === cur) {
            seg.classList.add('seg-current');
            if (hasIssue) seg.classList.add('seg-issue');
          } else seg.classList.add('seg-pending');
          segHost.appendChild(seg);
        }
      }

      function renderForward(sc) {
        var adapterRaw = sc.context_adapter_name != null && String(sc.context_adapter_name).trim()
          ? String(sc.context_adapter_name).trim() : '';
        if (headerTitle) {
          headerTitle.innerHTML = headerHtmlWithProtocol(adapterRaw || 'Forward run');
        }
        document.title = (adapterRaw || 'Forward') + ' — SQUADRULES';

        if (el) {
          el.classList.add('step-panel');
          el.classList.remove('step-panel-error');
        }
        var hasIssue = !!(sc.error_code || (typeof sc.retry_count === 'number' && sc.retry_count > 0));
        if (hasIssue) {
          renderForwardError(sc, sc);
          return;
        }
        var rewardReady = isRewardNext(sc) && !hasIssue;
        el.innerHTML = formatStepTitle(sc, rewardReady, hasIssue);
        renderProgress(sc.adapter_layer_index, sc.adapter_layer_count, hasIssue, rewardReady);
        notifySize();
      }

      function applyToolResult(p) {
        if (PRESENTATION_ONLY) return;
        if (!p) return;
        if (p.isError) {
          var parsedError = p.structuredContent && typeof p.structuredContent === 'object' ? p.structuredContent : null;
          if (!parsedError && p.content && p.content[0] && typeof p.content[0].text === 'string') { try { parsedError = JSON.parse(p.content[0].text); } catch (e) {} }
          showJson(parsedError && typeof parsedError === 'object' ? parsedError : { isError: true, content: p.content, message: p.message });
          return;
        }
        if (p.structuredContent != null && isForwardStructured(p.structuredContent)) {
          renderForward(p.structuredContent);
          return;
        }
        if (p.structuredContent != null) {
          showJson(p.structuredContent);
          return;
        }
        if (p.content && p.content[0] && p.content[0].text) {
          try {
            var parsed = JSON.parse(p.content[0].text);
            if (isForwardStructured(parsed)) renderForward(parsed);
            else showJson(parsed);
          } catch (e) { showJson(p.content[0].text); }
          return;
        }
        showJson(p);
      }

      function boot() {
        if (PRESENTATION_ONLY) {
          resetChrome();
          if (el) {
            el.classList.remove('step-panel');
            el.classList.remove('step-panel-error');
          }
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
          appInfo: { name: 'squadrules-forward-view', version: '1.0.0' },
          appCapabilities: {},
          protocolVersion: PROTO
        }).then(function (result) {
          if (result && result.hostContext) {
            hostCtxState = mergeHostContextDelta({}, result.hostContext);
            paintHostContext(hostCtxState);
          }
          sendNotification('ui/notifications/initialized', {});
        }).catch(function (err) {
          resetChrome();
          if (el) {
            el.classList.remove('step-panel');
            el.classList.remove('step-panel-error');
          }
          var msg = (err && err.message) ? err.message : String(err);
          if (el) {
            renderHumanError({
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
