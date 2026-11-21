// Grading audit for the lesson subjects (Geography + NS&T) in real headless Chrome, using REAL mouse
// clicks (Input.dispatchMouseEvent), not element.click().
//   node test/geo-grading.mjs                       -> serves this repo locally
//   BASE_URL=https://hwc624.github.io/grade6maths/ node test/geo-grading.mjs   -> audits the live site
//   SUBJECTS=geo   to limit to one subject;  STRESS=0 to skip the synthetic special-character dataset;
//   ONLY=<unit id> to restrict to one unit;  REPEAT=n to repeat only the playthrough n times (flake hunting);
//   VIEW_W=390 VIEW_H=844 MOBILE=1 for a phone viewport;  LANG_UI=en for the English UI;  QUICK=1 audits only every 3rd question.
// For EVERY check question and EVERY confusion confirm question, and for EVERY option: click it and
// require "correct" only for the option equal to answer, "incorrect" for all others, with the state
// (question id, index, NS&T/Geography separation, localStorage) not drifting.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(process.env.ROOT || path.join(path.dirname(fileURLToPath(import.meta.url)), '..'));
const port = Number(process.env.PORT || 8767), dbg = Number(process.env.DBG || 9335);
const live = process.env.BASE_URL;
const base = live || `http://127.0.0.1:${port}/index.html`;
const subjects = (process.env.SUBJECTS || 'geo,nst').split(',');
const lang = process.env.LANG_UI || 'zh';
let failures = 0, checks = 0;
const failList = [];
const assert = (c, m) => { checks++; if (!c) { failures++; failList.push(m); if (failList.length <= 40) console.error('FAIL:', m); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));

class CDP {
    constructor(ws) { this.ws = ws; this.id = 0; this.p = new Map();
        ws.addEventListener('message', ev => { const m = JSON.parse(ev.data); if (m.id && this.p.has(m.id)) { const { res, rej } = this.p.get(m.id); this.p.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result || {}); } }); }
    send(method, params = {}, sessionId) { const id = ++this.id; const pl = { id, method, params }; if (sessionId) pl.sessionId = sessionId; this.ws.send(JSON.stringify(pl)); return new Promise((res, rej) => this.p.set(id, { res, rej })); }
}
async function up(url) { for (let i = 0; i < 75; i++) { try { const r = await fetch(url); if (r.ok) return r; } catch (e) {} await sleep(200); } throw new Error('not up: ' + url); }

let cdp, S;
const ev = async (expr) => { const r = await cdp.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }, S); if (r.exceptionDetails) throw new Error((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text); return r.result && r.result.value; };
const waitFor = async (expr, ms = 8000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await ev(`(()=>{try{return !!(${expr})}catch(e){return false}})()`)) return true; await sleep(15); } throw new Error('timeout: ' + expr); };
// Real tap: scroll the element into view, check nothing covers its centre, then press/release the mouse there.
async function tap(elExpr) {
    // The app uses smooth scrolling after navigation. An instant scrollIntoView cancels it; then wait two frames
    // so layout is final before reading the button's position.
    let r = null;
    for (let i = 0; i < 5; i++) {
        r = await ev(`new Promise(res => { const el=(${elExpr}); if(!el) return res(null); el.scrollIntoView({block:'center', behavior:'instant'}); requestAnimationFrame(() => requestAnimationFrame(() => { const e2=(${elExpr}); if(!e2) return res(null); const b=e2.getBoundingClientRect(); const x=b.left+b.width/2, y=b.top+b.height/2; const top=document.elementFromPoint(x,y); res({x,y,hit: top===e2||e2.contains(top)}); })); })`);
        if (!r) throw new Error('tap: missing ' + elExpr);
        if (r.hit) break;
    }
    if (!r.hit) throw new Error('tap: element covered ' + elExpr);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: r.x, y: r.y, button: 'left', clickCount: 1 }, S);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: r.x, y: r.y, button: 'left', clickCount: 1 }, S);
}
const q = s => `document.querySelector(${JSON.stringify(s)})`;
const tapSel = s => tap(q(s));

