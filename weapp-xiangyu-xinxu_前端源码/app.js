// app.js —— 全局入口
// 职责：应用启动时读取本地用户配置（uiMode / voiceType），挂载到 globalData 供各页面共享。

const { get, set } = require('./utils/storage');

// 用户配置在 storage 中的键名
const CONFIG_KEY = 'USER_CONFIG';

// 允许的取值，用于脏数据兜底
const UI_MODES = ['normal', 'elder', 'child'];
const VOICE_TYPES = ['mandarin', 'hakka'];

// 默认配置：storage 为空或非法时使用
const DEFAULT_CONFIG = {
  uiMode: 'normal',      // normal 普通 / elder 长辈大字 / child 儿童
  voiceType: 'mandarin'  // mandarin 普通话 / hakka 客家话
};

App({
  globalData: {
    // 完整用户配置对象
    userConfig: {
      uiMode: DEFAULT_CONFIG.uiMode,
      voiceType: DEFAULT_CONFIG.voiceType
    },
    // 常用字段的平铺副本，方便页面直接读 app.globalData.uiMode
    uiMode: DEFAULT_CONFIG.uiMode,
    voiceType: DEFAULT_CONFIG.voiceType
  },

  onLaunch() {
    const userConfig = this.loadUserConfig();

    this.globalData.userConfig = userConfig;
    this.globalData.uiMode = userConfig.uiMode;
    this.globalData.voiceType = userConfig.voiceType;
  },

  /**
   * 读取本地用户配置；缺字段或取值非法时回退默认值，并回写修正后的配置。
   * @returns {{ uiMode: string, voiceType: string }}
   */
  loadUserConfig() {
    const stored = get(CONFIG_KEY, null) || {};

    const userConfig = {
      uiMode:
        UI_MODES.indexOf(stored.uiMode) > -1 ? stored.uiMode : DEFAULT_CONFIG.uiMode,
      voiceType:
        VOICE_TYPES.indexOf(stored.voiceType) > -1
          ? stored.voiceType
          : DEFAULT_CONFIG.voiceType
    };

    // 首次启动或数据被修正过时落库，保证后续读取一致
    set(CONFIG_KEY, userConfig);

    return userConfig;
  },

  /**
   * 更新用户配置（设置页调用），写入 storage 并同步 globalData。
   * @param {{ uiMode?: string, voiceType?: string }} patch 需要修改的字段
   * @returns {{ uiMode: string, voiceType: string }} 更新后的完整配置
   */
  updateUserConfig(patch) {
    const current = this.globalData.userConfig || DEFAULT_CONFIG;

    const next = {
      uiMode:
        patch && UI_MODES.indexOf(patch.uiMode) > -1 ? patch.uiMode : current.uiMode,
      voiceType:
        patch && VOICE_TYPES.indexOf(patch.voiceType) > -1
          ? patch.voiceType
          : current.voiceType
    };

    set(CONFIG_KEY, next);

    this.globalData.userConfig = next;
    this.globalData.uiMode = next.uiMode;
    this.globalData.voiceType = next.voiceType;

    return next;
  }
});
