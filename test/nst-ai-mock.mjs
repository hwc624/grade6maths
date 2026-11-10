// Mocked Chrome Prompt API (LanguageModel) plus static NS&T checks.
// Serves this repo and drives headless Chrome over the DevTools protocol.
//   node test/nst-ai-mock.mjs
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const artifacts = '/opt/cursor/artifacts';
const port = 8765;
let failures = 0;

function assert(cond, msg) {
    if (!cond) {
        failures += 1;
        console.error('FAIL:', msg);
    } else {
        console.log('ok:', msg);
    }
}

function serve() {
    const server = http.createServer((req, res) => {
        const url = decodeURIComponent(req.url.split('?')[0]);
        const rel = url === '/' ? '/index.html' : url;
        const file = path.normalize(path.join(root, rel));
        if (!file.startsWith(root)) { res.writeHead(403); return res.end(); }
        fs.readFile(file, (err, data) => {
            if (err) { res.writeHead(404); return res.end('not found'); }
            const ext = path.extname(file);
            const type = ext === '.json' ? 'application/json' : ext === '.html' ? 'text/html' : 'text/plain';
            res.writeHead(200, { 'Content-Type': type + '; charset=utf-8', 'Cache-Control': 'no-store' });
            res.end(data);
        });
    });
    return new Promise(resolve => server.listen(port, '127.0.0.1', () => resolve(server)));
}

class CDP {
    constructor(ws) {
        this.ws = ws;
        this.id = 0;
        this.pending = new Map();
        this.ws.addEventListener('message', (ev) => {
            const msg = JSON.parse(ev.data);
            if (msg.id && this.pending.has(msg.id)) {
                const { resolve, reject } = this.pending.get(msg.id);
                this.pending.delete(msg.id);
                if (msg.error) reject(new Error(JSON.stringify(msg.error)));
                else resolve(msg.result || {});
            }
        });
    }
    send(method, params = {}, sessionId) {
        const id = ++this.id;
        const payload = { id, method, params };
        if (sessionId) payload.sessionId = sessionId;
        this.ws.send(JSON.stringify(payload));
        return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
    }
}

async function connectChrome() {
    const dir = fs.mkdtempSync('/tmp/nst-chrome-');
    const chrome = spawn('google-chrome', [
        '--headless=new', '--disable-gpu', '--no-sandbox', '--disable-dev-shm-usage',
        `--remote-debugging-port=9333`, `--user-data-dir=${dir}`, 'about:blank'
    ], { stdio: 'ignore' });
    let version;
    for (let i = 0; i < 50; i++) {
        try {
            const res = await fetch('http://127.0.0.1:9333/json/version');
            version = await res.json();
            break;
        } catch (e) { await new Promise(r => setTimeout(r, 200)); }
    }
    if (!version) throw new Error('Chrome did not open a DevTools port');
    const ws = new WebSocket(version.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { ws.addEventListener('open', resolve); ws.addEventListener('error', reject); });
    return { chrome, dir, cdp: new CDP(ws), ws };
}

async function evalPage(cdp, sessionId, expression) {
    const result = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId);
    if (result.exceptionDetails) {
        const d = result.exceptionDetails;
        throw new Error((d.exception && d.exception.description) || d.text || 'evaluate failed');
    }
    return result.result ? result.result.value : undefined;
}

async function waitFor(cdp, sessionId, expression, ms = 8000) {
    const start = Date.now();
    let last;
    while (Date.now() - start < ms) {
        last = await evalPage(cdp, sessionId, `(() => { try { return !!(${expression}); } catch (e) { return false; } })()`);
        if (last) return;
        await new Promise(r => setTimeout(r, 40));
    }
    throw new Error('timeout waiting for ' + expression);
}

