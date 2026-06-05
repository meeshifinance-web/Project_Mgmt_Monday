// ───────────────────────────────────────────────────────────────────────────
// A small, curated set of board templates — only the genuinely most-used ones
// (deliberately not monday's giant gallery). Each defines columns, groups and a
// few starter items so a new board is instantly usable.
//
// item.values is keyed by COLUMN INDEX → value (resolved to real column ids at
// build time). Person columns get the creator added as a selectable option.
// ───────────────────────────────────────────────────────────────────────────

const STATUS = (opts) => ({ options: opts });

const TEMPLATES = {
  project: {
    name: 'Project Management', icon: '📋',
    description: 'Plan work across phases with owners, priority and a timeline.',
    columns: [
      { title: 'Status', type: 'status', settings: STATUS([
        { label: 'Not Started', color: '#c4c4c4' }, { label: 'Working on it', color: '#fdab3d' },
        { label: 'Stuck', color: '#e2445c' }, { label: 'Done', color: '#00c875' },
      ]) },
      { title: 'Owner', type: 'person', settings: {} },
      { title: 'Priority', type: 'priority', settings: STATUS([
        { label: 'Critical', color: '#e2445c' }, { label: 'High', color: '#ff642e' },
        { label: 'Medium', color: '#fdab3d' }, { label: 'Low', color: '#00c875' },
      ]) },
      { title: 'Timeline', type: 'timeline', settings: {} },
      { title: 'Due Date', type: 'date', settings: {} },
    ],
    groups: [
      { name: 'To Do', color: '#0073ea', items: [
        { name: 'Define project scope', values: { 0: 'Working on it', 2: 'High' } },
        { name: 'Gather requirements', values: { 0: 'Not Started', 2: 'Medium' } },
      ] },
      { name: 'In Progress', color: '#fdab3d', items: [
        { name: 'Design mockups', values: { 0: 'Working on it', 2: 'High' } },
      ] },
      { name: 'Done', color: '#00c875', items: [
        { name: 'Project kickoff', values: { 0: 'Done', 2: 'Low' } },
      ] },
    ],
  },

  tasks: {
    name: 'Task Tracker', icon: '✅',
    description: 'A simple to-do list with owners and due dates.',
    columns: [
      { title: 'Status', type: 'status', settings: STATUS([
        { label: 'To Do', color: '#c4c4c4' }, { label: 'Doing', color: '#fdab3d' }, { label: 'Done', color: '#00c875' },
      ]) },
      { title: 'Owner', type: 'person', settings: {} },
      { title: 'Due Date', type: 'date', settings: {} },
    ],
    groups: [
      { name: 'This Week', color: '#0073ea', items: [
        { name: 'Task 1', values: { 0: 'To Do' } },
        { name: 'Task 2', values: { 0: 'Doing' } },
        { name: 'Task 3', values: { 0: 'Done' } },
      ] },
      { name: 'Next Week', color: '#a25ddc', items: [
        { name: 'Task 4', values: { 0: 'To Do' } },
      ] },
    ],
  },

  crm: {
    name: 'Sales CRM', icon: '💰',
    description: 'Track deals through your pipeline with values and contacts.',
    columns: [
      { title: 'Stage', type: 'status', settings: STATUS([
        { label: 'New Lead', color: '#579bfc' }, { label: 'Qualified', color: '#a25ddc' },
        { label: 'Proposal', color: '#fdab3d' }, { label: 'Negotiation', color: '#ff642e' },
        { label: 'Won', color: '#00c875' }, { label: 'Lost', color: '#e2445c' },
      ]) },
      { title: 'Owner', type: 'person', settings: {} },
      { title: 'Company', type: 'text', settings: {} },
      { title: 'Deal Value', type: 'number', settings: {} },
      { title: 'Contact', type: 'email', settings: {} },
      { title: 'Expected Close', type: 'date', settings: {} },
    ],
    groups: [
      { name: 'Active Deals', color: '#0073ea', items: [
        { name: 'Acme Corp', values: { 0: 'Qualified', 3: '50000' } },
        { name: 'Globex Inc', values: { 0: 'Proposal', 3: '120000' } },
      ] },
      { name: 'Closed', color: '#00c875', items: [
        { name: 'Initech', values: { 0: 'Won', 3: '80000' } },
      ] },
    ],
  },

  bugs: {
    name: 'Bug Tracking', icon: '🐞',
    description: 'Log, prioritise and resolve issues.',
    columns: [
      { title: 'Status', type: 'status', settings: STATUS([
        { label: 'New', color: '#579bfc' }, { label: 'In Progress', color: '#fdab3d' },
        { label: 'Fixed', color: '#00c875' }, { label: "Won't Fix", color: '#c4c4c4' },
      ]) },
      { title: 'Priority', type: 'priority', settings: STATUS([
        { label: 'Critical', color: '#e2445c' }, { label: 'High', color: '#ff642e' },
        { label: 'Medium', color: '#fdab3d' }, { label: 'Low', color: '#00c875' },
      ]) },
      { title: 'Assignee', type: 'person', settings: {} },
      { title: 'Reported', type: 'date', settings: {} },
    ],
    groups: [
      { name: 'Open Bugs', color: '#e2445c', items: [
        { name: 'Login button not working', values: { 0: 'New', 1: 'High' } },
        { name: 'Slow page load on mobile', values: { 0: 'In Progress', 1: 'Medium' } },
      ] },
      { name: 'Resolved', color: '#00c875', items: [
        { name: 'Typo on homepage', values: { 0: 'Fixed', 1: 'Low' } },
      ] },
    ],
  },

  content: {
    name: 'Content Calendar', icon: '🗓️',
    description: 'Plan and publish content across channels.',
    columns: [
      { title: 'Status', type: 'status', settings: STATUS([
        { label: 'Idea', color: '#c4c4c4' }, { label: 'Writing', color: '#fdab3d' },
        { label: 'Review', color: '#a25ddc' }, { label: 'Published', color: '#00c875' },
      ]) },
      { title: 'Owner', type: 'person', settings: {} },
      { title: 'Channel', type: 'dropdown', settings: STATUS([
        { label: 'Blog', color: '#0073ea' }, { label: 'Instagram', color: '#e2445c' },
        { label: 'LinkedIn', color: '#0086c0' }, { label: 'Newsletter', color: '#00c875' },
      ]) },
      { title: 'Publish Date', type: 'date', settings: {} },
    ],
    groups: [
      { name: 'This Month', color: '#0073ea', items: [
        { name: 'Product launch announcement', values: { 0: 'Writing' } },
        { name: 'Customer success story', values: { 0: 'Idea' } },
      ] },
    ],
  },
};

// Lightweight list for the picker (no specs).
function listTemplates() {
  return [
    { key: 'blank', name: 'Blank Board', icon: '➕', description: 'Start from scratch.' },
    ...Object.entries(TEMPLATES).map(([key, t]) => ({ key, name: t.name, icon: t.icon, description: t.description })),
  ];
}

function getTemplate(key) {
  return TEMPLATES[key] || null;
}

module.exports = { TEMPLATES, listTemplates, getTemplate };