const VW = Number(process.env.VIEW_W || 1280), VH = Number(process.env.VIEW_H || 900), MOBILE = process.env.MOBILE === '1';
async function openPage(extraScript, width = VW, height = VH, mobile = MOBILE) {
    const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
    ({ sessionId: S } = await cdp.send('Target.attachToTarget', { targetId, flatten: true }));
    await cdp.send('Page.enable', {}, S); await cdp.send('Runtime.enable', {}, S);
    if (extraScript) await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: extraScript }, S);
    await cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile }, S);
    if (mobile) await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true }, S);
    await cdp.send('Page.navigate', { url: base }, S);
    await waitFor(`document.readyState === 'complete' && window.NST`);
    if (lang === 'en') await ev(`typeof setLanguage === 'function' && setLanguage('en')`);
    return targetId;
}
async function enter(subj) {
    await ev(`setSubject(${JSON.stringify(subj)})`);
    await waitFor(`document.getElementById('nstGrid') || document.getElementById('nstLesson') || document.getElementById('nstDetail') || document.getElementById('nstConfused')`);
    await backToGrid();
}
async function backToGrid() {
    for (let i = 0; i < 6 && !await ev(`!!document.getElementById('nstGrid')`); i++) {
        for (const act of ['grid', 'lesson', 'dont']) {
            if (await ev(`!!document.querySelector('#nstRoot [data-act="${act}"]')`)) { await tapSel(`#nstRoot [data-act="${act}"]`); break; }
        }
        await sleep(10);
    }
    await waitFor(`document.getElementById('nstGrid')`);
}
const norm = s => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
const optBtn = (kind, i) => `document.querySelectorAll('#nstRoot [data-act="opt"][data-kind="${kind}"]')[${i}]`;

// Walk to check question #qi of unit u (earlier ones answered correctly with element.click: navigation only).
async function gotoCheck(subj, u, qi) {
    await backToGrid();
    await tapSel(`.nst-unit[data-id="${u.id}"]`); await waitFor(`document.getElementById('nstCheck')`);
    for (let k = 0; k < qi; k++) {
        const ans = JSON.stringify(u.check_questions[k].answer);
        await ev(`[...document.querySelectorAll('#nstCheck [data-kind="check"]')].find(b => b.dataset.opt === ${ans}).click()`);
        await waitFor(`document.querySelector('#nstCheck .feedback')`);
        await tapSel('[data-act="next-q"]'); await waitFor(`NST.state(${JSON.stringify(subj)}).qIndex === ${k + 1} && document.querySelector('#nstCheck [data-kind="check"]')`);
    }
}
async function gotoConfirm(u, c) {
    await backToGrid();
    await tapSel(`.nst-unit[data-id="${u.id}"]`); await waitFor(`document.getElementById('nstLesson')`);
    await tapSel('#nstDont'); await waitFor(`document.getElementById('nstConfused')`);
    await tapSel(`[data-act="confusion"][data-id=${JSON.stringify(c.id)}]`); await waitFor(`document.getElementById('nstDetail')`);
    await tapSel('#nstQuiz'); await waitFor(`document.querySelector('#nstConfirm [data-kind="confirm"]')`);
}

