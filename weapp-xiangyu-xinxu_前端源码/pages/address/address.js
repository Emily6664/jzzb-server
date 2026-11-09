// pages/address/address.js —— 收货地址管理
//
// 地址是**本地数据**：存在 storage（键 MY_ADDRESSES），不走后端接口。
// 支持两种录入方式：
//   1. 手动填写（姓名 / 手机 / 地区 / 详细地址）
//   2. 一键导入微信地址（wx.chooseAddress）

const { get, set } = require('../../utils/storage');

const DEFAULT_UI_MODE = 'normal';
const UI_MODE_TEXT = { normal: '普通模式', elder: '长辈大字', child: '儿童简易' };

const ADDRESS_KEY = 'MY_ADDRESSES';
const ADDRESS_LIMIT = 20;

// 新地址的初始表单
const EMPTY_FORM = {
  addressId: '',
  name: '',
  phone: '',
  region: [],
  detail: '',
  isDefault: false
};

Page({
  data: {
    uiMode: DEFAULT_UI_MODE,
    uiModeClass: '',
    uiModeText: UI_MODE_TEXT[DEFAULT_UI_MODE],

    list: [],
    showForm: false,
    form: Object.assign({}, EMPTY_FORM),
    regionText: '',
    submitting: false
  },

  onShow() {
    this.syncConfig();
    this.loadList();
  },

  /** 弹层内部点击不冒泡到遮罩 */
  stopBubble() {},

  /** 遮罩上禁止滚动穿透 */
  noop() {},

  syncConfig() {
    const app = getApp();
    const globalData = (app && app.globalData) || {};
    const uiMode = globalData.uiMode || DEFAULT_UI_MODE;

    this.setData({
      uiMode: uiMode,
      uiModeClass: uiMode === 'normal' ? '' : 'ui-mode-' + uiMode,
      uiModeText: UI_MODE_TEXT[uiMode] || UI_MODE_TEXT[DEFAULT_UI_MODE]
    });
  },

  /* ==================== 列表 ==================== */

  loadList() {
    const raw = get(ADDRESS_KEY, []) || [];

    const list = raw.map((item) => ({
      addressId: item.addressId,
      name: item.name,
      phone: item.phone,
      region: item.region || [],
      regionText: (item.region || []).join(' '),
      detail: item.detail,
      isDefault: !!item.isDefault
    }));

    this.setData({ list: list });
  },

  persist(list) {
    const ok = set(ADDRESS_KEY, list);
    if (!ok) wx.showToast({ title: '保存失败，请重试', icon: 'none' });
    this.loadList();
  },

  /* ==================== 表单 ==================== */

  onAdd() {
    this.setData({
      showForm: true,
      form: Object.assign({}, EMPTY_FORM, { isDefault: this.data.list.length === 0 }),
      regionText: ''
    });
  },

  onEdit(e) {
    const addressId = e.currentTarget.dataset.id;
    const hit = (get(ADDRESS_KEY, []) || []).filter((item) => item.addressId === addressId)[0];
    if (!hit) return;

    this.setData({
      showForm: true,
      form: {
        addressId: hit.addressId,
        name: hit.name,
        phone: hit.phone,
        region: hit.region || [],
        detail: hit.detail,
        isDefault: !!hit.isDefault
      },
      regionText: (hit.region || []).join(' ')
    });
  },

  onCancelForm() {
    this.setData({ showForm: false, form: Object.assign({}, EMPTY_FORM), regionText: '' });
  },

  /** 表单输入：字段名走 data-field */
  onInput(e) {
    const field = e.currentTarget.dataset.field;
    if (!field) return;

    const form = Object.assign({}, this.data.form);
    form[field] = e.detail.value;

    this.setData({ form: form });
  },

  onRegionChange(e) {
    const region = e.detail.value || [];

    const form = Object.assign({}, this.data.form);
    form.region = region;

    this.setData({ form: form, regionText: region.join(' ') });
  },

  onDefaultChange(e) {
    const form = Object.assign({}, this.data.form);
    form.isDefault = !!e.detail.value;

    this.setData({ form: form });
  },

  /** 一键导入微信收货地址 */
  onWechatAddress() {
    if (typeof wx.chooseAddress !== 'function') {
      wx.showToast({ title: '当前环境不支持微信地址', icon: 'none' });
      return;
    }

    wx.chooseAddress({
      success: (res) => {
        const region = [res.provinceName, res.cityName, res.countyName].filter((v) => !!v);

        this.setData({
          showForm: true,
          regionText: region.join(' '),
          form: {
            addressId: this.data.form.addressId || '',
            name: res.userName || '',
            phone: res.telNumber || '',
            region: region,
            detail: res.detailInfo || '',
            isDefault: this.data.form.isDefault || this.data.list.length === 0
          }
        });

        wx.showToast({ title: '已导入，请确认后保存', icon: 'none' });
      },
      fail: (err) => {
        const msg = (err && err.errMsg) || '';
        if (msg.indexOf('cancel') > -1) return;
        wx.showToast({ title: '未授权使用微信地址', icon: 'none' });
      }
    });
  },

  /* ==================== 保存 / 删除 ==================== */

  onSave() {
    if (this.data.submitting) return;

    const form = this.data.form;
    const name = (form.name || '').trim();
    const phone = (form.phone || '').trim();
    const detail = (form.detail || '').trim();
    const region = form.region || [];

    if (!name) return wx.showToast({ title: '请填写收货人', icon: 'none' });
    if (!/^1\d{10}$/.test(phone)) return wx.showToast({ title: '请填写 11 位手机号', icon: 'none' });
    if (!region.length) return wx.showToast({ title: '请选择所在地区', icon: 'none' });
    if (!detail) return wx.showToast({ title: '请填写详细地址', icon: 'none' });

    this.setData({ submitting: true });

    const list = (get(ADDRESS_KEY, []) || []).slice();
    const record = {
      // 加随机后缀：同一毫秒内连续新增两条也不会撞 ID
      addressId: form.addressId || 'addr-' + Date.now() + '-' + Math.floor(Math.random() * 1000),
      name: name,
      phone: phone,
      region: region,
      detail: detail,
      isDefault: !!form.isDefault
    };

    // 设为默认时，把其它地址的默认标记清掉
    if (record.isDefault) {
      list.forEach((item) => { item.isDefault = false; });
    }

    const index = list.findIndex((item) => item.addressId === record.addressId);

    if (index > -1) {
      list[index] = record;
    } else {
      if (list.length >= ADDRESS_LIMIT) {
        this.setData({ submitting: false });
        wx.showToast({ title: '最多保存 ' + ADDRESS_LIMIT + ' 条地址', icon: 'none' });
        return;
      }
      list.push(record);
    }

    // 只有一条地址时强制默认
    if (list.length === 1) list[0].isDefault = true;

    this.persist(list);
    this.setData({ showForm: false, submitting: false, form: Object.assign({}, EMPTY_FORM), regionText: '' });
    wx.showToast({ title: '已保存', icon: 'success' });
  },

  onSetDefault(e) {
    const addressId = e.currentTarget.dataset.id;

    const list = (get(ADDRESS_KEY, []) || []).map((item) => Object.assign({}, item, {
      isDefault: item.addressId === addressId
    }));

    this.persist(list);
    wx.showToast({ title: '已设为默认', icon: 'none' });
  },

  onDelete(e) {
    const addressId = e.currentTarget.dataset.id;

    wx.showModal({
      title: '删除地址',
      content: '删除后不可恢复，确定吗？',
      confirmColor: '#d9534f',
      success: (res) => {
        if (!res.confirm) return;

        const list = (get(ADDRESS_KEY, []) || []).filter((item) => item.addressId !== addressId);

        // 删掉默认地址后，把第一条补设为默认
        if (list.length && !list.some((item) => item.isDefault)) list[0].isDefault = true;

        this.persist(list);
        wx.showToast({ title: '已删除', icon: 'none' });
      }
    });
  }
});
