// pages/index/index.js —— 首页（底部导航第 1 个 tab）
//
// 【墨印版】不用卡片，靠宋体大字 + 发丝线 + 竖排点位分组。
// 首页只回答两件事：这地方有什么（地图 + 五个点位）、怎么听故事（NFC）。
//
// 【答辩演示路线】
//   本页点「去碰一下」→ NFC 溯源页 → 查看地图点位 → 地图 tab（自动弹出该点位）
//   本页点某个点位名 → 地图 tab（自动弹出该点位）
//   本页点地图带 → 地图 tab
//   拼贴（tab）→ 拼贴页「定制文创」→ 商品详情 → 模拟下单 → 我的订单
//   我的（tab）→ 我的作品 / 我的订单 / 设置（切三种模式）

const DEFAULT_UI_MODE = 'normal';

const UI_MODE_TEXT = {
  normal: '普通模式',
  elder: '长辈大字',
  child: '儿童简易'
};

// 五个点位与 mock/mock-map-spots.js 保持一致（顺序、id 都不许改）
const SPOTS = [
  { id: 'spot-01', name: '客家围屋' },
  { id: 'spot-02', name: '圆形土楼' },
  { id: 'spot-03', name: '擂茶老铺' },
  { id: 'spot-04', name: '花灯工坊' },
  { id: 'spot-05', name: '古渡口' }
];

Page({
  data: {
    uiMode: DEFAULT_UI_MODE,
    uiModeClass: '',
    uiModeText: UI_MODE_TEXT[DEFAULT_UI_MODE],
    // 竖排要点成单字数组：小程序里 writing-mode 兼容性不稳，用 flex 列更保险
    spots: SPOTS.map((s) => ({ id: s.id, name: s.name, chars: s.name.split('') }))
  },

  onShow() {
    this.syncUiMode();
  },

  /** 从全局配置同步 UI 模式，决定根节点的模式类名 */
  syncUiMode() {
    const app = getApp();
    const uiMode = (app && app.globalData && app.globalData.uiMode) || DEFAULT_UI_MODE;

    this.setData({
      uiMode: uiMode,
      uiModeClass: uiMode === 'normal' ? '' : 'ui-mode-' + uiMode,
      uiModeText: UI_MODE_TEXT[uiMode] || UI_MODE_TEXT[DEFAULT_UI_MODE]
    });
  },

  /** 去 NFC 溯源页（不是 tabBar 页，用 navigateTo） */
  onGoNfc() {
    const url = '/pages/nfc-trace/nfc-trace';

    wx.navigateTo({
      url: url,
      fail: (err) => {
        console.warn('[index] navigateTo 失败，降级 redirectTo:', err);
        wx.redirectTo({ url: url });
      }
    });
  },

  /** 去地图 tab（tabBar 页必须用 switchTab） */
  onGoMap() {
    this.goMapTab('');
  },

  /** 点某个点位：把 spotId 交给地图页 */
  onSpotTap(e) {
    const spotId = (e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.id) || '';
    this.goMapTab(spotId);
  },

  /** switchTab 不能带参数，点位靠 globalData 传（地图页 onShow 里消费） */
  goMapTab(spotId) {
    const app = getApp();
    if (spotId && app && app.globalData) {
      app.globalData.pendingSpotId = spotId;
    }

    wx.switchTab({
      url: '/pages/local-map/local-map',
      fail: (err) => {
        console.warn('[index] switchTab 失败:', err);
      }
    });
  }
});