async function openPage(cdp, mock, width, height, mobile) {
    const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
    await cdp.send('Page.enable', {}, sessionId);
    await cdp.send('Runtime.enable', {}, sessionId);
    if (mock) await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: mock }, sessionId);
    await cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: !!mobile }, sessionId);
    await cdp.send('Page.navigate', { url: `http://127.0.0.1:${port}/index.html` }, sessionId);
    await waitFor(cdp, sessionId, `document.readyState === 'complete' && window.NST`);
    return { sessionId, targetId };
}

async function shot(cdp, sessionId, name) {
    fs.mkdirSync(artifacts, { recursive: true });
    const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' }, sessionId);
    const file = path.join(artifacts, name + '.png');
    fs.writeFileSync(file, Buffer.from(data, 'base64'));
    console.log('shot', file);
}

const logicScript = `
(async () => {
  const data = await (await fetch('nst-lessons.json')).json();
  const v = NST.validate(data);
  if (!v.ok) return { ok: false, errors: v.errors };
  const kw = data.units.every(u => u.confusions.every(c => Array.isArray(c.keywords) && c.keywords.length >= 7 && c.keywords.length <= 10));
  const unit = id => data.units.find(u => u.id === id);
  const idOf = (u, text) => { const h = NST.matchConfusion(u, text); return h ? h.id : null; };
  const cases = [
    ['unit-01-circuits', 'BATTERY and a cell are confusing', 'u1-c1'],
    ['unit-01-circuits', 'open switch 的時候燈不亮', 'u1-c2'],
    ['unit-01-circuits', '串聯和並聯差在哪', 'u1-c3'],
    ['unit-07-earth-movement', 'I mix up rotation and revolution', 'u7-c1'],
    ['unit-06-sun-solar-system', 'why is PLUTO a dwarf planet', 'u6-c4'],
    ['unit-01-circuits', 'zzzz-not-science-qqq', null]
  ].map(([uid, text, expect]) => ({ text, expect, got: idOf(unit(uid), text) }));
  const synthetic = {
    key_terms: [{ en: 'photon', zh: '光子', kid_definition_zh: '光的小顆粒' }],
    confusions: [
      { id: 'by-keyword', label_zh: '別的', keywords: ['photon'], simpler_explanation_zh: 'x', analogy_zh: 'y', even_simpler_zh: 'z' },
      { id: 'by-label', label_zh: '這個詞好難', simpler_explanation_zh: '光子是光的小顆粒', analogy_zh: '像彈珠', even_simpler_zh: '小小的光' }
    ]
  };
  const primary = NST.matchConfusion(synthetic, 'What is a photon?');
  const noKw = { key_terms: synthetic.key_terms, confusions: [synthetic.confusions[1]] };
  const fallback = NST.matchConfusion(noKw, 'photon');
  const qid = NST.questionId({ id: 'unit-01-circuits' }, {}, 0);
  const qidKeep = NST.questionId({ id: 'unit-01-circuits' }, { id: 'u1-q1' }, 0);
  const bad = NST.validate({ units: [{ id: 'x', title_zh: 'a', title_en: 'b', explanation_steps: [{ zh: 's' }], check_questions: [], confusions: [], key_terms: [] }], ask_what_confused: ['?'] });
  return { ok: true, kw, cases, primary: primary && primary.id, fallback: fallback && fallback.id, qid, qidKeep, bad: bad.ok, answer: NST.answersEqual('B  a battery', 'B  a battery') };
})()
`;

function mockBase(status, extra) {
    return `
window.__aiLog = { availability: [], creates: [], prompts: [] };
window.LanguageModel = {
  availability(opts) {
    window.__aiLog.availability.push(JSON.parse(JSON.stringify(opts)));
    return Promise.resolve(${JSON.stringify(status)});
  },
  create(opts) {
    window.__aiLog.creates.push({
      expectedInputs: opts.expectedInputs,
      expectedOutputs: opts.expectedOutputs,
      system: opts.initialPrompts && opts.initialPrompts[0] && opts.initialPrompts[0].content
    });
    ${extra || 'return Promise.resolve({ prompt(){ return Promise.resolve("x"); }, promptStreaming(){ return { async *[Symbol.asyncIterator](){} }; } });'}
  }
};`;
}

