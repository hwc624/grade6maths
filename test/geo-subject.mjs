// Geography subject checks (plus Maths / NS&T regressions) in headless Chrome.
// Serves the repo with `python3 -m http.server` and drives Chrome over CDP.
//   node test/geo-subject.mjs          (screenshots go to $ARTIFACTS_DIR or /tmp/geo-shots)
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const artifacts = process.env.ARTIFACTS_DIR || '/tmp/geo-shots';
const port = 8766, dbg = 9334;
const base = `http://127.0.0.1:${port}/index.html`;
const geo = JSON.parse(fs.readFileSync(path.join(root, 'geo-lessons.json'), 'utf8'));
let failures = 0;
const assert = (c, m) => { if (c) console.log('ok:', m); else { failures++; console.error('FAIL:', m); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));

class CDP {
    constructor(ws) { this.ws = ws; this.id = 0; this.p = new Map();
        ws.addEventListener('message', ev => { const m = JSON.parse(ev.data); if (m.id && this.p.has(m.id)) { const { res, rej } = this.p.get(m.id); this.p.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result || {}); } }); }
    send(method, params = {}, sessionId) { const id = ++this.id; const pl = { id, method, params }; if (sessionId) pl.sessionId = sessionId; this.ws.send(JSON.stringify(pl)); return new Promise((res, rej) => this.p.set(id, { res, rej })); }
}
async function up(url) { for (let i = 0; i < 75; i++) { try { const r = await fetch(url); if (r.ok) return r; } catch (e) {} await sleep(200); } throw new Error('not up: ' + url); }

let cdp, S;
const ev = async (expr) => { const r = await cdp.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }, S); if (r.exceptionDetails) throw new Error((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text); return r.result && r.result.value; };
const waitFor = async (expr, ms = 8000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await ev(`(()=>{try{return !!(${expr})}catch(e){return false}})()`)) return true; await sleep(40); } throw new Error('timeout: ' + expr); };
const click = async (sel) => { if (!await ev(`(()=>{const e=document.querySelector(${JSON.stringify(sel)}); if(!e) return false; e.click(); return true})()`)) throw new Error('missing ' + sel); };
const shot = async (name, full) => {
    fs.mkdirSync(artifacts, { recursive: true });
    const opts = { format: 'png' };
    if (full) { const m = await cdp.send('Page.getLayoutMetrics', {}, S); const c = m.cssContentSize || m.contentSize; opts.captureBeyondViewport = true; opts.clip = { x: 0, y: 0, width: c.width, height: Math.min(c.height, 6000), scale: 1 }; }
    const { data } = await cdp.send('Page.captureScreenshot', opts, S);
    const f = path.join(artifacts, name + '.png'); fs.writeFileSync(f, Buffer.from(data, 'base64')); console.log('shot', f);
};
const mockAI = `window.__ai = { creates: [], prompts: [] };
window.LanguageModel = {
  availability() { return Promise.resolve('available'); },
  create(o) { window.__ai.creates.push(o.initialPrompts[0].content); return Promise.resolve({
    prompt(p) { window.__ai.prompts.push(p); return Promise.resolve('Geo reply'); },
    promptStreaming(p) { window.__ai.prompts.push(p); return { async *[Symbol.asyncIterator]() { yield 'Geo reply'; } }; } }); }
};`;

async function open(width, height, mobile, mock) {
    const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
    ({ sessionId: S } = await cdp.send('Target.attachToTarget', { targetId, flatten: true }));
    await cdp.send('Page.enable', {}, S); await cdp.send('Runtime.enable', {}, S);
    if (mock) await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: mock }, S);
    await cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: !!mobile }, S);
    await cdp.send('Page.navigate', { url: base }, S);
    await waitFor(`document.readyState === 'complete' && window.NST`);
    await ev(`localStorage.clear()`);
    return targetId;
}