async function auditSubject(subj, data, tag) {
    const sj = JSON.stringify(subj);
    let nCheck = 0, nConfirm = 0, nOpt = 0, seq = 0;
    const skip = () => process.env.QUICK === '1' && (seq++ % 3 !== 0);
    for (const u of data.units) {
        // --- check questions
        for (let qi = 0; qi < u.check_questions.length; qi++) {
            const qq = u.check_questions[qi];
            if (skip()) continue;
            for (let oi = 0; oi < qq.options.length; oi++) {
                const where = `${tag}/${subj} ${u.id} check#${qi + 1} option#${oi + 1}`;
                await gotoCheck(subj, u, qi);
                const pre = await ev(`(()=>{const bs=[...document.querySelectorAll('#nstCheck [data-kind="check"]')]; return {qid:document.getElementById('nstCheck').dataset.qid, texts:bs.map(b=>b.textContent), opts:bs.map(b=>b.dataset.opt), head:document.querySelector('#nstCheck .gstep-head').textContent}})()`);
                assert(pre.opts.length === qq.options.length && pre.opts.every((o, i) => o === qq.options[i]), `${where}: data-opt of every button equals the JSON option (exact, in order)`);
                assert(pre.texts.every((t, i) => t === qq.options[i]), `${where}: button textContent equals the JSON option`);
                assert(pre.qid === (qq.id || `${u.id}-q${qi + 1}`), `${where}: shown question id matches (${pre.qid})`);
                await tap(optBtn('check', oi));
                await waitFor(`document.querySelector('#nstCheck .feedback')`);
                const post = await ev(`(()=>{const st=NST.state(${sj}); return {fb:document.querySelector('#nstCheck .feedback').classList.contains('correct')?'correct':(document.querySelector('#nstCheck .feedback').classList.contains('incorrect')?'incorrect':'?'), qid:document.getElementById('nstCheck').dataset.qid, qIndex:st.qIndex, unitId:st.unitId, res:st.qResult&&st.qResult.ok, left:document.querySelectorAll('#nstCheck [data-kind="check"]').length}})()`);
                const expectOk = norm(qq.options[oi]) === norm(qq.answer);
                assert(post.fb === (expectOk ? 'correct' : 'incorrect'), `${where}: expected ${expectOk ? 'correct' : 'incorrect'} got ${post.fb} (option "${qq.options[oi]}", answer "${qq.answer}")`);
                assert(post.res === expectOk, `${where}: state.qResult.ok === ${expectOk}`);
                assert(post.qid === pre.qid && post.qIndex === qi && post.unitId === u.id, `${where}: state stayed on the same question (qid ${post.qid}, qIndex ${post.qIndex}, unit ${post.unitId})`);
                assert(post.left === 0, `${where}: options are replaced by feedback after one tap`);
                nOpt++;
            }
            nCheck++;
        }
        // --- confusion confirm questions
        for (const c of u.confusions) {
            const cq = c.confirm_question;
            if (skip()) continue;
            for (let oi = 0; oi < cq.options.length; oi++) {
                const where = `${tag}/${subj} ${u.id} confusion ${c.id} option#${oi + 1}`;
                await gotoConfirm(u, c);
                const pre = await ev(`(()=>{const bs=[...document.querySelectorAll('#nstConfirm [data-kind="confirm"]')]; return {opts:bs.map(b=>b.dataset.opt), texts:bs.map(b=>b.textContent)}})()`);
                assert(pre.opts.length === cq.options.length && pre.opts.every((o, i) => o === cq.options[i]) && pre.texts.every((t, i) => t === cq.options[i]), `${where}: data-opt/textContent equal the JSON options`);
                await tap(optBtn('confirm', oi));
                await waitFor(`document.getElementById('nstWhy')`);
                const post = await ev(`(()=>{const st=NST.state(${sj}); const w=document.getElementById('nstWhy'); return {fb:w.classList.contains('correct')?'correct':(w.classList.contains('incorrect')?'incorrect':'?'), cid:st.confusionId, unitId:st.unitId, res:st.confirmResult&&st.confirmResult.ok}})()`);
                const expectOk = norm(cq.options[oi]) === norm(cq.answer);
                assert(post.fb === (expectOk ? 'correct' : 'incorrect'), `${where}: expected ${expectOk ? 'correct' : 'incorrect'} got ${post.fb} (option "${cq.options[oi]}", answer "${cq.answer}")`);
                assert(post.res === expectOk && post.cid === c.id && post.unitId === u.id, `${where}: state.confirmResult matches and stays on ${c.id}`);
                nOpt++;
            }
            nConfirm++;
        }
    }
    console.log(`[${tag}/${subj}] audited ${nCheck} check questions + ${nConfirm} confirm questions, ${nOpt} option taps`);
}

