// pages/goods-detail/goods-detail.js —— 商品详情 / 文创定制预览 / 下单支付
//
// 两种进入方式：
//   1. 商品列表 / 地图 / 订单：?goodsId=goods-01
//   2. 拼贴页「定制文创」：?goodsId=goods-01&workImage=<作品图临时路径>
//      带 workImage 时，页面顶部会多一块「定制预览」，把用户的作品图叠在商品上。
//
// 【下单流程】
//   检查登录 → 检查收货地址 → goodsApi.createOrder()（后端统一下单）
//   → 需要支付时调 wx.requestPayment → 写本地订单 → 结果弹窗
//
// 【支付是双模式的】
//   utils/api.js 里 PAY_ENABLE = false（默认）→ 模拟支付，直接判定成功，Demo 可跑
//   PAY_ENABLE = true 且 USE_MOCK = false   → 真实微信支付，需要商户号 + 后端签名
//   个人主体小程序无法使用微信支付，配置了也会失败，演示时请保持 PAY_ENABLE = false。

const goodsApi = require('../../api/goods');
const { get, set } = require('../../utils/storage');
const { PAY_ENABLE, USE_MOCK } = require('../../utils/api');

const DEFAULT_UI_MODE = 'normal';
const UI_MODE_TEXT = { normal: '普通模式', elder: '长辈大字', child: '儿童简易' };

// 本地存储键
const ORDERS_KEY = 'MY_ORDERS';
const USER_KEY = 'USER_INFO';
const ADDRESS_KEY = 'MY_ADDRESSES';
const ORDERS_LIMIT = 50;

/** 金额格式化：整数不带小数，非整数保留两位 */
function formatPrice(value) {
  const num = Number(value);

  if (!isFinite(num)) return '¥0';

  const fixed = Math.round(num * 100) / 100;
  return '¥' + (Number.isInteger(fixed) ? String(fixed) : fixed.toFixed(2));
}

/**
 * 安全解码 URL 参数：小程序通常已经解码过一次，这里避免二次解码把路径弄坏
 * @param {string} value
 * @returns {string}
 */
function safeDecode(value) {
  if (!value) return '';
  if (value.indexOf('%') === -1) return value;

  try {
    return decodeURIComponent(value);
  } catch (err) {
    return value;
  }
}

/** 当前时间 YYYY-MM-DD HH:mm:ss */
function nowText() {
  const now = new Date();
  const pad = (n) => (n < 10 ? '0' + n : '' + n);

  return (
    now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate()) +
    ' ' + pad(now.getHours()) + ':' + pad(now.getMinutes()) + ':' + pad(now.getSeconds())
  );
}