async function logic() {
    const t = await open(1280, 900, false);
    const v = await ev(`fetch('geo-lessons.json').then(r => r.json()).then(d => NST.validate(d, 'geo-lessons.json'))`);
    assert(v.ok, 'geo-lessons.json passes the same validator as nst-lessons.json' + (v.ok ? '' : ': ' + v.errors.slice(0, 5).join(' | ')));
    const nv = await ev(`fetch('nst-lessons.json').then(r => r.json()).then(d => NST.validate(d).ok)`);
    assert(nv, 'nst-lessons.json still validates');
    // Every confusion should be reachable by typing one of its own keywords.
    const unreach = await ev(`fetch('geo-lessons.json').then(r => r.json()).then(d => { const out = []; d.units.forEach(u => u.confusions.forEach(c => { const ok = (c.keywords || []).some(k => { const h = NST.matchConfusion(u, k); return h && h.id === c.id; }); if (!ok) out.push(c.id); })); return out; })`);
    assert(unreach.length === 0, 'every Geography confusion is reachable by one of its own keywords' + (unreach.length ? ': ' + unreach.join(', ') : ''));

    // Maths still works
    await click('#topicSelector .topic-btn');
    await waitFor(`document.getElementById('questionSection').style.display === 'block' && document.getElementById('questionContent').textContent.length > 8`);
    const mq = await ev(`document.getElementById('questionContent').textContent`);
    assert(mq.length > 8, 'Maths: a question renders after choosing a topic');

    // NS&T loads
    await ev(`setSubject('nst')`);
    await waitFor(`document.querySelectorAll('.nst-unit').length === 10`);
    assert(await ev(`document.getElementById('siteTitle').textContent.includes('自然科學')`), 'NS&T: 10 units and NS&T title');
    await click('.nst-unit[data-id="unit-01-circuits"]');
    await waitFor(`document.getElementById('nstLesson')`);

    // Geography loads all 16 units
    await ev(`setSubject('geo')`);
    await waitFor(`document.querySelectorAll('.nst-unit').length === ${geo.units.length}`);
    const g = await ev(`({ n: document.querySelectorAll('.nst-unit').length, title: document.getElementById('siteTitle').textContent, footer: document.getElementById('siteFooter').textContent, active: document.querySelector('.subject-btn.active').dataset.subject, stats: getComputedStyle(document.getElementById('statsSection')).display, q: document.getElementById('questionSection').style.display, src: (document.getElementById('nstSource')||{}).textContent || '', grid: document.getElementById('nstGrid').textContent })`);
    assert(g.n === 16, `Geography: all 16 units listed (got ${g.n})`);
    assert(g.title.includes('地理') && g.footer.includes('地理'), 'Geography: header/footer show Geography');
    assert(g.active === 'geo' && g.stats === 'none' && g.q === 'none', 'Geography: button active, maths stats/question hidden');
    assert(g.src.includes('課本') && !g.src.includes('/workspace'), 'Geography: meta.source_zh shown for parents without the local file path');
    const terms = [...new Set(geo.units.map(u => u.term))];
    assert(terms.every(t => g.grid.includes(t)), 'Geography: units grouped under all 4 terms');

    // Every unit opens without error, and flags/notes rules hold
    const flagsBy = {}; geo.flagged_facts.forEach(f => f.units.forEach(u => (flagsBy[u] = flagsBy[u] || []).push(f)));
    let allOpen = true, flagsOk = true, notesHidden = true, flagLeak = false;
    for (const u of geo.units) {
        await ev(`document.querySelector('[data-act="grid"]') && document.querySelector('[data-act="grid"]').click()`);
        await waitFor(`document.getElementById('nstGrid')`);
        await click(`.nst-unit[data-id="${u.id}"]`);
        await waitFor(`document.getElementById('nstLesson')`);
        const r = await ev(`(() => { const L = document.getElementById('nstLesson'); const F = document.getElementById('nstFlags'); const rest = L.cloneNode(true); const rf = rest.querySelector('#nstFlags'); if (rf) rf.remove(); return { steps: L.querySelectorAll('#nstSteps .gstep').length, check: !!document.getElementById('nstCheck'), flags: F ? F.textContent : null, open: F ? F.open : false, summary: F ? F.querySelector('summary').textContent : '', all: document.getElementById('nstRoot').textContent, rest: rest.textContent }; })()`);
        if (r.steps !== u.explanation_steps.length || !r.check) allOpen = false;
        const fs_ = flagsBy[u.id] || [];
        if (fs_.length) { if (!(r.flags && !r.open && r.summary.includes('給家長') && fs_.every(f => r.flags.includes(f.note_zh.slice(0, 20))))) flagsOk = false; if (fs_.some(f => r.rest.includes(f.note_zh.slice(0, 20)))) flagLeak = true; }
        else if (r.flags !== null) flagsOk = false;
        const notes = Array.isArray(u.notes) ? u.notes.join(' ') : String(u.notes || '');
        if (notes && notes.length > 10 && r.all.includes(notes.slice(0, 25))) notesHidden = false;
    }
    assert(allOpen, 'Geography: all 16 units open with every explanation step and a check question');
    assert(flagsOk, 'Geography: flagged_facts appear only in a collapsed 「給家長」 section, only on their units');
    assert(!flagLeak, 'Geography: flagged fact text does not appear outside 「給家長」');
    assert(notesHidden, 'Geography: unit notes are not displayed');

    // Check question grading
    const u1 = geo.units[0];
    await click('[data-act="grid"]'); await click(`.nst-unit[data-id="${u1.id}"]`); await waitFor(`document.getElementById('nstCheck')`);
    const q0 = u1.check_questions[0];
    await ev(`[...document.querySelectorAll('#nstCheck [data-kind="check"]')].find(b => b.dataset.opt === ${JSON.stringify(q0.answer)}).click()`);
    await waitFor(`document.querySelector('#nstCheck .feedback')`);
    assert(await ev(`document.querySelector('#nstCheck .feedback').classList.contains('correct')`), 'Geography check: correct answer marked correct');
    await click('[data-act="next-q"]'); await waitFor(`document.querySelector('#nstCheck [data-kind="check"]')`);
    const q1 = u1.check_questions[1]; const wrong = q1.options.find(o => o !== q1.answer);
    await ev(`[...document.querySelectorAll('#nstCheck [data-kind="check"]')].find(b => b.dataset.opt === ${JSON.stringify(wrong)}).click()`);
    await waitFor(`document.querySelector('#nstCheck .feedback')`);
    const wr = await ev(`({ bad: document.querySelector('#nstCheck .feedback').classList.contains('incorrect'), txt: document.querySelector('#nstCheck .feedback').textContent })`);
    assert(wr.bad && (!q1.why_zh || wr.txt.includes(q1.why_zh.slice(0, 15))), 'Geography check: wrong answer marked wrong with why_zh');

    // Confusion layers + confirm
    const c0 = u1.confusions[0];
    await click('#nstDont'); await waitFor(`document.querySelectorAll('.nst-conf').length === ${u1.confusions.length}`);
    assert(true, `Geography 我不懂: ${u1.confusions.length} confusions listed`);
    await click(`.nst-conf[data-id="${c0.id}"]`); await waitFor(`document.getElementById('nstLayer')`);
    const lay = async () => ev(`document.getElementById('nstLayer').textContent`);
    const l1 = await lay(); await click('#nstStill'); const l2 = await lay(); await click('#nstStill'); const l3 = await lay();
    assert(l1.includes('1 / 3') && l1.includes(c0.simpler_explanation_zh.slice(0, 15)) && l2.includes('2 / 3') && l2.includes(c0.analogy_zh.slice(0, 15)) && l3.includes('3 / 3') && l3.includes(c0.even_simpler_zh.slice(0, 15)), 'Geography confusion: three layers in order');
    assert(await ev(`!document.getElementById('nstStill')`), 'Geography confusion: no 還是不懂 after layer 3');
    await click('#nstQuiz'); await waitFor(`document.querySelector('[data-kind="confirm"]')`);
    const cq = c0.confirm_question, cwrong = cq.options.find(o => o !== cq.answer);
    await ev(`[...document.querySelectorAll('[data-kind="confirm"]')].find(b => b.dataset.opt === ${JSON.stringify(cwrong)}).click()`);
    await waitFor(`document.getElementById('nstWhy')`);
    assert(await ev(`document.getElementById('nstWhy').classList.contains('incorrect') && !!document.getElementById('nstAdult')`), 'Geography confirm: wrong answer at layer 3 → incorrect + 問爸爸或老師');
    await shot('geo-confusion-desktop');
    await click('#nstQuiz'); await waitFor(`document.querySelector('[data-kind="confirm"]')`);
    await ev(`[...document.querySelectorAll('[data-kind="confirm"]')].find(b => b.dataset.opt === ${JSON.stringify(cq.answer)}).click()`);
    await waitFor(`document.getElementById('nstWhy')`);
    assert(await ev(`document.getElementById('nstWhy').classList.contains('correct')`), 'Geography confirm: correct answer marked correct');

    // Free-text keyword match
    const target = u1.confusions[2];
    const kw = target.keywords[0];
    await click('[data-act="dont"]'); await waitFor(`document.getElementById('nstFree')`);
    const expect = await ev(`(() => { const u = NST.state('geo').data.units[0]; const h = NST.matchConfusion(u, ${JSON.stringify('我不懂 ' + kw)}); return h && h.id; })()`);
    await ev(`document.getElementById('nstFree').value = ${JSON.stringify('我不懂 ' + kw)}; document.querySelector('[data-act="free"]').click()`);
    await waitFor(`document.getElementById('nstDetail')`);
    const gotTitle = await ev(`document.querySelector('#nstDetail .question-title').textContent`);
    assert(expect === target.id && gotTitle === target.label_zh, `Geography free text “我不懂 ${kw}” → ${target.id}`);

    // Unmatched → separate to-add list
    await click('[data-act="dont"]'); await waitFor(`document.getElementById('nstFree')`);
    await ev(`document.getElementById('nstFree').value = 'zzzz 餅乾食譜 qqq'; document.querySelector('[data-act="free"]').click()`);
    await waitFor(`document.getElementById('nstSaved')`);
    const store = await ev(`({ geo: localStorage.getItem('g6geo_to_add_v1'), nst: localStorage.getItem('g6nst_to_add_v1'), todo: document.getElementById('nstTodo').textContent })`);
    assert(store.geo && store.geo.includes('餅乾') && !store.nst && store.todo.includes('餅乾'), 'Geography unmatched text → 問爸爸或老師 + saved under g6geo_to_add_v1 only');

    // Switching back and forth restores state
    await click(`.nst-conf[data-id="${c0.id}"]`); await waitFor(`document.getElementById('nstStill')`); await click('#nstStill');
    await ev(`setSubject('nst')`); await waitFor(`document.getElementById('nstLesson')`);
    const nstBack = await ev(`({ title: document.querySelector('#nstLesson .question-title').textContent, todo: document.getElementById('nstTodo').textContent, head: document.getElementById('siteTitle').textContent })`);
    assert(nstBack.head.includes('自然科學') && !nstBack.todo.includes('餅乾'), 'switch to NS&T: its unit page is restored and its to-add list is separate');
    await ev(`setSubject('maths')`); await waitFor(`document.getElementById('questionSection').style.display === 'block'`);
    assert(await ev(`document.getElementById('questionContent').textContent`) === mq && await ev(`document.getElementById('siteTitle').textContent.includes('數學')`), 'switch to Maths: same question and Maths title restored');
    await ev(`setSubject('geo')`); await waitFor(`document.getElementById('nstDetail')`);
    const back = await ev(`({ t: document.querySelector('#nstDetail .question-title').textContent, l: document.getElementById('nstLayer').textContent })`);
    assert(back.t === c0.label_zh && back.l.includes('2 / 3'), 'switch back to Geography: same confusion and layer restored');
    // English
    await ev(`document.querySelectorAll('.language-section .lang-btn')[1].click()`);
    assert(await ev(`document.getElementById('siteTitle').textContent.includes('Geography')`), 'Geography: English header when language is English');
    await ev(`document.querySelectorAll('.language-section .lang-btn')[0].click()`);
    await cdp.send('Target.closeTarget', { targetId: t });
}