async function click(cdp, sessionId, selector) {
    const ok = await evalPage(cdp, sessionId, `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return false; el.click(); return true; })()`);
    if (!ok) throw new Error('missing ' + selector);
}

async function main() {
    const server = await serve();
    const { chrome, cdp, ws } = await connectChrome();
    try {
        const logic = await openPage(cdp, '', 1280, 900, false);
        const result = await evalPage(cdp, logic.sessionId, logicScript);
        assert(result && result.ok, 'real nst-lessons.json validates' + (result && result.errors ? ': ' + result.errors.slice(0, 3).join(' | ') : ''));
        assert(result && result.kw, 'every confusion has 7–10 keywords');
        (result.cases || []).forEach(c => assert(c.got === c.expect, `match “${c.text}” → ${c.expect} (got ${c.got})`));
        assert(result.primary === 'by-keyword', 'keywords beat label/key-term fallback');
        assert(result.fallback === 'by-label', 'without keywords, a key term still matches');
        assert(result.qid === 'unit-01-circuits-q1', 'missing question id is generated');
        assert(result.qidKeep === 'u1-q1', 'existing question id is kept');
        assert(result.bad === true, 'minimal valid file passes');
        assert(result.answer === true, 'answer compare ignores nothing when strings match');
        const badFile = await evalPage(cdp, logic.sessionId, `NST.validate({ units: [{}], ask_what_confused: [] })`);
        assert(badFile && badFile.ok === false && badFile.errors.length > 0, 'malformed JSON is rejected with errors');

        await click(cdp, logic.sessionId, '#topicSelector .topic-btn');
        await waitFor(cdp, logic.sessionId, `document.getElementById('questionSection').style.display === 'block' && document.getElementById('questionContent').textContent.length > 8`);
        await evalPage(cdp, logic.sessionId, `document.querySelectorAll('.language-section .lang-btn')[1].click()`);
        await waitFor(cdp, logic.sessionId, `document.documentElement.lang === 'en' && document.getElementById('submitBtn').textContent.includes('Submit')`);
        await evalPage(cdp, logic.sessionId, `setSubject('nst')`);
        await waitFor(cdp, logic.sessionId, `document.querySelectorAll('.nst-unit').length === 10`);
        const hiddenMaths = await evalPage(cdp, logic.sessionId, `document.getElementById('questionSection').style.display === 'none' && getComputedStyle(document.getElementById('statsSection')).display === 'none'`);
        assert(hiddenMaths, 'maths question and scoreboard hide while NS&T is open');
        await evalPage(cdp, logic.sessionId, `setSubject('maths')`);
        await waitFor(cdp, logic.sessionId, `document.getElementById('questionSection').style.display === 'block'`);
        const restored = await evalPage(cdp, logic.sessionId, `({
          title: document.getElementById('siteTitle').textContent,
          footer: document.getElementById('siteFooter').textContent,
          score: document.getElementById('correctCount').textContent,
          q: document.getElementById('questionContent').textContent.length,
          topics: document.querySelectorAll('#topicSelector .topic-btn').length
        })`);
        assert(restored.title.includes('數學互動學習平台'), 'maths title restored');
        assert(restored.footer.includes('答錯沒關係'), 'maths footer restored');
        assert(restored.score === '0' && restored.q > 8 && restored.topics >= 15, 'maths question still on screen and stats unchanged');
        await cdp.send('Target.closeTarget', { targetId: logic.targetId });

        await aiUnavailable(cdp);
        await aiDownloading(cdp);
        await aiDownloadable(cdp);
        await aiAvailable(cdp);
        await screenshots(cdp);
    } finally {
        try { ws.close(); } catch (e) {}
        chrome.kill('SIGKILL');
        server.close();
    }
    if (failures) {
        console.error(failures + ' assertion(s) failed');
        process.exit(1);
    }
    console.log('all checks passed');
}