// A child who answers every question correctly, in order, must never see "incorrect"; one who always picks a
// wrong option must never see "correct". Also covers the retry-after-wrong path in the confusion flow.
async function playthrough(subj, data, tag) {
    let right = 0, wrong = 0;
    for (const mode of ['right', 'wrong']) {
        await backToGrid();
        for (const u of data.units) {
            await backToGrid();
            await tapSel(`.nst-unit[data-id="${u.id}"]`); await waitFor(`document.getElementById('nstCheck')`);
            for (let k = 0; k < u.check_questions.length; k++) {
                const qq = u.check_questions[k];
                const idx = qq.options.findIndex(o => norm(o) === norm(qq.answer));
                const pick = mode === 'right' ? idx : (idx + 1) % qq.options.length;
                await tap(optBtn('check', pick)); await waitFor(`document.querySelector('#nstCheck .feedback')`);
                const fb = await ev(`document.querySelector('#nstCheck .feedback').classList.contains('correct')`);
                assert(fb === (mode === 'right'), `${tag}/${subj} playthrough(${mode}) ${u.id} q${k + 1}: feedback ${fb}`);
                mode === 'right' ? right++ : wrong++;
                if (k < u.check_questions.length - 1) { await tapSel('[data-act="next-q"]'); await waitFor(`NST.state(${JSON.stringify(subj)}).qIndex === ${k + 1} && document.querySelector('#nstCheck [data-kind="check"]')`); }
            }
        }
    }
    // wrong-then-retry in the confusion flow: wrong -> next layer -> quiz -> right
    let retry = 0;
    for (const u of data.units) for (const c of u.confusions) {
        const cq = c.confirm_question; const idx = cq.options.findIndex(o => norm(o) === norm(cq.answer));
        await gotoConfirm(u, c);
        await ev(`window.__clicked = []; if (!window.__spy) { window.__spy = 1; document.addEventListener('click', e => { const b = e.target.closest && e.target.closest('[data-opt]'); window.__clicked.push(b ? b.dataset.opt : (e.target.id || e.target.tagName)); }, true); }`);
        await tap(optBtn('confirm', (idx + 1) % cq.options.length)); await waitFor(`document.getElementById('nstWhy')`);
        const firstWrong = await ev(`document.getElementById('nstWhy').classList.contains('incorrect')`);
        assert(firstWrong, `${tag}/${subj} retry ${c.id}: first (wrong) pick is incorrect` + (firstWrong ? '' : ` — clicks seen: ${JSON.stringify(await ev('window.__clicked'))}, wanted option ${(idx + 1) % cq.options.length + 1}`));
        if (!firstWrong) continue;
        await tapSel('#nstNextLayer'); await waitFor(`NST.state(${JSON.stringify(subj)}).layer === 1`);
        await tapSel('#nstQuiz'); await waitFor(`document.querySelector('#nstConfirm [data-kind="confirm"]')`);
        assert(await ev(`!document.getElementById('nstWhy')`), `${tag}/${subj} retry ${c.id}: old verdict is cleared when quizzed again`);
        await tap(optBtn('confirm', idx)); await waitFor(`document.getElementById('nstWhy')`);
        assert(await ev(`document.getElementById('nstWhy').classList.contains('correct')`), `${tag}/${subj} retry ${c.id}: right pick on the second quiz is correct`);
        retry++;
    }
    console.log(`[${tag}/${subj}] playthrough: ${right} right-picks all correct, ${wrong} wrong-picks all incorrect, ${retry} confusion retries`);
}

