// pages/my-order/my-order.js —— 我的订单
//
// 数据来源两路合并：
//   1. 本地 storage 里的模拟下单记录（键 MY_ORDERS，由 goods-detail 页写入）
//   2. api/goods.js 的 getOrders()（USE_MOCK 打开时就读 mock/mock-goods.js 的 orders）
// 合并后按下单时间倒序展示，本地新下的订单排在最前面。

const goodsApi = require('../../api/goods');
const { get, set } = require('../../utils/storage');
const { PAY_ENABLE, USE_MOCK } = require('../../utils/api');

const DEFAULT_UI_MODE = 'normal';
const ORDERS_KEY = 'MY_ORDERS';

const UI_MODE_TEXT = { normal: '普通模式', elder: '长辈大字', child: '儿童简易' };

const STATUS_TEXT = {
  unpaid: '待付款',
  paid: '已付款',
  shipped: '已发货',
  finished: '已完成'
};

/** 金额格式化：整数不带小数，非整数保留两位 */
function formatPrice(value) {
  const num = Number(value);

  if (!isFinite(num)) return '¥0';

  const fixed = Math.round(num * 100) / 100;
  return '¥' + (Number.isInteger(fixed) ? String(fixed) : fixed.toFixed(2));
}

Page({
  data: {
    uiMode: DEFAULT_UI_MODE,
    uiModeClass: '',
    uiModeText: UI_MODE_TEXT[DEFAULT_UI_MODE],

    loading: true,
    orders: [],
    failedImages: {},
    payingId: '',
    errorText: ''
  },

  onLoad() {
    this.syncConfig();
  },

  onShow() {
    this.syncConfig();
    this.loadOrders();
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

  loadOrders() {
    // 本地订单打上 _local 标记：只有本地下单的未付款订单才需要「去支付」
    const localOrders = (get(ORDERS_KEY, []) || []).map((order) =>
      Object.assign({}, order, { _local: true })
    );

    this.setData({ loading: true, errorText: '' });

    goodsApi
      .getOrders({})
      .then((remoteOrders) => {
        this.setData({
          loading: false,
          orders: this.mergeOrders(localOrders, remoteOrders || [])
        });
      })
      .catch((err) => {
        // 远端失败时，至少把本地模拟订单显示出来
        console.error('[my-order] 线上订单加载失败:', err);

        this.setData({
          loading: false,
          orders: this.mergeOrders(localOrders, []),
          errorText: '线上订单加载失败，以下只包含本地模拟订单'
        });
      });
  },

  /**
   * 合并本地与远端订单并按时间倒序
   * @param {Array} localOrders 本地模拟订单
   * @param {Array} remoteOrders 接口返回的订单
   * @returns {Array}
   */
  mergeOrders(localOrders, remoteOrders) {
    const all = localOrders.concat(remoteOrders);

    all.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));

    return all.map((order) => ({
      orderId: order.orderId,
      goodsId: order.goodsId,
      goodsName: order.goodsName,
      coverUrl: order.coverUrl,
      price: order.price,
      priceText: formatPrice(order.price),
      count: order.count || 1,
      totalAmount: order.totalAmount,
      totalText: formatPrice(order.totalAmount),
      status: order.status,
      statusText: STATUS_TEXT[order.status] || order.status,
      createdAt: order.createdAt,
      simulated: !!order.simulated,
      _local: !!order._local
    }));
  },

  /* ==================== 支付 ==================== */

  /** 未付款订单继续支付 */
  onPay(e) {
    const orderId = e.currentTarget.dataset.id;
    if (!orderId || this.data.payingId) return;

    const list = get(ORDERS_KEY, []) || [];
    const hit = list.filter((item) => item.orderId === orderId)[0];

    if (!hit) {
      wx.showToast({ title: '订单不存在', icon: 'none' });
      return;
    }

    this.setData({ payingId: orderId });

    goodsApi
      .payOrder(orderId)
      .then((res) => this.doPay(res.payParams))
      .then((paid) => {
        if (!paid) {
          wx.showToast({ title: '已取消支付', icon: 'none' });
          return;
        }

        const next = list.map((item) =>
          item.orderId === orderId ? Object.assign({}, item, { status: 'paid' }) : item
        );

        set(ORDERS_KEY, next);
        this.loadOrders();
        wx.showToast({ title: '支付成功', icon: 'success' });
      })
      .catch((err) => {
        console.error('[my-order] 支付失败:', err);
        wx.showToast({ title: '支付失败，请重试', icon: 'none' });
      })
      .then(() => this.setData({ payingId: '' }));
  },

  /**
   * 调起支付；未开启真支付时直接判定成功（模拟支付）
   * @param {Object|null} payParams
   * @returns {Promise<boolean>}
   */
  doPay(payParams) {
    const canPay = !!PAY_ENABLE && !USE_MOCK;

    if (!canPay || !payParams) return Promise.resolve(true);

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

  /* ==================== 交互 ==================== */

  onOrderTap(e) {
    const goodsId = e.currentTarget.dataset.goodsid;
    if (!goodsId) return;

    wx.navigateTo({
      url: '/pages/goods-detail/goods-detail?goodsId=' + goodsId,
      fail: () => wx.redirectTo({ url: '/pages/goods-detail/goods-detail?goodsId=' + goodsId })
    });
  },

  onImageError(e) {
    const orderId = e.currentTarget.dataset.id;
    if (!orderId) return;

    const failed = Object.assign({}, this.data.failedImages);
    failed[orderId] = true;

    this.setData({ failedImages: failed });
  },

  onGoGoods() {
    // 商城是 tabBar 页，必须用 switchTab
    wx.switchTab({
      url: '/pages/goods-list/goods-list',
      fail: () => wx.reLaunch({ url: '/pages/goods-list/goods-list' })
    });
  }
});
