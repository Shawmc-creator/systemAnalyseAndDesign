// Fictional, device-local appointments for the course preview.
const storageKey = 'qinghe-course-appointments-v1';
const patientName = '陈晨（演示）';
const booked = '已预约';
const cancelled = '已取消';
const branches = [
  { id: 'a', name: '一店（演示）', detail: '上午可约', dentist: '许医生（演示）' },
  { id: 'b', name: '二店（演示）', detail: '上午、下午可约', dentist: '高医生（演示）' },
  { id: 'c', name: '三店（演示）', detail: '下午可约', dentist: '许医生（演示）' }
];
const reasons = ['口腔检查', '洁牙咨询', '复诊咨询', '牙痛检查', '正畸咨询', '修复咨询'];
const times = {
  a: ['09:00', '09:30', '10:00', '10:30', '11:00', '11:30'],
  b: ['09:30', '10:00', '10:30', '11:00', '14:00', '14:30', '15:00', '16:00'],
  c: ['14:00', '14:30', '15:00', '15:30', '16:00', '16:30']
};
const dayMilliseconds = 86400000;

function bookableDates(now = Date.now()) {
  const shanghai = now + 8 * 3600000;
  return Array.from({ length: 7 }, (_, index) =>
    new Date(shanghai + index * dayMilliseconds).toISOString().slice(0, 10));
}

function initialBookings() {
  return [
    { id: 'DEMO-001', branchId: 'b', date: '2026-10-20', time: '10:30', reason: '复诊咨询', status: booked },
    { id: 'DEMO-002', branchId: 'a', date: '2026-10-20', time: '09:00', reason: '口腔检查', status: cancelled }
  ];
}

function readBookings() {
  const saved = wx.getStorageSync(storageKey);
  const records = Array.isArray(saved) ? saved : initialBookings();
  const counters = {};
  return records.map(record => {
    const prefix = record.branchId.toUpperCase() + '-' + record.date.slice(5).replace('-', '') + '-';
    counters[prefix] = (counters[prefix] || 0) + 1;
    return { ...record, reference: prefix + String(counters[prefix]).padStart(3, '0') };
  });
}

function availableSlots(branchId, date, now = Date.now()) {
  if (!branches.some(branch => branch.id === branchId) || !bookableDates(now).includes(date)) return [];
  const occupied = readBookings().filter(record => record.status === booked && record.date === date);
  return times[branchId].filter(time =>
    Date.parse(date + 'T' + time + ':00+08:00') > now && !occupied.some(record => record.time === time));
}

function listBookings() {
  return readBookings().map(record => ({
    ...record, patientName,
    branchName: branches.find(branch => branch.id === record.branchId).name,
    dentist: branches.find(branch => branch.id === record.branchId).dentist
  })).sort((a, b) => {
    const statusOrder = Number(a.status === cancelled) - Number(b.status === cancelled);
    if (statusOrder) return statusOrder;
    return (a.date + a.time).localeCompare(b.date + b.time);
  });
}

function createBooking({ branchId, date, time, reason }) {
  if (!reasons.includes(reason)) throw new Error('请选择预约用途。');
  if (!availableSlots(branchId, date).includes(time)) {
    throw new Error('该时段已被占用或不可预约，请重新选择。');
  }
  const records = readBookings();
  const number = records.reduce((highest, record) => Math.max(highest, Number(record.id.slice(5))), 0) + 1;
  const record = { id: 'DEMO-' + String(number).padStart(3, '0'), branchId, date, time, reason, status: booked };
  wx.setStorageSync(storageKey, [...records, record]);
  return record;
}

function cancelBooking(id) {
  const records = readBookings();
  const index = records.findIndex(record => record.id === id);
  if (index < 0 || records[index].status !== booked) {
    throw new Error('这条预约已更新，请重新查看。');
  }
  records[index] = { ...records[index], status: cancelled };
  wx.setStorageSync(storageKey, records);
}

module.exports = { patientName, branches, bookableDates, reasons, availableSlots, listBookings, createBooking, cancelBooking };