async function openNst(cdp, mock) {
    const page = await openPage(cdp, mock, 1280, 900, false);
    await evalPage(cdp, page.sessionId, `setSubject('nst')`);
    await waitFor(cdp, page.sessionId, `document.querySelectorAll('.nst-unit').length === 10`);
    return page;
}

async function aiUnavailable(cdp) {
    const page = await openNst(cdp, mockBase('unavailable'));
    await waitFor(cdp, page.sessionId, `window.__aiLog.availability.length >= 1`);
    assert(await evalPage(cdp, page.sessionId, `document.getElementById('nstAiBtn') === null && window.__aiLog.creates.length === 0`), 'unavailable: no button and no create()');
    const langs = await evalPage(cdp, page.sessionId, `JSON.stringify(window.__aiLog.availability[0])`);
    assert(langs.includes('"en"') && !langs.includes('"zh"'), 'availability() asked for English only');
    await click(cdp, page.sessionId, '.nst-unit');
    await click(cdp, page.sessionId, '#nstDont');
    await waitFor(cdp, page.sessionId, `document.querySelectorAll('.nst-conf').length >= 5`);
    assert(await evalPage(cdp, page.sessionId, `document.getElementById('nstConfused').textContent.includes('我自己寫')`), 'static confusion list still works when AI is unavailable');
    await cdp.send('Target.closeTarget', { targetId: page.targetId });
}

async function aiDownloading(cdp) {
    const page = await openNst(cdp, mockBase('downloading'));
    await waitFor(cdp, page.sessionId, `document.getElementById('nstAiBtn')`);
    const label = await evalPage(cdp, page.sessionId, `document.getElementById('nstAiBtn').textContent`);
    assert(label.includes('啟用 AI 小老師') && label.includes('Wi-Fi'), 'downloading: enable button is shown');
    assert(await evalPage(cdp, page.sessionId, `window.__aiLog.creates.length === 0`), 'downloading: create() waits for the click');
    await cdp.send('Target.closeTarget', { targetId: page.targetId });
}

async function aiDownloadable(cdp) {
    const mock = mockBase('downloadable', `
    opts.monitor({
      addEventListener(type, fn) {
        window.__fireProgress = (n) => fn({ loaded: n });
      }
    });
    return new Promise(resolve => {
      window.__releaseCreate = () => resolve({
        prompt() { return Promise.resolve('ready'); },
        promptStreaming() { return { async *[Symbol.asyncIterator]() {} }; }
      });
    });
    `);
    const page = await openNst(cdp, mock);
    await waitFor(cdp, page.sessionId, `document.getElementById('nstAiBtn')`);
    await click(cdp, page.sessionId, '#nstAiBtn');
    await waitFor(cdp, page.sessionId, `window.__fireProgress && document.getElementById('nstProgBar')`);
    await evalPage(cdp, page.sessionId, `window.__fireProgress(0.4)`);
    const mid = await evalPage(cdp, page.sessionId, `document.getElementById('nstProgBar').style.width`);
    assert(mid === '40%', 'download progress bar follows downloadprogress (40%)');
    await evalPage(cdp, page.sessionId, `window.__fireProgress(1)`);
    const doneLabel = await evalPage(cdp, page.sessionId, `document.getElementById('nstProgLabel').textContent`);
    assert(doneLabel.includes('準備'), 'progress at 100% says the model is getting ready');
    const meta = await evalPage(cdp, page.sessionId, `window.__aiLog.creates[0]`);
    assert(meta.expectedInputs[0].languages[0] === 'en' && meta.expectedOutputs[0].languages[0] === 'en', 'create() uses the same en options as availability()');
    assert(meta.system.includes('Never write a graded homework'), 'system prompt is the editable teaching-rules constant');
    assert(await evalPage(cdp, page.sessionId, `document.querySelectorAll('.nst-unit').length === 10`), 'unit grid still works while the model downloads');
    await evalPage(cdp, page.sessionId, `window.__releaseCreate()`);
    await waitFor(cdp, page.sessionId, `document.getElementById('nstAiBtn') === null`);
    assert(true, 'after create() resolves the download button goes away');
    await cdp.send('Target.closeTarget', { targetId: page.targetId });
}