async function ai() {
    const t = await open(1280, 900, false, mockAI);
    await ev(`setSubject('geo')`); await waitFor(`document.querySelectorAll('.nst-unit').length === 16`);
    const u = geo.units[2];
    await click(`.nst-unit[data-id="${u.id}"]`); await click('#nstDont'); await waitFor(`document.getElementById('nstFree')`);
    await ev(`document.getElementById('nstFree').value = 'zzzz qqq what?'; document.querySelector('[data-act="free"]').click()`);
    await waitFor(`window.__ai.prompts.length === 1 && document.getElementById('nstAiText') && document.getElementById('nstAiText').textContent.includes('Geo reply')`);
    const a = await ev(`({ sys: window.__ai.creates[0], p: window.__ai.prompts[0] })`);
    assert(a.sys.includes('Geography') && !a.sys.includes('Natural Sciences'), 'Geography AI: session uses the Geography system prompt');
    assert(a.p.includes('UNIT: ' + u.title_en) && a.p.includes('geography terms'), 'Geography AI: prompt grounded on the current Geography unit');
    await ev(`setSubject('nst')`); await waitFor(`document.querySelectorAll('.nst-unit').length === 10`);
    await click('.nst-unit'); await click('#nstDont'); await waitFor(`document.getElementById('nstFree')`);
    await ev(`document.getElementById('nstFree').value = 'zzzz qqq what?'; document.querySelector('[data-act="free"]').click()`);
    await waitFor(`window.__ai.prompts.length === 2`);
    const b = await ev(`({ sys: window.__ai.creates[1], p: window.__ai.prompts[1] })`);
    assert(b && b.sys && b.sys.includes('Natural Sciences') && b.p.includes('science terms'), 'NS&T AI: still uses its own prompt and session');
    await cdp.send('Target.closeTarget', { targetId: t });
}

