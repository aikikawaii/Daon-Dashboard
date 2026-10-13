const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const Core = require('../dashboard-core.js');
const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
const classic = [...html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)].find(match => !match[1] && match[2].trim())[2];
const json = value => JSON.parse(JSON.stringify(value));
function fixture() {
    return { courses: [{ id: 'C1', subject: 'Mathematics', title: '미적분', color: '#2563eb' }],
        lectures: [{ id: 'L10', courseId: 'C1', title: 'Lecture 10 - 적분', status: '미시작' }, { id: 'L2', courseId: 'C1', title: '2강 미분', status: '미시작' }, { id: 'L1', courseId: 'C1', title: '1강 함수', status: '미시작', duration: 45 }],
        dailyRecords: [{ id: 'D1', date: '2026-10-08', tasks: [{ id: 'T1', type: 'lecture', title: '1강 함수', completed: false, refId: 'L1' }] }], ddays: [] };
}
function environment(data = fixture(), sharedStorage = new Map(), boot = true) {
    const elements = new Map(), docEvents = new Map(), winEvents = new Map(), timers = new Map(), warnings = [], charts = [];
    let timerId = 0;
    function element(id = '', attrs = '') {
        const listeners = new Map(); let markup = '', classes = new Set();
        const item = { id, value: '', dataset: {}, style: {}, children: [], parentElement: null, scrollLeft: 0, scrollTop: 0,
            addEventListener(type, fn) { listeners.set(type, fn); }, listeners,
            appendChild(child) { this.children.push(child); }, remove() {}, getContext() { return {}; },
            getBoundingClientRect() { return { left: 0, top: 0, right: 100, bottom: 100 }; },
            reportValidity() { if (this.required && this.value === '') return false; if (this.value === '') return true; const n = Number(this.value); return Number.isFinite(n) && (this.min === undefined || n >= Number(this.min)) && (this.step !== '1' || Number.isInteger(n)); }
        };
        item.classList = { add(...names) { names.forEach(n => classes.add(n)); }, remove(...names) { names.forEach(n => classes.delete(n)); }, contains(name) { return classes.has(name); }, replace(a, b) { classes.delete(a); classes.add(b); }, toggle(name, force) { const add = force ?? !classes.has(name); if (add) classes.add(name); else classes.delete(name); } };
        Object.defineProperty(item, 'className', { get: () => [...classes].join(' '), set: value => { classes = new Set(value.split(/\s+/)); } });
        function attributes(text) {
            for (const match of text.matchAll(/([\w-]+)="([^"]*)"/g)) { if (match[1] === 'class') item.className = match[2]; else item[match[1]] = match[2]; }
            item.required = /(?:^|\s)required(?:\s|$)/.test(text);
        }
        attributes(attrs);
        Object.defineProperty(item, 'innerHTML', { get: () => markup, set: value => {
            markup = value;
            for (const match of value.matchAll(/<\w+\b([^>]*\bid="([^"]+)"[^>]*)>/g)) elements.set(match[2], element(match[2], match[1]));
            const options = [...value.matchAll(/<option\b([^>]*)value="([^"]*)"([^>]*)>/g)];
            if (options.length) { const selected = options.find(match => /selected/.test(match[1] + match[3])) || options[0]; item.value = selected[2]; }
        }});
        return item;
    }
    for (const match of html.matchAll(/<\w+\b([^>]*\bid="([^"]+)"[^>]*)>/g)) elements.set(match[2], element(match[2], match[1]));
    const register = store => (type, fn) => { const fns = store.get(type) || []; fns.push(fn); store.set(type, fns); };
    const window = { addEventListener: register(winEvents), location: { reload() {} } };
    window.Chart = class { static defaults = { font: {} }; constructor(ctx, config) { Object.assign(this, config); charts.push(config); } update() {} };
    const sandbox = { DashboardCore: Core, window, document: { readyState: 'loading', documentElement: { setAttribute() {} },
        getElementById: id => elements.get(id) || null, addEventListener: register(docEvents), querySelectorAll: () => [], createElement: () => element() },
        localStorage: { getItem: key => sharedStorage.get(key) ?? null, setItem: (key, value) => sharedStorage.set(key, value) },
        FileReader: class { readAsText(file) { this.onload({ target: { result: file.content } }); } },
        crypto: { randomUUID: () => '12345678-1234-1234-1234-123456789012' },
        setTimeout: fn => { timers.set(++timerId, fn); return timerId; }, clearTimeout: id => timers.delete(id),
        requestAnimationFrame: fn => fn(), getComputedStyle: () => ({ getPropertyValue: name => name === '--table-header' ? '#ebebe6' : '#000000' }),
        console: { warn: (...args) => warnings.push(args), error: (...args) => warnings.push(args), log() {} }
    };
    vm.createContext(sandbox); vm.runInContext(classic, sandbox);
    const run = code => vm.runInContext(code, sandbox);
    if (data && !sharedStorage.has('daon-dashboard-v2')) sharedStorage.set('daon-dashboard-v2', JSON.stringify({ version: 2, data: Core.normalizeData(data), base: Core.normalizeData(data), pending: false, revision: 1 }));
    if (boot) run('initDOM(); loadLocalData();');
    const fire = (events, type, event) => (events.get(type) || []).forEach(fn => fn(event));
    const click = (action, dataset = {}, modifiers = {}) => { const target = { dataset: { action, ...dataset }, closest(selector) { return selector === '[data-action]' ? this : null; } }; fire(docEvents, 'click', { target, ...modifiers }); };
    const change = (action, dataset = {}, extra = {}) => fire(docEvents, 'change', { target: { dataset: { action, ...dataset }, ...extra } });
    return { run, window, sandbox, elements, sharedStorage, warnings, charts, click, change, emitWindow: (type, event) => fire(winEvents, type, event), data: () => json(window.getExportData()) };
}

test('existing backup loads without mutation and preserves ranges, time and extra data', () => {
    const original = JSON.parse(fs.readFileSync(path.join(__dirname, '../data.json'), 'utf8')), before = json(original);
    const data = Core.normalizeData(original);
    assert.equal(data.lectures.length, 86); assert.equal(data.dailyRecords.length, 6); assert.deepEqual(data.memos, []);
    assert.equal(data.lectures.find(l => l.id === 'L_zbg3wg0ta').duration, 35);
    assert(data.lectures.some(l => l.title === '53-55강 (종강)')); assert.deepEqual(original, before);
});
test('Korean, English and OT lecture titles share canonical numeric sorting', () => {
    const titles = ['10강 적분', 'Lecture 02 - 미분', 'ot', '1-3강 기초', '제01강 함수', '추가 특강'];
    const data = fixture(); data.lectures = titles.map((title, i) => ({ id: 'L_' + i, courseId: 'C1', title }));
    assert.deepEqual(Core.normalizeData(data).lectures.map(l => l.title), ['0강 OT', '1강 함수', '1-3강 기초', '2강 미분', '10강 적분', '추가 특강']);
    assert.deepEqual(Core.parseLectureTitle('53-55강(종강)'), { number: 53, endNumber: 55, description: '(종강)' });
    assert.throws(() => Core.formatLectureTitle(3, 1, 'bad')); assert.throws(() => Core.formatLectureTitle(-1, null, 'bad'));
});
test('schema rejects malformed collections, IDs, dates, colors, boolean strings and duplicate tasks', () => {
    const invalid = [d => d.lectures = {}, d => d.courses[0].id = "x' onerror='bad", d => d.dailyRecords[0].date = '2026-02-31', d => d.courses[0].color = 'red;bad', d => d.dailyRecords[0].tasks[0].completed = 'false', d => d.dailyRecords[0].tasks.push(json(d.dailyRecords[0].tasks[0])), d => d.lectures[0].duration = -1, d => d.ddays = {}];
    invalid.forEach(mutate => { const data = fixture(); mutate(data); assert.throws(() => Core.normalizeData(data)); });
    assert(Core.validDate('2024-02-29')); assert(!Core.validDate('2025-02-29'));
});
test('three-way merge keeps independent changes and only resolves the conflicting field locally', () => {
    const base = fixture(), local = json(base), remote = json(base);
    local.courses[0].title = 'Local course'; remote.courses[0].color = '#dc2626';
    local.lectures.find(l => l.id === 'L1').title = '1강 Local'; remote.lectures.find(l => l.id === 'L2').title = '2강 Remote';
    const merged = Core.mergeData(base, local, remote);
    assert.equal(merged.courses[0].title, 'Local course'); assert.equal(merged.courses[0].color, '#dc2626');
    assert.equal(merged.lectures.find(l => l.id === 'L1').title, '1강 Local'); assert.equal(merged.lectures.find(l => l.id === 'L2').title, '2강 Remote');
});
test('explicit delete wins against unchanged data and preserves a concurrently edited entity', () => {
    const base = fixture(), local = json(base), remote = json(base); local.lectures = local.lectures.filter(l => l.id !== 'L2');
    assert(!Core.mergeData(base, local, remote).lectures.some(l => l.id === 'L2'));
    remote.lectures.find(l => l.id === 'L2').title = '2강 Remote edit';
    assert.equal(Core.mergeData(base, local, remote).lectures.find(l => l.id === 'L2').title, '2강 Remote edit');
});
test('concurrent additions to one date combine tasks and a task move preserves a remote edit exactly once', () => {
    const base = Core.emptyData(), local = Core.emptyData(), remote = Core.emptyData();
    local.dailyRecords.push({ id: 'D_local', date: '2026-10-08', tasks: [{ id: 'T_local', type: 'study', title: 'Local', completed: false }] });
    remote.dailyRecords.push({ id: 'D_remote', date: '2026-10-08', tasks: [{ id: 'T_remote', type: 'general', title: 'Remote', completed: false }] });
    assert.equal(Core.mergeData(base, local, remote).dailyRecords[0].tasks.length, 2);
    const old = fixture(), moved = json(old), edited = json(old); const task = moved.dailyRecords[0].tasks.pop();
    moved.dailyRecords.push({ id: 'D2', date: '2026-10-09', tasks: [task] }); edited.dailyRecords[0].tasks[0].title = 'Remote title';
    const merged = Core.mergeData(old, moved, edited); const all = merged.dailyRecords.flatMap(r => r.tasks);
    assert.equal(all.length, 1); assert.equal(merged.dailyRecords.find(r => r.date === '2026-10-09').tasks[0].title, 'Remote title');
});
test('complete app rendering succeeds and all lecture inventories use numeric order', () => {
    const app = environment(); app.run("openTodoCourses.add('C1'); renderAll();");
    for (const id of ['view-todo-lectures', 'curriculum-manager', 'db-lectures-container']) {
        const content = app.elements.get(id).innerHTML;
        assert(content.indexOf('1강 함수') < content.indexOf('2강 미분'), id); assert(content.indexOf('2강 미분') < content.indexOf('10강 적분'), id);
    }
    const todo = app.elements.get('view-todo-lectures').innerHTML; assert.match(todo, /<input type="checkbox"[^>]*data-action="toggleLecture"/);
    assert.equal(app.warnings.length, 0); assert.equal(app.charts.length, 3);
    app.charts.forEach(chart => chart.data.datasets.forEach(dataset => { assert(!String(dataset.borderColor).includes('var(')); assert(!String(dataset.backgroundColor).includes('var(')); }));
});
test('master and calendar completion updates stay synchronized and a no-edit daily save cannot revert them', () => {
    const app = environment(); app.change('toggleLecture', { id: 'L1' });
    assert.equal(app.data().lectures.find(l => l.id === 'L1').status, '완료'); assert.equal(app.data().dailyRecords[0].tasks[0].completed, true);
    app.click('openDailyModal', { date: '2026-10-08' }); app.elements.get('modal-save-btn').onclick();
    assert.equal(app.data().lectures.find(l => l.id === 'L1').status, '완료');
    app.click('toggleTask', { recId: 'D1', taskId: 'T1' });
    assert.equal(app.data().lectures.find(l => l.id === 'L1').status, '미시작'); assert.equal(app.data().dailyRecords[0].tasks[0].completed, false);
});
test('Ctrl/Shift selection does not toggle completion; ordinary clicks still do', () => {
    const app = environment(); app.run('initLassoSelection();');
    const task = { dataset: { recId: 'D1', taskId: 'T1' }, closest: selector => selector === '.calendar-task-item' ? task : null };
    app.elements.get('calendar-board-container').listeners.get('mousedown')({ target: task, ctrlKey: true, preventDefault() {}, stopPropagation() {} });
    app.click('toggleTask', { recId: 'D1', taskId: 'T1' }, { ctrlKey: true });
    assert.equal(app.run('selectedTaskKeys.size'), 1); assert.equal(app.data().dailyRecords[0].tasks[0].completed, false);
    app.click('toggleTask', { recId: 'D1', taskId: 'T1' }, { shiftKey: true }); assert.equal(app.data().dailyRecords[0].tasks[0].completed, false);
    app.click('toggleTask', { recId: 'D1', taskId: 'T1' }); assert.equal(app.data().dailyRecords[0].tasks[0].completed, true);
});
test('January 31 month navigation visits February and March 31 goes back to February', () => {
    const app = environment(); app.run('currentCalendarDate = new Date(2026, 0, 31);'); app.click('changePeriod', { val: '1' });
    assert.equal(app.run('formatDateStr(currentCalendarDate)'), '2026-02-01');
    app.run('currentCalendarDate = new Date(2026, 2, 31);'); app.click('changePeriod', { val: '-1' });
    assert.equal(app.run('formatDateStr(currentCalendarDate)'), '2026-02-01');
});
test('invalid restore keeps both live data and durable data unchanged; legacy restore preserves extras', () => {
    const app = environment(), before = app.data(), saved = app.sharedStorage.get('daon-dashboard-v2');
    app.change('importData', {}, { files: [{ content: JSON.stringify({ courses: [], lectures: {}, dailyRecords: [] }) }] });
    assert.deepEqual(app.data(), before); assert.equal(app.sharedStorage.get('daon-dashboard-v2'), saved);
    app.change('importData', {}, { files: [{ content: fs.readFileSync(path.join(__dirname, '../data.json'), 'utf8') }] });
    assert.equal(app.data().lectures.length, 86); assert.deepEqual(app.data().memos, []); assert.deepEqual(JSON.parse(app.sharedStorage.get('daon-dashboard-restore-backup')), before);
});
test('lecture form preserves ranges and duration, adds canonical titles, and rejects invalid numbers', () => {
    const app = environment(); app.click('openLectureModal', { courseId: 'C1', lecId: 'L1' });
    assert.equal(app.elements.get('input-lnumber').value, '1'); assert.equal(app.elements.get('input-ltitle').value, '함수'); assert.equal(app.elements.get('input-lduration').value, '45');
    app.elements.get('input-lnumber').value = '3'; app.elements.get('input-lend').value = '5'; app.elements.get('input-ltitle').value = '연습';
    app.elements.get('modal-save-btn').onclick(); assert.equal(app.data().lectures.find(l => l.id === 'L1').title, '3-5강 연습');
    assert.equal(app.data().lectures.find(l => l.id === 'L1').duration, 45);
    app.click('openLectureModal', { courseId: 'C1', lecId: 'L1' }); assert.equal(app.elements.get('input-lend').value, '5');
    const before = app.data(); app.elements.get('input-lend').value = '2'; app.elements.get('modal-save-btn').onclick();
    assert.deepEqual(app.data(), before); assert(!app.elements.get('modal-overlay').classList.contains('hidden'));
    app.elements.get('input-lend').value = ''; app.elements.get('input-lnumber').value = '-1'; app.elements.get('modal-save-btn').onclick(); assert.deepEqual(app.data(), before);
    app.click('openLectureModal', { courseId: 'C1' }); assert.equal(app.elements.get('input-lnumber').value, '11');
    app.elements.get('input-lnumber').value = '2'; app.elements.get('input-ltitle').value = '새 강의'; app.elements.get('modal-save-btn').onclick();
    assert(app.data().lectures.some(l => l.title === '2강 새 강의'));
});
test('remote updates preserve unsent changes, and acknowledgments retain newer edits until the next save', () => {
    const app = environment(); app.run("courses[0].title = 'Local'; saveData();");
    const remote = fixture(); remote.lectures.find(l => l.id === 'L2').title = '2강 Remote'; app.window.updateFromCloud(remote, 2);
    assert.equal(app.data().courses[0].title, 'Local'); assert.equal(app.data().lectures.find(l => l.id === 'L2').title, '2강 Remote');
    const request = json(app.window.getCloudSaveRequest()); app.run("courses[0].color = '#dc2626'; saveData();");
    app.window.acknowledgeCloudSave(request, { data: request.data, revision: 3 });
    assert.equal(app.data().courses[0].color, '#dc2626'); assert(app.window.hasPendingCloudChanges());
    const next = json(app.window.getCloudSaveRequest()); app.window.acknowledgeCloudSave(next, { data: next.data, revision: 4 }); assert(!app.window.hasPendingCloudChanges());
    app.window.updateFromCloud(remote, 1); assert.equal(app.data().courses[0].color, '#dc2626');
});
test('reload restores unsent changes and rejects invalid cloud data without corrupting storage', () => {
    const app = environment(); app.run("courses[0].title = 'Offline'; saveData();"); const saved = app.sharedStorage.get('daon-dashboard-v2');
    const reloaded = environment(null, app.sharedStorage); assert.equal(reloaded.data().courses[0].title, 'Offline'); assert(reloaded.window.hasPendingCloudChanges());
    const invalid = fixture(); invalid.dailyRecords[0].tasks[0].completed = 'false'; assert.throws(() => reloaded.window.updateFromCloud(invalid, 2));
    assert.equal(app.sharedStorage.get('daon-dashboard-v2'), saved); assert.equal(reloaded.data().courses[0].title, 'Offline');
});
test('another tab cannot erase local outbox edits and newer acknowledged remote data is rebased first', () => {
    const app = environment(); app.run("courses[0].title = 'Tab A'; saveData();");
    const base = Core.normalizeData(fixture()), other = json(base); other.lectures.find(l => l.id === 'L2').title = '2강 Tab B';
    app.emitWindow('storage', { key: 'daon-dashboard-v2', newValue: JSON.stringify({ data: other, base, pending: true, revision: 1 }) });
    assert.equal(app.data().courses[0].title, 'Tab A'); assert.equal(app.data().lectures.find(l => l.id === 'L2').title, '2강 Tab B'); assert(app.window.hasPendingCloudChanges());
    const acknowledged = json(base); acknowledged.ddays.push({ id: 'DD1', title: 'Remote', targetDate: '2026-12-01' });
    app.emitWindow('storage', { key: 'daon-dashboard-v2', newValue: JSON.stringify({ data: acknowledged, base: acknowledged, pending: false, revision: 2 }) });
    assert.equal(app.data().courses[0].title, 'Tab A'); assert.equal(app.data().ddays.length, 1); assert(app.window.hasPendingCloudChanges());
});
test('daily modal preserves concurrent remote task additions and completions while open', () => {
    const app = environment(); app.click('openDailyModal', { date: '2026-10-08' });
    const remote = fixture(); remote.lectures.find(l => l.id === 'L1').status = '완료'; remote.dailyRecords[0].tasks.push({ id: 'T2', type: 'study', title: 'Remote study', completed: false });
    app.window.updateFromCloud(remote, 2); app.elements.get('modal-save-btn').onclick();
    assert.equal(app.data().dailyRecords[0].tasks.length, 2); assert.equal(app.data().lectures.find(l => l.id === 'L1').status, '완료');
});
test('deleting selected tasks in reverse selection order and undoing restores original task order', () => {
    const data = fixture(); data.dailyRecords[0].tasks.push({ id: 'T2', type: 'study', title: 'Second', completed: false }, { id: 'T3', type: 'study', title: 'Third', completed: false });
    const app = environment(data); app.run("selectedTaskKeys.add('D1:T3'); selectedTaskKeys.add('D1:T1'); deleteSelectedTasks();");
    assert.deepEqual(app.data().dailyRecords[0].tasks.map(t => t.id), ['T2']); app.run('Object.values(toastTimers).find(t => t.onUndo).onUndo();');
    assert.deepEqual(app.data().dailyRecords[0].tasks.map(t => t.id), ['T1', 'T2', 'T3']);
});

const moduleSource = [...html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)].find(match => match[1].includes('module'))[2].replace(/^\s*import .*;\s*$/gm, '');
const tick = () => new Promise(resolve => setImmediate(resolve));
async function connectMockCloud(app, behavior = {}) {
    let server = { payload: JSON.stringify(Core.normalizeData(behavior.initialData || fixture())), revision: 1 }, observer, calls = 0;
    const snapshot = (metadata = { fromCache: false, hasPendingWrites: false }) => ({ exists: () => true, data: () => server, metadata });
    const transaction = () => { let written; return { api: { get: async () => snapshot(), set: (ref, data) => { written = data; } }, commit: () => { server = written; } }; };
    Object.assign(app.sandbox, {
        initializeApp: () => ({}), getAuth: () => ({ currentUser: { uid: 'test' } }), getFirestore: () => ({}), doc: () => ({}), signInAnonymously: async () => ({}),
        onSnapshot: (ref, options, callback) => { observer = callback; },
        runTransaction: async (db, callback) => {
            calls++;
            if (behavior.failFirst && calls === 1) throw new Error('offline');
            if (behavior.retryFirst && calls === 1) {
                const discarded = transaction(); await callback(discarded.api);
                const concurrent = Core.normalizeData(fixture()); concurrent.ddays.push({ id: 'DD2', title: 'Another client', targetDate: '2026-12-03' });
                server = { payload: JSON.stringify(concurrent), revision: 2 };
            }
            const tx = transaction(); const result = await callback(tx.api); tx.commit(); return result;
        }
    });
    app.run("document.readyState = 'complete';"); vm.runInContext(moduleSource, app.sandbox); await tick();
    return { emit: metadata => observer(snapshot(metadata)), calls: () => calls, data: () => JSON.parse(server.payload), revision: () => server.revision };
}
test('Firebase flow waits for server snapshots and retries offline saves without dropping the outbox', async () => {
    const app = environment(); app.run("courses[0].title = 'Queued'; saveData();"); const cloud = await connectMockCloud(app, { failFirst: true });
    cloud.emit({ fromCache: true, hasPendingWrites: false }); await tick(); assert.equal(cloud.calls(), 0);
    cloud.emit({ fromCache: false, hasPendingWrites: false }); await tick(); assert.equal(cloud.calls(), 1); assert(app.window.hasPendingCloudChanges());
    assert.equal(app.data().courses[0].title, 'Queued'); await app.window.triggerCloudSave();
    assert.equal(cloud.calls(), 2); assert.equal(cloud.data().courses[0].title, 'Queued'); assert(!app.window.hasPendingCloudChanges());
});
test('a retried Firebase transaction rebases against the latest document and preserves another client addition', async () => {
    const app = environment(); app.run("courses[0].title = 'Local transaction'; saveData();"); const cloud = await connectMockCloud(app, { retryFirst: true });
    cloud.emit({ fromCache: false, hasPendingWrites: false }); await tick();
    assert.equal(cloud.data().courses[0].title, 'Local transaction'); assert.equal(cloud.data().ddays[0].title, 'Another client');
    assert.equal(cloud.revision(), 3); assert(!app.window.hasPendingCloudChanges());
});

test('concurrent course deletion cannot hide a lecture that another client just added', () => {
    const base = fixture(), local = Core.emptyData(), remote = json(base);
    remote.lectures.push({ id: 'L_new', courseId: 'C1', title: '11강 New lecture', status: '미시작' });
    const merged = Core.mergeData(base, local, remote);
    assert(merged.lectures.some(lecture => lecture.id === 'L_new'));
    assert(merged.courses.some(course => course.id === 'C1'));
    const invalid = fixture(); invalid.lectures[0].courseId = 'C_missing'; assert.throws(() => Core.normalizeData(invalid));
});


test('D-day normalization preserves collections, extras, item fields and legacy JSON', () => {
    const source = fixture();
    source.memos = [{ title: 'keep' }]; source.preferences = { theme: 'light' };
    source.ddays = [{ id: 'DD_A', title: '시험', targetDate: '2026-12-01', note: 'keep' }];
    const before = json(source), normalized = Core.normalizeData(source);
    assert.deepEqual(normalized.ddays, source.ddays);
    assert.deepEqual(normalized.memos, source.memos); assert.deepEqual(normalized.preferences, source.preferences);
    assert.deepEqual(source, before); assert.deepEqual(Core.emptyData().ddays, []);
    const legacy = json(source); delete legacy.ddays;
    assert.deepEqual(Core.normalizeData(legacy).ddays, []);
    assert.deepEqual(Core.normalizeData(JSON.parse(JSON.stringify(normalized))), normalized);
    const deleted = { ...source, _deletedDdayIds: ['DD_A', 'DD_A'] };
    assert.deepEqual(Core.normalizeData(deleted).ddays, []);
    assert.deepEqual(Core.normalizeData(deleted)._deletedDdayIds, ['DD_A']);
    for (const value of ['DD_A', [null], ["bad'id"]]) {
        assert.throws(() => Core.normalizeData({ ...source, _deletedDdayIds: value }));
    }
});

test('concurrent D-day additions survive merge in both directions without losing other data', () => {
    const base = fixture(), local = json(base), remote = json(base);
    base.memos = local.memos = remote.memos = [{ text: 'keep' }];
    local.ddays.push({ id: 'DD_A', title: 'Local', targetDate: '2026-12-01' });
    remote.ddays.push({ id: 'DD_B', title: 'Remote', targetDate: '2026-12-02' });
    for (const result of [Core.mergeData(base, local, remote), Core.mergeData(base, remote, local)]) {
        assert.deepEqual(result.ddays.map(d => d.id).sort(), ['DD_A', 'DD_B']);
        assert.deepEqual(result.courses, Core.normalizeData(base).courses);
        assert.deepEqual(result.lectures, Core.normalizeData(base).lectures);
        assert.deepEqual(result.dailyRecords, Core.normalizeData(base).dailyRecords);
        assert.deepEqual(result.memos, base.memos);
    }
});

test('D-day deletion wins over same-item edits and keeps edits to separate items', () => {
    const base = fixture();
    base.ddays = [{ id: 'DD_A', title: 'A', targetDate: '2026-12-01' }, { id: 'DD_B', title: 'B', targetDate: '2026-12-02' }];
    const local = json(base), remote = json(base);
    local.ddays = local.ddays.filter(d => d.id !== 'DD_A');
    remote.ddays[0].title = 'Stale edit'; remote.ddays[1].title = 'Separate edit';
    remote.courses[0].title = 'Separate course edit';
    for (const merged of [Core.mergeData(base, local, remote), Core.mergeData(base, remote, local)]) {
        assert.deepEqual(merged.ddays.map(d => d.id), ['DD_B']);
        assert.equal(merged.ddays[0].title, 'Separate edit');
        assert.equal(merged.courses[0].title, 'Separate course edit');
        assert(merged._deletedDdayIds.includes('DD_A'));
    }
});

test('durable D-day deletion IDs combine across clients and block stale additions without a shared base', () => {
    const base = Core.emptyData();
    const local = { ...Core.emptyData(), _deletedDdayIds: ['DD_A'], preferences: { font: 'large' } };
    const remote = { ...Core.emptyData(), _deletedDdayIds: ['DD_B'], ddays: [{ id: 'DD_A', title: 'Old request', targetDate: '2026-12-01' }], memos: ['keep'] };
    const merged = Core.mergeData(base, local, remote);
    assert.deepEqual(merged.ddays, []); assert.deepEqual(merged._deletedDdayIds, ['DD_A', 'DD_B']);
    assert.deepEqual(merged.preferences, local.preferences); assert.deepEqual(merged.memos, remote.memos);
    const stale = { ...base, ddays: [{ id: 'DD_B', title: 'Stale client', targetDate: '2026-12-02' }] };
    assert.deepEqual(Core.mergeData(base, stale, merged).ddays, []);
    // Even an unchanged client/base must keep deletion metadata when a legacy snapshot omits it.
    assert.deepEqual(Core.mergeData(merged, merged, stale).ddays, []);
});

function addDday(app, title = '시험', date = '2026-12-01') {
    app.click('openDdayModal');
    app.elements.get('input-dday-title').value = title; app.elements.get('input-dday-date').value = date;
    app.elements.get('modal-save-btn').onclick();
}

test('D-day UI add/save/reload/delete/reload uses the single durable packet', () => {
    const app = environment(); addDday(app);
    assert.equal(app.data().ddays.length, 1);
    assert(app.elements.get('modal-overlay').classList.contains('hidden'));
    const saved = JSON.parse(app.sharedStorage.get('daon-dashboard-v2'));
    assert.deepEqual(saved.data.ddays, app.data().ddays); assert.equal(saved.pending, true);
    const reloaded = environment(null, app.sharedStorage);
    assert.deepEqual(reloaded.data().ddays, app.data().ddays);
    const id = reloaded.data().ddays[0].id; reloaded.click('deleteDday', { id });
    const deleted = environment(null, app.sharedStorage);
    assert.deepEqual(deleted.data().ddays, []);
    assert(deleted.data()._deletedDdayIds.includes(id)); assert(deleted.window.hasPendingCloudChanges());
    assert.equal(app.sharedStorage.has('ddays'), false);
});

test('failed D-day save keeps input and modal, makes no live/durable change, and retries once', () => {
    const app = environment(), before = app.data(), saved = app.sharedStorage.get('daon-dashboard-v2');
    const setItem = app.sandbox.localStorage.setItem;
    app.sandbox.localStorage.setItem = () => { throw new Error('QuotaExceededError'); };
    addDday(app, 'Keep this input');
    assert(!app.elements.get('modal-overlay').classList.contains('hidden'));
    assert.equal(app.elements.get('input-dday-title').value, 'Keep this input');
    assert.equal(app.elements.get('input-dday-date').value, '2026-12-01');
    assert(app.elements.get('dday-save-error').textContent);
    assert.deepEqual(app.data(), before); assert.equal(app.sharedStorage.get('daon-dashboard-v2'), saved);
    assert.equal(app.window.hasPendingCloudChanges(), false);
    app.sandbox.localStorage.setItem = setItem; app.elements.get('modal-save-btn').onclick();
    assert.equal(app.data().ddays.length, 1); assert(app.elements.get('modal-overlay').classList.contains('hidden'));
});

test('invalid D-day dates keep the modal open and failed deletes retain the saved item', () => {
    const app = environment();
    for (const date of ['', '2026-02-31']) {
        addDday(app, 'Input', date);
        assert.deepEqual(app.data().ddays, []); assert(!app.elements.get('modal-overlay').classList.contains('hidden'));
        assert(app.elements.get('dday-save-error').textContent);
    }
    addDday(app); const before = app.data(), saved = app.sharedStorage.get('daon-dashboard-v2');
    app.sandbox.localStorage.setItem = () => { throw new Error('Storage unavailable'); };
    app.click('deleteDday', { id: before.ddays[0].id });
    assert.deepEqual(app.data(), before); assert.equal(app.sharedStorage.get('daon-dashboard-v2'), saved);
});

test('D-day JSON export/restore keeps extras, deletion IDs and existing legacy data', () => {
    const source = fixture(); source.memos = [{ text: 'keep' }]; source.preferences = { size: 16 };
    source.ddays = [{ id: 'DD_A', title: 'A', targetDate: '2026-12-01' }, { id: 'DD_B', title: 'B', targetDate: '2026-12-02' }];
    const app = environment(source); app.click('deleteDday', { id: 'DD_A' });
    let backup;
    app.sandbox.Blob = class { constructor(parts) { backup = parts.join(''); } };
    app.sandbox.URL = { createObjectURL: () => 'blob:test', revokeObjectURL() {} };
    app.sandbox.document.createElement = () => ({ click() {} });
    app.click('exportData');
    assert.deepEqual(JSON.parse(backup), app.data());
    const restored = environment();
    restored.change('importData', {}, { files: [{ content: backup }] });
    assert.deepEqual(restored.data(), app.data());
    assert.deepEqual(environment(null, restored.sharedStorage).data(), app.data());
    const legacy = new Map(['courses', 'lectures', 'dailyRecords', 'ddays'].map(key => [key, JSON.stringify(source[key])]));
    assert.deepEqual(environment(null, legacy).data().ddays, source.ddays);
});

test('D-day removal while a cloud request is in flight survives snapshot, ack and reload', () => {
    const app = environment(); addDday(app);
    const request = json(app.window.getCloudSaveRequest()), id = app.data().ddays[0].id;
    app.click('deleteDday', { id });
    app.window.updateFromCloud(request.data, 2);
    assert.deepEqual(app.data().ddays, []);
    app.window.acknowledgeCloudSave(request, { data: request.data, revision: 2 });
    assert.deepEqual(app.data().ddays, []); assert(app.window.hasPendingCloudChanges());
    const reloaded = environment(null, app.sharedStorage), next = json(reloaded.window.getCloudSaveRequest());
    const committed = Core.mergeData(next.base, next.data, request.data);
    reloaded.window.acknowledgeCloudSave(next, { data: committed, revision: 3 });
    assert.deepEqual(reloaded.data().ddays, []); assert(!reloaded.window.hasPendingCloudChanges());
    reloaded.window.updateFromCloud(request.data, 4);
    assert.deepEqual(reloaded.data().ddays, []); assert(reloaded.window.hasPendingCloudChanges());
});

test('D-day storage events combine additions and retain deletions against stale edits', () => {
    const source = fixture(); source.ddays = [{ id: 'DD_A', title: 'A', targetDate: '2026-12-01' }];
    const app = environment(source); app.click('deleteDday', { id: 'DD_A' });
    const base = Core.normalizeData(source), incoming = json(base);
    incoming.ddays[0].title = 'Stale edit'; incoming.ddays.push({ id: 'DD_B', title: 'New', targetDate: '2026-12-02' });
    incoming.courses[0].title = 'Tab B edit';
    app.emitWindow('storage', { key: 'daon-dashboard-v2', newValue: JSON.stringify({ data: incoming, base, pending: true, revision: 1 }) });
    assert.deepEqual(app.data().ddays.map(d => d.id), ['DD_B']); assert.equal(app.data().courses[0].title, 'Tab B edit');
    assert.deepEqual(environment(null, app.sharedStorage).data().ddays, app.data().ddays);
    const newBase = fixture(), another = json(newBase), additions = environment(newBase);
    addDday(additions); another.ddays.push({ id: 'DD_OTHER', title: 'Other tab', targetDate: '2026-12-02' });
    additions.emitWindow('storage', { key: 'daon-dashboard-v2', newValue: JSON.stringify({ data: another, base: newBase, pending: true, revision: 1 }) });
    assert.equal(additions.data().ddays.length, 2);
});

test('offline D-day additions and deletions survive mock Firebase retry, transaction rebase and reload', async () => {
    const source = fixture(); source.ddays = [{ id: 'DD_OLD', title: 'Old', targetDate: '2026-11-01' }];
    const app = environment(source); app.click('deleteDday', { id: 'DD_OLD' }); addDday(app, 'Offline new');
    const reloaded = environment(null, app.sharedStorage);
    const cloud = await connectMockCloud(reloaded, { failFirst: true, retryFirst: true, initialData: source });
    cloud.emit({ fromCache: true, hasPendingWrites: false }); await tick(); assert.equal(cloud.calls(), 0);
    cloud.emit({ fromCache: false, hasPendingWrites: false }); await tick(); assert(reloaded.window.hasPendingCloudChanges());
    await reloaded.window.triggerCloudSave();
    assert.deepEqual(cloud.data().ddays.map(d => d.title), ['Offline new']);
    assert(cloud.data()._deletedDdayIds.includes('DD_OLD'));
    assert(!reloaded.window.hasPendingCloudChanges());
    assert.deepEqual(environment(null, app.sharedStorage).data().ddays, cloud.data().ddays);
});

test('mock Firebase transaction retry preserves two concurrent D-day additions', async () => {
    const app = environment(); addDday(app, 'Local transaction');
    const cloud = await connectMockCloud(app, { retryFirst: true });
    cloud.emit({ fromCache: false, hasPendingWrites: false }); await tick();
    assert.deepEqual(cloud.data().ddays.map(d => d.title), ['Local transaction', 'Another client']);
    assert(!app.window.hasPendingCloudChanges());
});