async function aiAvailable(cdp) {
    const mock = mockBase('available', `
    return Promise.resolve({
      prompt(text) { window.__aiLog.prompts.push(text); return Promise.resolve('fallback'); },
      promptStreaming(text) {
        window.__aiLog.prompts.push(text);
        const chunks = ['A closed', ' circuit', ' is a complete path.'];
        return { async *[Symbol.asyncIterator]() { for (const c of chunks) { yield c; await new Promise(r => setTimeout(r, 10)); } } };
      }
    });
    `);
    const page = await openNst(cdp, mock);
    await waitFor(cdp, page.sessionId, `window.__aiLog.availability.length >= 1`);
    assert(await evalPage(cdp, page.sessionId, `document.getElementById('nstAiBtn') === null`), 'available: no download button');
    await click(cdp, page.sessionId, '[data-id="unit-01-circuits"]');
    await click(cdp, page.sessionId, '#nstDont');
    await waitFor(cdp, page.sessionId, `document.getElementById('nstFree')`);
    await evalPage(cdp, page.sessionId, `document.getElementById('nstFree').value = 'zzzz-recipe-qqq'`);
    await click(cdp, page.sessionId, '[data-act="free"]');
    assert(await evalPage(cdp, page.sessionId, `!!document.getElementById('nstSaved') && document.getElementById('nstSaved').textContent.includes('問爸爸或老師')`), 'unmatched text shows 問爸爸或老師 without waiting for AI');
    await waitFor(cdp, page.sessionId, `document.getElementById('nstAiText') && document.getElementById('nstAiText').textContent.includes('complete path')`);
    const saved = await evalPage(cdp, page.sessionId, `JSON.parse(localStorage.getItem(NST.TODO_KEY)).some(x => x.text === 'zzzz-recipe-qqq' && x.unitId === 'unit-01-circuits')`);
    assert(saved, 'unmatched question is stored in localStorage');
    const prompt = await evalPage(cdp, page.sessionId, `window.__aiLog.prompts[0]`);
    assert(prompt.includes('KEY TERMS') && prompt.includes('Electric circuits') && prompt.includes('zzzz-recipe-qqq'), 'AI prompt is grounded on the current unit');
    assert(await evalPage(cdp, page.sessionId, `window.__aiLog.prompts.length === 1`), 'one streamed reply');
    await click(cdp, page.sessionId, '[data-id="u1-c1"]');
    await click(cdp, page.sessionId, '#nstQuiz');
    await waitFor(cdp, page.sessionId, `document.querySelector('[data-kind="confirm"]')`);
    await evalPage(cdp, page.sessionId, `document.querySelector('[data-opt="A  a cell"]').click()`);
    await waitFor(cdp, page.sessionId, `document.getElementById('nstWhy')`);
    const why = await evalPage(cdp, page.sessionId, `document.getElementById('nstWhy').textContent`);
    assert(why.includes('兩顆或更多 cell 接在一起才叫 battery'), 'confirm question is marked from JSON why_zh');
    assert(await evalPage(cdp, page.sessionId, `window.__aiLog.prompts.length === 1`), 'the confirm answer was not sent to the AI');
    await cdp.send('Target.closeTarget', { targetId: page.targetId });
}

