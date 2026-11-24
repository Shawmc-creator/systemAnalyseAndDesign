'use strict';

function bookingDays(month, availableDays) {
  const [year, index] = month.split('-').map(Number);
  const offset = (new Date(Date.UTC(year, index - 1, 1)).getUTCDay() + 6) % 7;
  const count = new Date(Date.UTC(year, index, 0)).getUTCDate();
  const days = Array.from({ length: offset }, (_, i) => ({ date: 'blank-' + i }));
  for (let day = 1; day <= count; day++) {
    const date = month + '-' + String(day).padStart(2, '0');
    days.push({ date, day, available: availableDays.includes(date) });
  }
  return { title: year + '年' + index + '月', days };
}

if (typeof module !== 'undefined') module.exports = { bookingDays };