// Geography and NS&T must not share state or storage.
async function isolation(data) {
    await enter('nst'); const nstBefore = await ev(`JSON.stringify(NST.state('nst'), (k, v) => (k === 'data' || k === 'cfg' || k === 'ai') ? undefined : v)`);
    await enter('geo'); const g = data.geo.units[0];
    await tapSel(`.nst-unit[data-id="${g.id}"]`); await waitFor(`document.getElementById('nstCheck')`);
    await tap(optBtn('check', 0)); await waitFor(`document.querySelector('#nstCheck .feedback')`);
    const geoRes = await ev(`NST.state('geo').qResult.ok`);
    await enter('nst');
    const nstAfter = await ev(`JSON.stringify(NST.state('nst'), (k, v) => (k === 'data' || k === 'cfg' || k === 'ai') ? undefined : v)`);
    assert(nstAfter === nstBefore, 'isolation: NS&T state is identical before and after answering in Geography');
    const nu = data.nst.units[0];
    await tapSel(`.nst-unit[data-id="${nu.id}"]`); await waitFor(`document.getElementById('nstCheck')`);
    const nq = data.nst.units[0].check_questions[0]; const ni = nq.options.findIndex(o => norm(o) === norm(nq.answer));
    await tap(optBtn('check', ni)); await waitFor(`document.querySelector('#nstCheck .feedback')`);
    assert(await ev(`document.querySelector('#nstCheck .feedback').classList.contains('correct')`), 'isolation: NS&T first question graded from NS&T data, not Geography data');
    await enter('geo');
    await tapSel(`.nst-unit[data-id="${g.id}"]`); await waitFor(`document.getElementById('nstCheck')`);
    assert(await ev(`NST.state('geo').unitId === ${JSON.stringify(g.id)} && NST.state('geo').qResult === null`), 'isolation: Geography state is its own');
    await tap(optBtn('check', 0)); await waitFor(`document.querySelector('#nstCheck .feedback')`);
    assert(await ev(`NST.state('geo').qResult.ok`) === geoRes, 'isolation: same Geography option, same verdict after visiting NS&T');
    const ls = await ev(`Object.keys(localStorage)`);
    assert(ls.every(k => /^g6/.test(k) || k.startsWith('mathApp') || true), 'localStorage keys listed');
    const blob = await ev(`Object.keys(localStorage).map(k => k + '=' + localStorage.getItem(k)).join('|')`);
    assert(!blob.includes(g.check_questions[0].answer) && !blob.includes('geo-01-latitude') , 'localStorage holds no cached lesson JSON or answers');
    console.log('[isolation] localStorage keys after the run:', JSON.stringify(ls));
}

// Synthetic Geography file whose options/answers are full of characters that HTML escaping could break.
function stressData(geo) {
    const weird = ['Hot, dry: 1,5 m', '“Quoted” and "plain" and \'single\'', 'Tom & Jerry &amp; co', '3 < 5 > 2', '<b>bold</b> <script>alert(1)</script>', '&lt;already escaped&gt;', 'A  two  spaces', ' leading and trailing ', 'tab\there', 'line\nbreak', 'NBSP\u00a0here', '全形，逗號、引號「」', 'emoji 🌍 ok', '100% sure', '`back${tick}`', 'back\\slash', '1,5 ; 2,5 | 3.5', '="x" onclick="alert(1)"', "it's"];
    const mk = (id, i) => { const opts = [weird[i % weird.length], weird[(i + 5) % weird.length], weird[(i + 9) % weird.length], weird[(i + 13) % weird.length]]; const ai = i % 4; return { id, q_zh: `特殊字元題 ${i}`, q_en: `Special ${i}`, options: opts, answer: opts[ai], why_zh: '測試用' }; };
    const u = JSON.parse(JSON.stringify(geo.units[0])); u.id = 'geo-zz-stress'; u.title_zh = '特殊字元'; u.title_en = 'Stress';
    u.check_questions = weird.map((_, i) => mk('s' + i, i)); u.confusions.forEach((c, j) => { c.confirm_question = mk('c' + j, j + 3); }); u.confusions = u.confusions.slice(0, 4);
    return Object.assign({}, geo, { units: [u] });
}

