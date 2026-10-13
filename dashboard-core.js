(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.DashboardCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';
    const collections = ['courses', 'lectures', 'dailyRecords', 'ddays'];
    const collator = new Intl.Collator('ko', { numeric: true, sensitivity: 'base' });
    const isObject = value => value !== null && Object.prototype.toString.call(value) === '[object Object]';
    const clone = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
    const emptyData = () => ({ courses: [], lectures: [], dailyRecords: [], ddays: [] });
    function equal(a, b) {
        if (a === b) return true;
        if (Array.isArray(a) || Array.isArray(b)) return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((item, index) => equal(item, b[index]));
        if (!isObject(a) || !isObject(b)) return false;
        const aKeys = Object.keys(a).sort(), bKeys = Object.keys(b).sort();
        return aKeys.length === bKeys.length && aKeys.every((key, index) => key === bKeys[index] && equal(a[key], b[key]));
    }
    function assert(condition, message) { if (!condition) throw new TypeError(message); }
    function validId(value) { return typeof value === 'string' && /^[A-Za-z0-9_-]+$/.test(value); }
    function validDate(value) {
        if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
        const [year, month, day] = value.split('-').map(Number);
        const date = new Date(0); date.setUTCHours(0, 0, 0, 0); date.setUTCFullYear(year, month - 1, day);
        return year >= 1 && date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
    }
    function validateData(input) {
        assert(isObject(input), 'Dashboard data must be an object.');
        for (const key of ['courses', 'lectures', 'dailyRecords']) assert(Array.isArray(input[key]), key + ' must be an array.');
        assert(input.ddays === undefined || Array.isArray(input.ddays), 'ddays must be an array.');
        // Optional sync metadata; old JSON backups need no migration.
        assert(input._deletedDdayIds === undefined || (Array.isArray(input._deletedDdayIds) && input._deletedDdayIds.every(validId)), 'Invalid D-day deletion IDs.');
        const ids = new Set(), taskIds = new Set(), dates = new Set();
        function entity(item, label) {
            assert(isObject(item) && validId(item.id), label + ' must have a safe, nonempty ID.');
            assert(!ids.has(item.id), 'Duplicate ID: ' + item.id); ids.add(item.id);
        }
        function text(value, label) { assert(typeof value === 'string', label + ' must be text.'); }
        function duration(item, key) {
            if (item[key] !== undefined) assert(typeof item[key] === 'number' && Number.isFinite(item[key]) && item[key] >= 0, key + ' must be a nonnegative number.');
        }
        input.courses.forEach(course => {
            entity(course, 'Course'); text(course.title, 'Course title'); text(course.subject, 'Subject');
            assert(course.color === undefined || course.color === '' || (typeof course.color === 'string' && /^#(?:[\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/i.test(course.color)), 'Invalid course color.');
        });
        const courseIds = new Set(input.courses.map(course => course.id));
        input.lectures.forEach(lecture => {
            entity(lecture, 'Lecture'); assert(validId(lecture.courseId) && courseIds.has(lecture.courseId), 'Invalid parent course ID.'); text(lecture.title, 'Lecture title');
            if (lecture.status !== undefined) text(lecture.status, 'Lecture status');
            duration(lecture, 'duration');
        });
        input.dailyRecords.forEach(record => {
            entity(record, 'Daily record'); assert(validDate(record.date), 'Invalid daily date.');
            assert(!dates.has(record.date), 'Duplicate daily date.'); dates.add(record.date);
            assert(Array.isArray(record.tasks), 'Daily tasks must be an array.');
            record.tasks.forEach(task => {
                assert(isObject(task) && validId(task.id) && !taskIds.has(task.id), 'Invalid or duplicate task ID.'); taskIds.add(task.id);
                assert(['lecture', 'study', 'general', 'event'].includes(task.type), 'Invalid task type.'); text(task.title, 'Task title');
                assert(task.completed === undefined || typeof task.completed === 'boolean', 'Task completion must be boolean.');
                assert(task.refId === undefined || task.refId === null || validId(task.refId), 'Invalid lecture reference.');
                duration(task, 'time');
            });
        });
        (input.ddays || []).forEach(dday => {
            entity(dday, 'D-day'); text(dday.title, 'D-day title'); assert(validDate(dday.targetDate), 'Invalid D-day date.');
        });
        const data = clone(input); data.ddays = data.ddays || [];
        return data;
    }
    function parseLectureTitle(value) {
        const title = String(value || '').trim().replace(/\s+/g, ' ');
        const patterns = [
            /^(?:제\s*)?(\d+)(?:\s*[-~–—]\s*(\d+))?\s*강\s*[:.\-–—]?\s*(.*)$/i,
            /^(?:lecture|lec\.?|lesson)\s*#?\s*(\d+)(?:\s*[-~–—]\s*(\d+))?\s*(?:[.:)\-–—]\s*)?(.*)$/i,
            /^(\d+)(?:\s*[-~–—]\s*(\d+))?\s*[.):]\s*(.*)$/
        ];
        for (const pattern of patterns) {
            const match = title.match(pattern);
            if (!match) continue;
            const number = Number(match[1]), endNumber = match[2] === undefined ? null : Number(match[2]);
            if (!Number.isSafeInteger(number) || (endNumber !== null && (!Number.isSafeInteger(endNumber) || endNumber < number))) break;
            return { number, endNumber, description: match[3].trim() };
        }
        if (/^(?:OT|오리엔테이션)(?=$|[\s:.(\-])/i.test(title)) return { number: 0, endNumber: null, description: title.replace(/^ot\b/i, 'OT') };
        return { number: null, endNumber: null, description: title };
    }
    function formatLectureTitle(number, endNumber, description) {
        assert(Number.isSafeInteger(number) && number >= 0, 'Invalid lecture number.');
        assert(endNumber === null || endNumber === undefined || (Number.isSafeInteger(endNumber) && endNumber >= number), 'Invalid lecture range.');
        const range = endNumber !== null && endNumber !== undefined && endNumber !== number ? number + '-' + endNumber : String(number);
        const title = String(description || '').trim().replace(/\s+/g, ' ');
        return range + '강' + (title ? ' ' + title : '');
    }
    function compareLectures(a, b) {
        const first = parseLectureTitle(a.title), second = parseLectureTitle(b.title);
        const aNumber = first.number ?? Infinity, bNumber = second.number ?? Infinity;
        if (aNumber !== bNumber) return aNumber < bNumber ? -1 : 1;
        const aEnd = first.endNumber ?? aNumber, bEnd = second.endNumber ?? bNumber;
        if (aEnd !== bEnd) return aEnd < bEnd ? -1 : 1;
        return collator.compare(a.title, b.title) || String(a.id).localeCompare(String(b.id));
    }
    function normalizeData(input) {
        const data = validateData(input);
        const aliases = { '수학': 'Mathematics', '수학 (Mathematics)': 'Mathematics', '물리': 'Physics', '영어': 'English', '화학': 'Chemistry', '기타': 'General' };
        data.courses.forEach(course => { course.subject = aliases[course.subject] || course.subject; if (!['Mathematics', 'Physics', 'English', 'Chemistry', 'General'].includes(course.subject)) course.subject = 'General'; });
        data.lectures.forEach(lecture => {
            const parsed = parseLectureTitle(lecture.title);
            if (parsed.number !== null) lecture.title = formatLectureTitle(parsed.number, parsed.endNumber, parsed.description);
            lecture.status = lecture.status === '완료' || lecture.status === 'Completed' ? '완료' : '미시작';
        });
        data.lectures.sort((a, b) => a.courseId.localeCompare(b.courseId) || compareLectures(a, b));
        const lectures = new Map(data.lectures.map(lecture => [lecture.id, lecture]));
        data.dailyRecords.forEach(record => record.tasks.forEach(task => {
            if (task.type === 'event') task.type = 'general';
            task.completed = task.completed === true;
            const lecture = task.type === 'lecture' && task.refId ? lectures.get(task.refId) : null;
            if (lecture) task.completed = lecture.status === '완료';
        }));
        data.dailyRecords.sort((a, b) => a.date.localeCompare(b.date));
        if (data._deletedDdayIds !== undefined) {
            data._deletedDdayIds = [...new Set(data._deletedDdayIds)].sort();
            const deleted = new Set(data._deletedDdayIds);
            data.ddays = data.ddays.filter(dday => !deleted.has(dday.id));
        }
        data.ddays.sort((a, b) => a.targetDate.localeCompare(b.targetDate) || a.id.localeCompare(b.id));
        return data;
    }
    function mergeValue(base, local, remote) {
        if (equal(local, base)) return clone(remote);
        if (equal(remote, base) || equal(local, remote)) return clone(local);
        // Preserve an edited entity when the other client deleted its old version.
        if (local === undefined) return clone(remote);
        if (remote === undefined) return clone(local);
        if (isObject(local) && isObject(remote) && (base === undefined || isObject(base))) {
            const entries = [];
            for (const key of new Set([...Object.keys(base || {}), ...Object.keys(remote), ...Object.keys(local)])) {
                const value = mergeValue(base?.[key], local[key], remote[key]);
                if (value !== undefined) entries.push([key, value]);
            }
            return Object.fromEntries(entries);
        }
        return clone(local);
    }
    function mergeEntities(base, local, remote, key) {
        if (equal(local, base)) return clone(remote);
        if (equal(remote, base) || equal(local, remote)) return clone(local);
        const index = items => new Map(items.map(item => [item[key], item]));
        const b = index(base), l = index(local), r = index(remote);
        const output = [];
        for (const id of new Set([...remote.map(item => item[key]), ...local.map(item => item[key]), ...base.map(item => item[key])])) {
            const item = mergeValue(b.get(id), l.get(id), r.get(id));
            if (item !== undefined) output.push(item);
        }
        return output;
    }
    function splitDaily(records) {
        const shells = [], tasks = [];
        records.forEach(record => {
            const { tasks: entries, ...shell } = record; shells.push(shell);
            entries.forEach((task, order) => tasks.push({ id: task.id, task, date: record.date, order }));
        });
        return { shells, tasks };
    }
    function mergeData(baseInput, localInput, remoteInput) {
        const base = normalizeData(baseInput), local = normalizeData(localInput), remote = normalizeData(remoteInput);
        // Retain deletions even after an acknowledgment or a stale client's new snapshot.
        // D-day IDs are never reused; these tombstones stay in the same data/backup/outbox.
        const deleted = new Set([...(base._deletedDdayIds || []), ...(local._deletedDdayIds || []), ...(remote._deletedDdayIds || [])]);
        const localIds = new Set(local.ddays.map(item => item.id)), remoteIds = new Set(remote.ddays.map(item => item.id));
        base.ddays.forEach(item => { if (!localIds.has(item.id) || !remoteIds.has(item.id)) deleted.add(item.id); });
        const finish = data => normalizeData(deleted.size ? { ...data, _deletedDdayIds: [...deleted] } : data);
        if (equal(local, base)) return finish(remote);
        if (equal(remote, base) || equal(local, remote)) return finish(local);
        const extras = data => Object.fromEntries(Object.entries(data).filter(([key]) => !collections.includes(key) && key !== '_deletedDdayIds'));
        const merged = { ...mergeValue(extras(base), extras(local), extras(remote)),
            courses: mergeEntities(base.courses, local.courses, remote.courses, 'id'),
            lectures: mergeEntities(base.lectures, local.lectures, remote.lectures, 'id'),
            ddays: mergeEntities(base.ddays, local.ddays, remote.ddays, 'id'), dailyRecords: [] };
        const b = splitDaily(base.dailyRecords), l = splitDaily(local.dailyRecords), r = splitDaily(remote.dailyRecords);
        const shells = mergeEntities(b.shells, l.shells, r.shells, 'date');
        const tasks = mergeEntities(b.tasks, l.tasks, r.tasks, 'id');
        const records = new Map(shells.map(shell => [shell.date, { ...shell, tasks: [] }]));
        const fallback = new Map([...b.shells, ...r.shells, ...l.shells].map(shell => [shell.date, shell]));
        tasks.sort((a, b) => a.date.localeCompare(b.date) || a.order - b.order || a.id.localeCompare(b.id)).forEach(entry => {
            if (!records.has(entry.date)) records.set(entry.date, { ...(fallback.get(entry.date) || { id: 'D_' + entry.date.replace(/-/g, ''), date: entry.date }), tasks: [] });
            records.get(entry.date).tasks.push(entry.task);
        });
        merged.dailyRecords = [...records.values()];
        // A concurrent lecture addition/edit must not be hidden by deleting its parent course.
        const courseIds = new Set(merged.courses.map(course => course.id));
        const parents = new Map([...base.courses, ...remote.courses, ...local.courses].map(course => [course.id, course]));
        merged.lectures.forEach(lecture => {
            if (!courseIds.has(lecture.courseId) && parents.has(lecture.courseId)) {
                merged.courses.push(clone(parents.get(lecture.courseId)));
                courseIds.add(lecture.courseId);
            }
        });
        return finish(merged);
    }
    return { emptyData, clone, equal, validDate, validateData, normalizeData, parseLectureTitle, formatLectureTitle, compareLectures, mergeData };
});
