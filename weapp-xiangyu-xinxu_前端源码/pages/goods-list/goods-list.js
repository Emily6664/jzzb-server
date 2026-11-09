// pages/goods-list/goods-list.js —— 文创商品列表
//
// 数据走 api/goods.js 的 getList()（USE_MOCK 打开时直接读 mock/mock-goods.js）。
// 点卡片跳商品详情；支持从其他页面带 ?spotId= 进来只看该点位下的文创。

const goodsApi = require('../../api/goods');

const DEFAULT_UI_MODE = 'normal';
const UI_MODE_TEXT = { normal: '普通模式', elder: '长辈大字', child: '儿童简易' };

/**
 * 金额格式化：整数不带小数，非整数保留两位
 * @param {number} value
 * @returns {string}
 */
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
    list: [],
    failedImages: {},
    spotId: '',
    errorText: ''
  },

  onLoad(options) {
    this.setData({ spotId: (options && options.spotId) || '' });

    this.syncConfig();
    this.loadList();
  },

  onShow() {
    this.syncConfig();
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

  loadList() {
    const params = {};
    if (this.data.spotId) params.spotId = this.data.spotId;

    this.setData({ loading: true, errorText: '' });

    goodsApi
      .getList(params)
      .then((list) => {
        const items = (list || []).map((item) => ({
          goodsId: item.goodsId,
          name: item.name,
          price: item.price,
          priceText: formatPrice(item.price),
          coverUrl: item.coverUrl,
          summary: item.summary,
          spotId: item.spotId
        }));

        this.setData({ loading: false, list: items });
      })
      .catch((err) => {
        console.error('[goods-list] 商品加载失败:', err);
        this.setData({ loading: false, errorText: '商品加载失败，请稍后重试' });
        wx.showToast({ title: '商品加载失败', icon: 'none' });
      });
  },

  /* ==================== 交互 ==================== */

  onCardTap(e) {
    const goodsId = e.currentTarget.dataset.id;
    if (!goodsId) return;

    wx.navigateTo({
      url: '/pages/goods-detail/goods-detail?goodsId=' + goodsId,
      fail: () => wx.redirectTo({ url: '/pages/goods-detail/goods-detail?goodsId=' + goodsId })
    });
  },

  onImageError(e) {
    const goodsId = e.currentTarget.dataset.id;
    if (!goodsId) return;

    const failed = Object.assign({}, this.data.failedImages);
    failed[goodsId] = true;

    this.setData({ failedImages: failed });
  }
});
