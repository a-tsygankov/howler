// Mock data shared by all mockups
window.HOWLER_DATA = (function () {
  const labels = [
    { id: 'l-pets',     name: 'Pets',     color: '#C77A2A', icon: 'paw' },
    { id: 'l-chores',   name: 'Chores',   color: '#6F8AA1', icon: 'broom' },
    { id: 'l-personal', name: 'Personal', color: '#8A5B7A', icon: 'heart' },
    { id: 'l-work',     name: 'Work',     color: '#6E8A5C', icon: 'briefcase' },
    { id: 'l-health',   name: 'Health',   color: '#B25A55', icon: 'pill' },
  ];

  const users = [
    { id: 'u1', name: 'Alex',  initials: 'AX', color: '#C77A2A' },
    { id: 'u2', name: 'Sam',   initials: 'SM', color: '#6E8A5C' },
    { id: 'u3', name: 'Jules', initials: 'JL', color: '#8A5B7A' },
  ];

  const resultTypes = [
    { id: 'rt-count',  name: 'Count',   unit: 'times', min: 0, max: null, step: 1,   default: null, useLast: 1 },
    { id: 'rt-grams',  name: 'Grams',   unit: 'gr',    min: 0, max: null, step: 10,  default: 50,   useLast: 1 },
    { id: 'rt-min',    name: 'Minutes', unit: 'min',   min: 0, max: 240,  step: 5,   default: null, useLast: 1 },
    { id: 'rt-rating', name: 'Rating',  unit: 'star',  min: 1, max: 5,    step: 1,   default: null, useLast: 0 },
    { id: 'rt-pct',    name: 'Percent', unit: '%',     min: 0, max: 100,  step: 5,   default: null, useLast: 1 },
  ];

  // urgency 0..3
  const tasks = [
    { id: 't1', title: 'Feed Mochi',     desc: 'Wet food, half can',  label: 'l-pets',   kind: 'DAILY',    priority: 2, due: '08:00', urgency: 2, assignees: ['u1'], photo: 'mochi', resultType: 'rt-grams' },
    { id: 't2', title: 'Take vitamins',  desc: 'Multi + D3',          label: 'l-health', kind: 'DAILY',    priority: 1, due: '09:00', urgency: 1, assignees: ['u1','u2'], initials: 'V', resultType: null },
    { id: 't3', title: 'Water plants',   desc: 'Living-room ferns',   label: 'l-chores', kind: 'PERIODIC', priority: 1, due: 'today',  urgency: 2, assignees: ['u2'], photo: 'fern',  resultType: 'rt-count' },
    { id: 't4', title: 'Pushups',        desc: 'Morning set',         label: 'l-personal', kind: 'DAILY',  priority: 1, due: '07:30', urgency: 0, assignees: ['u1'], initials: 'PU', resultType: 'rt-count' },
    { id: 't5', title: 'Trash out',      desc: 'Tuesday + Friday',    label: 'l-chores', kind: 'PERIODIC', priority: 2, due: 'tonight', urgency: 3, assignees: ['u3'], initials: 'TR', resultType: null },
    { id: 't6', title: 'Reply to landlord', desc: 'Lease renewal',    label: 'l-personal', kind: 'ONESHOT', priority: 2, due: 'Fri',  urgency: 1, assignees: ['u1'], initials: 'LL', resultType: null },
    { id: 't7', title: 'Walk Coda',      desc: '20 min minimum',      label: 'l-pets',   kind: 'DAILY',    priority: 2, due: '17:30', urgency: 1, assignees: ['u2','u3'], photo: 'dog',   resultType: 'rt-min' },
    { id: 't8', title: 'Meditate',       desc: '',                    label: 'l-personal', kind: 'DAILY', priority: 0, due: '21:00', urgency: 0, assignees: ['u1'], initials: 'M',  resultType: 'rt-min' },
    { id: 't9', title: 'Standup',        desc: 'Engineering',         label: 'l-work',   kind: 'DAILY',    priority: 1, due: '10:00', urgency: 1, assignees: ['u1'], initials: 'ST', resultType: null },
    { id: 't10', title: 'Litter box',    desc: 'Scoop + change pad',  label: 'l-pets',   kind: 'PERIODIC', priority: 2, due: 'today', urgency: 2, assignees: ['u2'], initials: 'LB', resultType: null },
  ];

  // execution history sample
  const executions = [
    { id: 'e1', taskId: 't1', date: '2026-05-06 08:04', user: 'u1', value: 50, unit: 'gr', notes: '' },
    { id: 'e2', taskId: 't1', date: '2026-05-05 08:11', user: 'u2', value: 50, unit: 'gr', notes: 'extra hungry' },
    { id: 'e3', taskId: 't1', date: '2026-05-04 07:58', user: 'u1', value: 40, unit: 'gr', notes: '' },
    { id: 'e4', taskId: 't1', date: '2026-05-03 08:22', user: 'u1', value: 50, unit: 'gr', notes: '' },
    { id: 'e5', taskId: 't1', date: '2026-05-02 08:01', user: 'u2', value: 50, unit: 'gr', notes: '' },
    { id: 'e6', taskId: 't1', date: '2026-05-01 08:14', user: 'u1', value: 50, unit: 'gr', notes: '' },
    { id: 'e7', taskId: 't1', date: '2026-04-30 08:09', user: 'u1', value: 60, unit: 'gr', notes: 'vet said increase' },
  ];

  return { labels, users, resultTypes, tasks, executions };
})();