async function screenshots(cdp) {
    const shotMock = mockBase('unavailable');
    async function flow(width, height, mobile, tag) {
        const page = await openPage(cdp, shotMock, width, height, mobile);
        await evalPage(cdp, page.sessionId, `(() => { const s = document.createElement('style'); s.textContent = '*,*::before,*::after{animation:none !important;transition:none !important;} .main-card,header{opacity:1 !important;}'; document.head.appendChild(s); })()`);
        await new Promise(r => setTimeout(r, 100));
        if (mobile) {
            await evalPage(cdp, page.sessionId, `(() => { const el = document.getElementById('subjectRow'); const y = el.getBoundingClientRect().top + window.scrollY - 16; window.scrollTo(0, Math.max(0, y)); })()`);
        }
        await shot(cdp, page.sessionId, `subject-switch-${tag}`);
        await evalPage(cdp, page.sessionId, `setSubject('nst')`);
        await waitFor(cdp, page.sessionId, `document.querySelectorAll('.nst-unit').length === 10`);
        await click(cdp, page.sessionId, '[data-id="unit-01-circuits"]');
        await waitFor(cdp, page.sessionId, `document.getElementById('nstSteps')`);
        await evalPage(cdp, page.sessionId, `document.getElementById('nstLesson').scrollIntoView({block:'start'})`);
        await new Promise(r => setTimeout(r, 250));
        const shown = await evalPage(cdp, page.sessionId, `document.getElementById('nstSteps').textContent`);
        assert(shown.includes('A closed circuit is a complete path') && shown.includes('圖示') || shown.includes('Diagram'), tag + ' explanation shows the exam sentence and diagram caption');
        await shot(cdp, page.sessionId, `nst-explanation-${tag}`);
        await click(cdp, page.sessionId, '#nstDont');
        await waitFor(cdp, page.sessionId, `document.querySelectorAll('.nst-conf').length === 6`);
        await evalPage(cdp, page.sessionId, `document.getElementById('nstConfused').scrollIntoView({block:'start'})`);
        await shot(cdp, page.sessionId, `nst-confused-${tag}`);
        await click(cdp, page.sessionId, '[data-id="u1-c1"]');
        await click(cdp, page.sessionId, '#nstQuiz');
        await waitFor(cdp, page.sessionId, `document.querySelector('[data-kind="confirm"]')`);
        await evalPage(cdp, page.sessionId, `document.querySelector('[data-opt="A  a cell"]').click()`);
        await waitFor(cdp, page.sessionId, `document.getElementById('nstNextLayer')`);
        await click(cdp, page.sessionId, '#nstNextLayer');
        await waitFor(cdp, page.sessionId, `document.getElementById('nstLayer').textContent.includes('腳踏車')`);
        await evalPage(cdp, page.sessionId, `document.getElementById('nstDetail').scrollIntoView({block:'start'})`);
        await shot(cdp, page.sessionId, `nst-layer2-${tag}`);
        await click(cdp, page.sessionId, '[data-act="dont"]');
        await waitFor(cdp, page.sessionId, `document.getElementById('nstFree')`);
        await evalPage(cdp, page.sessionId, `localStorage.removeItem(NST.TODO_KEY); document.getElementById('nstFree').value = '我昨天的餅乾食譜怎麼烤'; document.querySelector('[data-act="free"]').click();`);
        await waitFor(cdp, page.sessionId, `document.getElementById('nstSaved')`);
        await evalPage(cdp, page.sessionId, `document.getElementById('nstSaved').scrollIntoView({block:'start'})`);
        await shot(cdp, page.sessionId, `nst-unmatched-${tag}`);
        if (tag === 'desktop') {
            await evalPage(cdp, page.sessionId, `setSubject('maths'); document.querySelector('#topicSelector .topic-btn').click();`);
            await waitFor(cdp, page.sessionId, `document.getElementById('questionSection').style.display === 'block' && document.getElementById('questionContent').textContent.length > 8`);
            await shot(cdp, page.sessionId, 'maths-still-works-desktop');
        }
        await cdp.send('Target.closeTarget', { targetId: page.targetId });
    }
    await flow(1280, 1000, false, 'desktop');
    await flow(390, 844, true, 'mobile');
}

main().catch(err => { console.error(err); process.exit(1); });