async function screens(width, height, mobile, tag) {
    const t = await open(width, height, mobile);
    await ev(`setSubject('geo')`); await waitFor(`document.querySelectorAll('.nst-unit').length === 16`);
    const ov = await ev(`document.documentElement.scrollWidth`);
    assert(ov <= width, `${tag}: no horizontal scroll on the Geography grid (${ov} ≤ ${width})`);
    await sleep(1200);
    await shot(`geo-grid-${tag}`);
    await ev(`document.getElementById('nstSource').open = true; document.getElementById('nstSource').scrollIntoView({ block: 'center' })`); await sleep(300);
    await shot(`geo-source-${tag}`);
    await click('.nst-unit[data-id="geo-13-population-density"]'); await waitFor(`document.getElementById('nstLesson')`);
    await ev(`window.scrollTo(0, document.getElementById('nstLesson').getBoundingClientRect().top + scrollY - 10)`); await sleep(300);
    await shot(`geo-unit-${tag}`);
    await shot(`geo-unit-full-${tag}`, true);
    await ev(`document.getElementById('nstFlags').open = true; document.getElementById('nstFlags').scrollIntoView({ block: 'start' })`); await sleep(300);
    const ov2 = await ev(`document.documentElement.scrollWidth`);
    assert(ov2 <= width, `${tag}: no horizontal scroll on a Geography unit page (${ov2} ≤ ${width})`);
    await shot(`geo-parents-${tag}`);
    await ev(`window.scrollTo(0, 0)`); await sleep(200);
    await shot(`geo-subject-switch-${tag}`);
    await cdp.send('Target.closeTarget', { targetId: t });
}

async function main() {
    const server = spawn('python3', ['-m', 'http.server', String(port), '--bind', '127.0.0.1'], { cwd: root, stdio: 'ignore' });
    const dir = fs.mkdtempSync('/tmp/geo-chrome-');
    const chrome = spawn('google-chrome', ['--headless=new', '--disable-gpu', '--no-sandbox', '--disable-dev-shm-usage', `--remote-debugging-port=${dbg}`, `--user-data-dir=${dir}`, 'about:blank'], { stdio: 'ignore' });
    let ws;
    try {
        await up(base);
        const ver = await (await up(`http://127.0.0.1:${dbg}/json/version`)).json();
        ws = new WebSocket(ver.webSocketDebuggerUrl);
        await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });
        cdp = new CDP(ws);
        await logic();
        await ai();
        await screens(1280, 1000, false, 'desktop');
        await screens(390, 844, true, 'mobile');
    } finally {
        try { ws && ws.close(); } catch (e) {}
        chrome.kill('SIGKILL'); server.kill('SIGKILL');
    }
    if (failures) { console.error(failures + ' assertion(s) failed'); process.exit(1); }
    console.log('all checks passed');
}
main().catch(e => { console.error(e); process.exit(1); });
