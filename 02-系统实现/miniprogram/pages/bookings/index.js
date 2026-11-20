const bookings = require('../../services/patient-booking');

Page({
  data: {
    records: [], loading: false, cancellingId: '', error: '',
    storageLabel: bookings.local ? '与本机前台共用的虚构预约' :
      bookings.connected ? '与演示前台共用的虚构预约' : '本机保存的虚构预约'
  },

  onShow() {
    this.refreshBookings();
  },

  async refreshBookings() {
    if (this.data.loading) return;
    this.setData({ loading: true, error: '' });
    try {
      this.setData({ records: await bookings.listBookings() });
    } catch (error) {
      this.setData({ error: error.message, records: [] });
    } finally {
      this.setData({ loading: false });
    }
  },

  openAppointment() {
    wx.switchTab({ url: '/pages/appointment/index' });
  },

  confirmCancellation(event) {
    const record = this.data.records.find(item => item.id === event.currentTarget.dataset.id);
    if (this.data.loading || this.data.cancellingId || !record) return;
    this.setData({ cancellingId: record.id, error: '' });
    wx.showModal({
      title: '取消预约',
      content: '取消后，该时段可重新预约。',
      confirmText: '取消预约',
      cancelText: '保留预约',
      confirmColor: '#086652',
      success: async result => {
        if (!result.confirm) {
          this.setData({ cancellingId: '' });
          return;
        }
        try {
          await bookings.cancelBooking(record);
          await this.refreshBookings();
          wx.showToast({ title: '预约已取消', icon: 'success' });
        } catch (error) {
          await this.refreshBookings();
          this.setData({ error: error.message || '暂时无法取消预约，请重试。' });
        } finally {
          this.setData({ cancellingId: '' });
        }
      },
      fail: () => this.setData({ cancellingId: '' })
    });
  }
});
