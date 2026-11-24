const bookings = require('../../services/patient-booking');
const { bookingDays } = require('../../services/booking-calendar');

Page({
  data: {
    modeLabel: bookings.modeLabel, online: bookings.online, signedIn: false, patientName: '',
    branches: [], slots: [], reasons: [], days: [], months: [], weekdays: '一二三四五六日'.split(''),
    branchId: '', branchName: '', month: '', date: '', time: '', doctors: [], chosenDoctor: '',
    reasonIndex: -1, loading: false, saving: false, error: ''
  },

  onShow() {
    if (bookings.signedIn()) this.refreshOptions();
  },

  async login() {
    if (this.data.loading) return;
    this.setData({ loading: true, error: '' });
    try {
      await bookings.signIn();
      this.setData({ signedIn: true });
    } catch (error) {
      this.setData({ error: error.message });
    } finally {
      this.setData({ loading: false });
    }
    if (this.data.signedIn) await this.refreshOptions();
  },

  async refreshOptions() {
    if (this.data.loading || this.data.saving) return;
    this.setData({ loading: true, error: '' });
    try {
      this.options = await bookings.getOptions();
      const { branches, reasons, patientName } = this.options;
      const branch = branches.find(item => item.id === this.data.branchId) || branches[0];
      this.setData({ signedIn: true, branches, reasons, patientName });
      if (branch) this.selectBranch(branch);
    } catch (error) {
      this.setData({ branches: [], error: error.message });
    } finally {
      this.setData({ loading: false });
    }
  },

  selectBranch(branch) {
    this.branchSlots = this.options.slots.filter(slot => slot.branchId === branch.id);
    this.availableDates = [...new Set(this.branchSlots.map(slot => slot.date))].sort();
    const months = [...new Set([this.options.now.slice(0, 7), ...this.availableDates.map(day => day.slice(0, 7))])].sort();
    const month = this.options.now.slice(0, 7);
    this.setData({ branchId: branch.id, branchName: branch.name, months, hasAvailability: this.availableDates.length > 0, error: '' });
    this.selectMonth(month);
  },

  selectMonth(month) {
    const calendar = bookingDays(month, this.availableDates);
    const index = this.data.months.indexOf(month);
    this.setData({ month, monthTitle: calendar.title, days: calendar.days, previousMonth: index > 0,
      nextMonth: index < this.data.months.length - 1, date: '', time: '', slots: [], doctors: [], chosenDoctor: '' });
  },

  chooseBranch(event) {
    if (this.data.loading || this.data.saving) return;
    const branch = this.data.branches.find(item => item.id === event.currentTarget.dataset.id);
    if (branch && branch.id !== this.data.branchId) this.selectBranch(branch);
  },

  changeMonth(event) {
    if (this.data.saving) return;
    const index = this.data.months.indexOf(this.data.month) + Number(event.currentTarget.dataset.delta);
    if (this.data.months[index]) this.selectMonth(this.data.months[index]);
  },

  chooseDate(event) {
    if (this.data.saving) return;
    const date = event.currentTarget.dataset.date;
    if (!this.availableDates.includes(date) || date === this.data.date) return;
    const slots = [...new Set(this.branchSlots.filter(slot => slot.date === date).map(slot => slot.time))].sort();
    this.setData({ date, slots, time: '', doctors: [], chosenDoctor: '', error: '' });
  },

  chooseTime(event) {
    if (this.data.saving) return;
    const time = event.currentTarget.dataset.time;
    const doctors = this.branchSlots.filter(slot => slot.date === this.data.date && slot.time === time);
    this.setData({ time, doctors, chosenDoctor: '', error: '' });
  },

  chooseDoctor(event) {
    if (!this.data.saving) this.setData({ chosenDoctor: event.currentTarget.dataset.id });
  },

  chooseReason(event) {
    this.setData({ reasonIndex: Number(event.detail.value) });
  },

  async submitBooking() {
    if (this.data.loading || this.data.saving) return;
    const slot = this.data.doctors.find(item => item.id === this.data.chosenDoctor);
    const reason = this.data.reasons[this.data.reasonIndex];
    if (!slot || !reason) return;
    this.setData({ saving: true, error: '' });
    try {
      await bookings.createBooking(slot, reason);
      this.setData({ chosenDoctor: '', time: '' });
      wx.showToast({ title: '预约成功', icon: 'success' });
      wx.switchTab({ url: '/pages/bookings/index' });
    } catch (error) {
      this.setData({ saving: false });
      await this.refreshOptions();
      this.setData({ error: error.message || '暂时无法保存预约，请重试。' });
    } finally {
      this.setData({ saving: false });
    }
  }
});
