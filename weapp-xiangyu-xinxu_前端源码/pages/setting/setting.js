// pages/setting/setting.js —— 设置页
//
// 职责：
//   1. 切换界面模式（normal 普通 / elder 长辈大字 / child 儿童简易）
//   2. 切换语音（mandarin 普通话 / hakka 客家方言）
// 选择后立即写入 storage 并同步全局配置，所有页面下次 onShow 时生效。

const { get, set } = require('../../utils/storage');

const DEFAULT_UI_MODE = 'normal';
const DEFAULT_VOICE_TYPE = 'mandarin';

// storage 键名，与 app.js 中的 CONFIG_KEY 保持一致
const CONFIG_KEY = 'USER_CONFIG';

// 界面模式选项
const UI_MODE_OPTIONS = [
  { value: 'normal', label: '普通模式', desc: '标准字号与按钮，日常使用' },
  { value: 'elder', label: '长辈大字', desc: '字号与按钮整体放大，方便长辈操作' },
  { value: 'child', label: '儿童简易', desc: '更大圆角与留白，界面更简单' }
];

// 语音选项
const VOICE_OPTIONS = [
  { value: 'mandarin', label: '普通话', desc: '故事与讲解用普通话朗读' },
  { value: 'hakka', label: '客家方言', desc: '故事与讲解用客家方言朗读' }
];

Page({
  data: {
    uiMode: DEFAULT_UI_MODE,
    uiModeClass: '',
    uiModeText: '普通模式',
    voiceType: DEFAULT_VOICE_TYPE,
    voiceText: '普通话',
    uiModeOptions: UI_MODE_OPTIONS,
    voiceOptions: VOICE_OPTIONS
  },

  onShow() {
    this.syncFromGlobal();
  },

  /** 读取全局配置（app.globalData），回显到页面 */
  syncFromGlobal() {
    const app = getApp();
    const globalData = (app && app.globalData) || {};
    const config = globalData.userConfig || {};

    // 兼容两种来源：userConfig 是完整配置对象，uiMode / voiceType 是平铺副本，
    // 任一存在都能正确回显，避免只有一半数据时页面显示成默认模式。
    const uiMode = config.uiMode || globalData.uiMode || DEFAULT_UI_MODE;
    const voiceType = config.voiceType || globalData.voiceType || DEFAULT_VOICE_TYPE;

    this.setData({
      uiMode: uiMode,
      uiModeClass: uiMode === 'normal' ? '' : 'ui-mode-' + uiMode,
      uiModeText: this.labelOf(UI_MODE_OPTIONS, uiMode),
      voiceType: voiceType,
      voiceText: this.labelOf(VOICE_OPTIONS, voiceType)
    });
  },

  /** 取选项的中文名，用于提示文案 */
  labelOf(options, value) {
    const hit = options.filter(function (item) {
      return item.value === value;
    })[0];

    return hit ? hit.label : '';
  },

  /** 点击界面模式 */
  onUiModeTap(e) {
    const value = e.currentTarget.dataset.value;
    if (!value || value === this.data.uiMode) return;

    this.applyConfig({ uiMode: value });
    wx.showToast({
      title: '已切换为' + this.labelOf(UI_MODE_OPTIONS, value),
      icon: 'none'
    });
  },

  /** 点击语音类型 */
  onVoiceTap(e) {
    const value = e.currentTarget.dataset.value;
    if (!value || value === this.data.voiceType) return;

    this.applyConfig({ voiceType: value });
    wx.showToast({
      title: '已选择' + this.labelOf(VOICE_OPTIONS, value),
      icon: 'none'
    });
  },

  /**
   * 应用配置：优先走 app.updateUserConfig（内部会写 storage + 同步 globalData），
   * 该方法缺失时退化为「直接写 storage + 手动改 globalData」。
   * @param {{ uiMode?: string, voiceType?: string }} patch
   */
  applyConfig(patch) {
    const app = getApp();

    if (app && typeof app.updateUserConfig === 'function') {
      app.updateUserConfig(patch);
      this.syncFromGlobal();
      return;
    }

    // 兜底：不依赖 app.updateUserConfig 的实现
    const current = get(CONFIG_KEY, null) || {};
    const next = {
      uiMode: patch.uiMode || current.uiMode || DEFAULT_UI_MODE,
      voiceType: patch.voiceType || current.voiceType || DEFAULT_VOICE_TYPE
    };

    set(CONFIG_KEY, next);

    if (app && app.globalData) {
      app.globalData.userConfig = next;
      app.globalData.uiMode = next.uiMode;
      app.globalData.voiceType = next.voiceType;
    }

    this.syncFromGlobal();
  }
});
