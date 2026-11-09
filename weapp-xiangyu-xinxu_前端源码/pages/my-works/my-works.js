// pages/my-works/my-works.js —— 我的作品
//
// 作品由拼贴页导出海报后写入本地 storage（键 MY_WORKS），这里读取并展示。
// TODO 作品列表接口待后端补充（见 API_DOC.md 5.3），联调时把 loadWorks 换成
//      collageApi.getWorks?.() 之类的接口调用即可，页面结构不用改。

const collageApi = require('../../api/collage');
const { get, set } = require('../../utils/storage');

const WORKS_KEY = 'MY_WORKS';
const DEFAULT_UI_MODE = 'normal';

Page({
  data: {
    uiMode: DEFAULT_UI_MODE,
    uiModeClass: '',
    works: [],
    loaded: false,
    // 作品图路径失效时（比如临时文件被系统清理）记录一下，改走占位块
    failedImages: {}
  },

  onShow() {
    this.syncUiMode();
    this.loadWorks();
  },

  /** 从全局配置同步 UI 模式，换算成根节点的模式类名 */
  syncUiMode() {
    const app = getApp();
    const uiMode = (app && app.globalData && app.globalData.uiMode) || DEFAULT_UI_MODE;

    this.setData({
      uiMode: uiMode,
      uiModeClass: uiMode === 'normal' ? '' : 'ui-mode-' + uiMode
    });
  },

  /** 读取本地作品列表 */
  loadWorks() {
    const list = get(WORKS_KEY, []) || [];

    this.setData({
      works: list.map((item) => ({
        workId: item.workId,
        imagePath: item.imagePath,
        templateName: item.templateName || '拼贴作品',
        itemCount: item.itemCount || 0,
        createdAt: item.createdAt || ''
      })),
      loaded: true
    });
  },

  /** 点击作品看大图 */
  onPreview(e) {
    const path = e.currentTarget.dataset.path;
    if (!path) return;

    const urls = this.data.works
      .map((item) => item.imagePath)
      .filter((url) => !!url);

    if (!urls.length) return;

    wx.previewImage({
      current: path,
      urls: urls
    });
  },

  /** 长按删除作品 */
  onDelete(e) {
    const workId = e.currentTarget.dataset.id;
    if (!workId) return;

    wx.showModal({
      title: '删除作品',
      content: '删除后不可恢复，确定吗？',
      confirmColor: '#d9534f',
      success: (res) => {
        if (!res.confirm) return;

        const list = (get(WORKS_KEY, []) || []).filter((item) => item.workId !== workId);
        set(WORKS_KEY, list);

        this.loadWorks();
        wx.showToast({ title: '已删除', icon: 'none' });
      }
    });
  },

  /** 作品图加载失败：标记后改用文字占位，避免出现破图 */
  onWorkImageError(e) {
    const workId = e.currentTarget.dataset.id;
    if (!workId) return;

    const failed = Object.assign({}, this.data.failedImages);
    failed[workId] = true;

    this.setData({ failedImages: failed });
  },

  /** 去拼贴页再做一个（拼贴是 tabBar 页，必须用 switchTab） */
  onGoCollage() {
    wx.switchTab({
      url: '/pages/collage/collage',
      fail: () => wx.reLaunch({ url: '/pages/collage/collage' })
    });
  }
});
