const bookings = require('../../services/patient-booking');

Page({
  data: {
    modeLabel: bookings.modeLabel,
    branches: [], dates: [], slots: [],
    reasons: bookings.reasons,
    branchId: '', branchName: '', date: '', selectedSlotId: '', time: '',
    reasonIndex: 0, loading: false, saving: false, error: ''
  },

  onShow() {
    this.refreshOptions();
  },

  async refreshOptions() {
    if (this.data.loading || this.data.saving) return;
    this.setData({ loading: true, error: '', selectedSlotId: '', time: '' });
    try {
      const options = await bookings.getOptions();
      this.options = options;
      const preferred = bookings.connected ? '2' : 'b';
      const branch = options.branches.find(item => item.id === (this.data.branchId || preferred)) || options.branches[0];
      const date = options.dates.some(item => item.value === this.data.date) ? this.data.date : options.dates[0]?.value;
      this.setData({ branches: options.branches, dates: options.dates, branchId: branch?.id || '', branchName: branch?.name || '', date: date || '' });
      this.updateSlots();
    } catch (error) {
      this.options = null;
      this.setData({ branches: [], dates: [], slots: [], error: error.message });
    } finally {
      this.setData({ loading: false });
    }
  },

  updateSlots() {
    const { branchId, date } = this.data;
    const slots = (this.options?.slots || []).filter(slot => slot.branchId === branchId && slot.date === date);
    this.setData({ slots, selectedSlotId: '', time: '' });
  },

  chooseBranch(event) {
    if (this.data.loading || this.data.saving) return;
    const branch = this.data.branches.find(item => item.id === event.currentTarget.dataset.id);
    if (!branch || branch.id === this.data.branchId) return;
    this.setData({ branchId: branch.id, branchName: branch.name, error: '' });
    this.updateSlots();
  },

  chooseDate(event) {
    if (this.data.loading || this.data.saving) return;
    const date = event.currentTarget.dataset.date;
    if (date === this.data.date) return;
    this.setData({ date, error: '' });
    this.updateSlots();
  },

  chooseTime(event) {
    if (this.data.loading || this.data.saving) return;
    const slot = this.data.slots.find(item => item.id === event.currentTarget.dataset.id);
    if (slot) this.setData({ selectedSlotId: slot.id, time: slot.time, error: '' });
  },

  chooseReason(event) {
    this.setData({ reasonIndex: Number(event.detail.value) });
  },

  async submitBooking() {
    if (this.data.loading || this.data.saving) return;
    const slot = this.data.slots.find(item => item.id === this.data.selectedSlotId);
    if (!slot) return;
    this.setData({ saving: true, error: '' });
    try {
      await bookings.createBooking(slot, bookings.reasons[this.data.reasonIndex]);
      this.setData({ selectedSlotId: '', time: '' });
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
