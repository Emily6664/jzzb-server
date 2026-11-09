// pages/mine/mine.js —— 我的（底部导航第 5 个 tab）
//
// 汇总个人相关内容：微信手机号一键登录 / 收货地址 / 我的作品 / 我的订单 / 设置。
//
// 【登录说明】用 <button open-type="getPhoneNumber"> 拿 code，
// 配合 wx.login 的 code 一起发给后端；**前端不会拿到明文手机号**，
// 真实手机号由后端调微信接口换取后下发。mock 模式下返回假号。

const goodsApi = require('../../api/goods');
const userApi = require('../../api/user');
const { get, set, remove } = require('../../utils/storage');

const DEFAULT_UI_MODE = 'normal';
const DEFAULT_VOICE_TYPE = 'mandarin';

const WORKS_KEY = 'MY_WORKS';
const ORDERS_KEY = 'MY_ORDERS';
const USER_KEY = 'USER_INFO';
const ADDRESS_KEY = 'MY_ADDRESSES';

const UI_MODE_TEXT = { normal: '普通模式', elder: '长辈大字', child: '儿童简易' };
const VOICE_TEXT = { mandarin: '普通话', hakka: '客家方言' };

/** 手机号脱敏：138****8000 */
function maskPhone(phone) {
  const str = String(phone || '');
  if (str.length !== 11) return str;
  return str.slice(0, 3) + '****' + str.slice(7);
}

Page({
  data: {
    uiMode: DEFAULT_UI_MODE,
    uiModeClass: '',
    uiModeText: UI_MODE_TEXT[DEFAULT_UI_MODE],
    voiceText: VOICE_TEXT[DEFAULT_VOICE_TYPE],

    logged: false,
    nickname: '',
    phoneText: '',
    avatarText: '乡',
    logging: false,

    workCount: 0,
    orderCount: 0,
    addressCount: 0,
    loading: true
  },

  onShow() {
    this.syncConfig();
    this.loadUser();
    this.loadStats();
  },

  /* ==================== 全局配置 ==================== */

  syncConfig() {
    const app = getApp();
    const globalData = (app && app.globalData) || {};
    const uiMode = globalData.uiMode || DEFAULT_UI_MODE;
    const voiceType = globalData.voiceType || DEFAULT_VOICE_TYPE;

    this.setData({
      uiMode: uiMode,
      uiModeClass: uiMode === 'normal' ? '' : 'ui-mode-' + uiMode,
      uiModeText: UI_MODE_TEXT[uiMode] || UI_MODE_TEXT[DEFAULT_UI_MODE],
      voiceText: VOICE_TEXT[voiceType] || VOICE_TEXT[DEFAULT_VOICE_TYPE]
    });
  },

  /* ==================== 登录 ==================== */

  loadUser() {
    const saved = get(USER_KEY, null);

    if (!saved || !saved.phone) {
      this.setData({ logged: false, nickname: '', phoneText: '', avatarText: '乡' });
      return;
    }

    const nickname = saved.nickname || '围山访客';

    this.setData({
      logged: true,
      nickname: nickname,
      phoneText: maskPhone(saved.phone),
      avatarText: nickname.slice(0, 1)
    });
  },

  /**
   * 微信手机号一键登录
   * getPhoneNumber 回调里拿到 code，再配合 wx.login 的 code 一起交给后端换取手机号
   */
  onGetPhoneNumber(e) {
    if (this.data.logging) return;

    const detail = (e && e.detail) || {};

    if (!detail.code) {
      wx.showToast({ title: '已取消手机号授权', icon: 'none' });
      return;
    }

    this.setData({ logging: true });

    wx.login({
      success: (loginRes) => {
        userApi
          .login({ loginCode: loginRes.code, phoneCode: detail.code })
          .then((data) => {
            const user = {
              token: data.token,
              userId: data.userId,
              phone: data.phone,
              nickname: data.nickname || '围山访客',
              avatarUrl: data.avatarUrl || ''
            };

            set(USER_KEY, user);

            const app = getApp();
            if (app && app.globalData) {
              app.globalData.userInfo = user;
              app.globalData.token = user.token;
            }

            this.loadUser();
            wx.showToast({ title: '登录成功', icon: 'success' });
          })
          .catch((err) => {
            console.error('[mine] 登录失败:', err);
            wx.showToast({ title: '登录失败，请重试', icon: 'none' });
          })
          .then(() => this.setData({ logging: false }));
      },
      fail: (err) => {
        console.error('[mine] wx.login 失败:', err);
        this.setData({ logging: false });
        wx.showToast({ title: '微信登录失败', icon: 'none' });
      }
    });
  },

  onLogout() {
    wx.showModal({
      title: '退出登录',
      content: '退出后需要重新授权手机号才能下单。',
      confirmColor: '#d9534f',
      success: (res) => {
        if (!res.confirm) return;

        remove(USER_KEY);

        const app = getApp();
        if (app && app.globalData) {
          app.globalData.userInfo = null;
          app.globalData.token = '';
        }

        this.loadUser();
        wx.showToast({ title: '已退出', icon: 'none' });
      }
    });
  },

  /* ==================== 统计 ==================== */

  loadStats() {
    const works = get(WORKS_KEY, []) || [];
    const localOrders = get(ORDERS_KEY, []) || [];
    const addresses = get(ADDRESS_KEY, []) || [];

    // 订单数 = 本地模拟下单 + mock 历史订单，口径与「我的订单」页一致
    goodsApi
      .getOrders({})
      .then((remoteOrders) => {
        this.setData({
          loading: false,
          workCount: works.length,
          orderCount: (remoteOrders || []).length + localOrders.length,
          addressCount: addresses.length
        });
      })
      .catch((err) => {
        console.warn('[mine] 订单统计失败，只算本地订单:', err);
        this.setData({
          loading: false,
          workCount: works.length,
          orderCount: localOrders.length,
          addressCount: addresses.length
        });
      });
  },

  /* ==================== 跳转 ==================== */

  onGoWorks() {
    this.goTo('/pages/my-works/my-works');
  },

  onGoOrder() {
    this.goTo('/pages/my-order/my-order');
  },

  onGoAddress() {
    this.goTo('/pages/address/address');
  },

  onGoSetting() {
    this.goTo('/pages/setting/setting');
  },

  /** 去拼贴页做一张（拼贴是 tabBar 页，必须用 switchTab） */
  onGoCollage() {
    wx.switchTab({
      url: '/pages/collage/collage',
      fail: () => wx.reLaunch({ url: '/pages/collage/collage' })
    });
  },

  /**
   * 统一跳转：普通页面用 navigateTo，页面栈满时降级 redirectTo
   * @param {string} url
   */
  goTo(url) {
    wx.navigateTo({
      url: url,
      fail: (err) => {
        console.warn('[mine] navigateTo 失败，降级 redirectTo:', url, err);
        wx.redirectTo({ url: url });
      }
    });
  }
});