Page({
  data: {
    uiMode: DEFAULT_UI_MODE,
    uiModeClass: '',
    uiModeText: UI_MODE_TEXT[DEFAULT_UI_MODE],

    goodsId: '',
    workImage: '',
    loading: true,
    detail: null,
    failedImages: {},
    coverFailed: false,

    // 下单相关
    address: null,
    addressText: '',
    logged: false,
    canPay: false,        // true = 走真实微信支付
    buying: false,

    errorText: ''
  },

  onLoad(options) {
    const opts = options || {};

    this.setData({
      goodsId: opts.goodsId || '',
      // 上一页（拼贴页）带过来的自定义作品图
      workImage: safeDecode(opts.workImage),
      // 只有「接后端 + 打开支付开关」才走真支付
      canPay: !!PAY_ENABLE && !USE_MOCK
    });

    this.syncConfig();
    this.loadDetail();
    this.refreshAddress();
    this.refreshUser();
  },

  onShow() {
    this.syncConfig();
    // 从地址页 / 登录页回来时刷新
    this.refreshAddress();
    this.refreshUser();
  },

  /* ==================== 全局配置 ==================== */

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

  /* ==================== 数据 ==================== */

  loadDetail() {
    const goodsId = this.data.goodsId;

    if (!goodsId) {
      this.setData({ loading: false, errorText: '没有带上商品 ID' });
      return;
    }

    this.setData({ loading: true, errorText: '' });

    goodsApi
      .getDetail(goodsId)
      .then((detail) => {
        if (!detail) {
          this.setData({ loading: false, detail: null, errorText: '没有找到这件商品（' + goodsId + '）' });
          return;
        }

        this.setData({
          loading: false,
          detail: Object.assign({}, detail, {
            priceText: formatPrice(detail.price),
            detailImageUrls: detail.detailImageUrls || []
          })
        });
      })
      .catch((err) => {
        console.error('[goods-detail] 商品详情加载失败:', err);
        this.setData({ loading: false, errorText: '商品详情加载失败，请稍后重试' });
        wx.showToast({ title: '加载失败', icon: 'none' });
      });
  },

  /** 取默认收货地址（没有默认就用第一条） */
  refreshAddress() {
    const list = get(ADDRESS_KEY, []) || [];
    const hit = list.filter((item) => item.isDefault)[0] || list[0] || null;

    if (!hit) {
      this.setData({ address: null, addressText: '' });
      return;
    }

    const regionText = (hit.region || []).join('');

    this.setData({
      address: Object.assign({}, hit, { regionText: regionText }),
      addressText: regionText + (hit.detail || '')
    });
  },

  refreshUser() {
    const user = get(USER_KEY, null);
    this.setData({ logged: !!(user && user.phone) });
  },

  /* ==================== 图片 ==================== */

  onCoverError() {
    this.setData({ coverFailed: true });
  },

  onDetailImageError(e) {
    const index = e.currentTarget.dataset.idx;
    if (index === undefined || index === null) return;

    const failed = Object.assign({}, this.data.failedImages);
    failed[index] = true;

    this.setData({ failedImages: failed });
  },

  onPreview(e) {
    const src = e.currentTarget.dataset.src;
    if (!src) return;

    const urls = [src];
    if (this.data.workImage) urls.unshift(this.data.workImage);

    wx.previewImage({ current: src, urls: urls });
  },

  /* ==================== 下单 ==================== */

  onBuy() {
    if (this.data.buying) return;

    const detail = this.data.detail;

    if (!detail) {
      wx.showToast({ title: '商品还没加载完', icon: 'none' });
      return;
    }

    // 1. 必须登录（真实环境下单要带 token）
    if (!this.data.logged) {
      wx.showModal({
        title: '需要先登录',
        content: '下单前请先用微信手机号一键登录。',
        confirmText: '去登录',
        success: (res) => {
          if (res.confirm) this.onGoLogin();
        }
      });
      return;
    }

    // 2. 必须有收货地址
    if (!this.data.address) {
      wx.showModal({
        title: '还没有收货地址',
        content: '先添加一个收货地址，才能下单。',
        confirmText: '去添加',
        success: (res) => {
          if (res.confirm) this.onGoAddress();
        }
      });
      return;
    }

    this.setData({ buying: true });

    const address = this.data.address;

    goodsApi
      .createOrder({
        goodsId: detail.goodsId,
        count: 1,
        addressId: address.addressId,
        address: {
          name: address.name,
          phone: address.phone,
          region: address.region,
          detail: address.detail
        },
        workImage: this.data.workImage || ''
      })
      .then((res) => this.handleOrderCreated(res, detail))
      .catch((err) => {
        console.error('[goods-detail] 下单失败:', err);
        wx.showToast({ title: '下单失败，请重试', icon: 'none' });
      })
      .then(() => this.setData({ buying: false }));
  },

  /**
   * 订单创建成功 → 支付 → 落库 → 弹结果
   * @param {Object} res    createOrder 的返回
   * @param {Object} detail 商品详情
   */
  handleOrderCreated(res, detail) {
    const order = this.buildOrder(res, detail);

    return this.doPay(res.payParams)
      .then((paid) => {
        order.status = paid ? 'paid' : 'unpaid';
        this.saveOrder(order);
        this.showPaidResult(order, paid);
      })
      .catch((err) => {
        console.error('[goods-detail] 支付异常:', err);
        order.status = 'unpaid';
        this.saveOrder(order);
        wx.showToast({ title: '支付未完成，可在我的订单里继续', icon: 'none' });
      });
  },

  /**
   * 调起支付
   * @param {Object|null} payParams 后端下发的支付参数
   * @returns {Promise<boolean>} true = 已支付；false = 用户取消（订单保留为待付款）
   */
  doPay(payParams) {
    // 模拟支付：没开真支付、或后端没给支付参数时，直接判定成功
    if (!this.data.canPay || !payParams) {
      return Promise.resolve(true);
    }

    return new Promise((resolve, reject) => {
      wx.requestPayment({
        timeStamp: payParams.timeStamp,
        nonceStr: payParams.nonceStr,
        package: payParams.package,
        signType: payParams.signType || 'RSA',
        paySign: payParams.paySign,
        success: () => resolve(true),
        fail: (err) => {
          const msg = (err && err.errMsg) || '';
          if (msg.indexOf('cancel') > -1) {
            resolve(false);
            return;
          }
          reject(err);
        }
      });
    });
  },

  /** 组装本地订单记录（字段与 api/goods.js 的 getOrders 一致） */
  buildOrder(res, detail) {
    const address = this.data.address || {};

    return {
      orderId: res.orderId || 'ORD-' + Date.now(),
      goodsId: detail.goodsId,
      goodsName: detail.name,
      coverUrl: detail.coverUrl,
      price: detail.price,
      count: 1,
      totalAmount: typeof res.totalAmount === 'number' ? res.totalAmount : detail.price,
      status: res.status || 'unpaid',
      createdAt: nowText(),
      // 以下字段是本地下单额外记录的，真实接口可按需扩展
      addressText: (address.region || []).join('') + (address.detail || ''),
      receiver: address.name || '',
      receiverPhone: address.phone || '',
      workImage: this.data.workImage || '',
      payMode: this.data.canPay ? 'wxpay' : 'mock',
      simulated: !this.data.canPay
    };
  },

  saveOrder(order) {
    const list = (get(ORDERS_KEY, []) || []).filter((item) => item.orderId !== order.orderId);
    const next = [order].concat(list).slice(0, ORDERS_LIMIT);

    set(ORDERS_KEY, next);
  },

  showPaidResult(order, paid) {
    if (!paid) {
      wx.showModal({
        title: '订单已生成',
        content: '订单号：' + order.orderId + '\n还没有完成支付，可以在「我的订单」里继续支付。',
        confirmText: '查看订单',
        cancelText: '稍后',
        success: (res) => {
          if (res.confirm) this.onGoOrder();
        }
      });
      return;
    }

    wx.showModal({
      title: this.data.canPay ? '支付成功' : '下单成功',
      content:
        '订单号：' + order.orderId + '\n' +
        order.goodsName + ' × ' + order.count + '\n' +
        '实付：' + formatPrice(order.totalAmount) + '\n' +
        '收货：' + (order.receiver || '') + ' ' + (order.receiverPhone || '') + '\n\n' +
        (this.data.canPay ? '已通过微信支付完成付款。' : '当前为模拟支付，未真实扣款。'),
      confirmText: '查看订单',
      cancelText: '继续逛',
      confirmColor: '#8b6f47',
      success: (res) => {
        if (res.confirm) this.onGoOrder();
      }
    });
  },

  /* ==================== 跳转 ==================== */

  onGoOrder() {
    wx.navigateTo({
      url: '/pages/my-order/my-order',
      fail: () => wx.redirectTo({ url: '/pages/my-order/my-order' })
    });
  },

  onGoAddress() {
    wx.navigateTo({
      url: '/pages/address/address',
      fail: () => wx.redirectTo({ url: '/pages/address/address' })
    });
  },

  onGoLogin() {
    // 「我的」是 tabBar 页，必须用 switchTab
    wx.switchTab({
      url: '/pages/mine/mine',
      fail: () => wx.reLaunch({ url: '/pages/mine/mine' })
    });
  },

  onBackList() {
    // 商城是 tabBar 页，必须用 switchTab
    wx.switchTab({
      url: '/pages/goods-list/goods-list',
      fail: () => wx.reLaunch({ url: '/pages/goods-list/goods-list' })
    });
  }
});