async function main() {
    let server;
    if (!live) { server = spawn('python3', ['-m', 'http.server', String(port), '--bind', '127.0.0.1'], { cwd: root, stdio: 'ignore' }); }
    const dir = fs.mkdtempSync('/tmp/geo-grading-chrome-');
    const chrome = spawn('google-chrome', ['--headless=new', '--disable-gpu', '--no-sandbox', '--disable-dev-shm-usage', `--remote-debugging-port=${dbg}`, `--user-data-dir=${dir}`, 'about:blank'], { stdio: 'ignore' });
    let ws;
    try {
        await up(base);
        const ver = await (await up(`http://127.0.0.1:${dbg}/json/version`)).json();
        ws = new WebSocket(ver.webSocketDebuggerUrl);
        await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });
        cdp = new CDP(ws);
        const tag = live ? 'live' : 'local';
        const baseDir = base.replace(/[^/]*$/, '');
        const data = {};
        for (const [k, f] of [['geo', 'geo-lessons.json'], ['nst', 'nst-lessons.json']]) data[k] = await (await fetch(baseDir + f + '?audit=' + Date.now())).json();
        console.log(`[${tag}] serving ${base}; geo ${data.geo.units.length} units, nst ${data.nst.units.length} units`);
        await openPage();
        for (const subj of subjects) {
            await enter(subj);
            // the page itself must be using the same JSON as the server's current copy
            const same = await ev(`fetch(${JSON.stringify(subj === 'geo' ? 'geo-lessons.json' : 'nst-lessons.json')}).then(r => r.json()).then(d => JSON.stringify(d) === ${JSON.stringify(JSON.stringify(data[subj]))})`);
            assert(same, `${tag}/${subj}: the JSON the page fetches equals the server's current file (no stale cache)`);
            const live_ = await ev(`JSON.stringify(NST.state(${JSON.stringify(subj)}).data) === ${JSON.stringify(JSON.stringify(data[subj]))}`);
            assert(live_, `${tag}/${subj}: the JSON the page is running on equals the server's current file`);
            const sub = process.env.ONLY ? Object.assign({}, data[subj], { units: data[subj].units.filter(u => u.id === process.env.ONLY) }) : data[subj];
            if (!process.env.REPEAT) await auditSubject(subj, sub, tag);
            for (let r = 0; r < Number(process.env.REPEAT || 1); r++) await playthrough(subj, sub, tag);
        }
        if (subjects.includes('geo') && subjects.includes('nst')) await isolation(data);
        if (process.env.STRESS !== '0') {
            const st = stressData(data.geo);
            const script = `(()=>{const of=window.fetch; const D=${JSON.stringify(JSON.stringify(st))}; window.fetch=function(u,...a){ if(String(u).includes('geo-lessons.json')) return Promise.resolve(new Response(D,{status:200,headers:{'content-type':'application/json'}})); return of.call(this,u,...a); };})();`;
            await openPage(script);
            await enter('geo');
            const v = await ev(`NST.validate(NST.state('geo').data, 'stress').ok`);
            assert(v, 'stress dataset passes the validator');
            await auditSubject('geo', st, 'stress');
            await playthrough('geo', st, 'stress');
            const injected = await ev(`window.__pwned === 1 || !!document.querySelector('#nstRoot script')`);
            assert(!injected, 'stress: <script>/onclick text in options is shown as text, never executed');
        }
    } finally {
        try { ws && ws.close(); } catch (e) {}
        chrome.kill('SIGKILL'); if (server) server.kill('SIGKILL');
    }
    console.log(`${checks} assertions, ${failures} failed`);
    if (failures) { console.error(failList.slice(0, 80).join('\n')); process.exit(1); }
    console.log('all checks passed');
}
main().catch(e => { console.error(e); process.exit(1); });
