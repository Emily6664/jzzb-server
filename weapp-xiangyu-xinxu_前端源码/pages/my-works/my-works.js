// pages/my-works/my-works.js —— 我的作品
//
// 数据两路合并：本地 storage（键 MY_WORKS，拼贴页写入）+ 服务端 /collage/works。
// 每张作品都可以直接进入「文创定制」页（把小图印到商品上预览/下单）。

const collageApi = require('../../api/collage');
const { get, set } = require('../../utils/storage');

const WORKS_KEY = 'MY_WORKS';
const DEFAULT_UI_MODE = 'normal';
// 定制文创默认带的商品（与拼贴页保持一致）
const CUSTOM_GOODS_ID = 'goods-01';

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

  /** 读取作品：本地 storage + 服务端 /collage/works，按 workId 合并 */
  loadWorks() {
    const localList = (get(WORKS_KEY, []) || []).map((item) => ({
      workId: item.workId,
      imagePath: item.imagePath || item.imageUrl || '',
      imageUrl: item.imageUrl || '',
      title: item.title || '',
      templateName: item.templateName || '拼贴作品',
      itemCount: item.itemCount || 0,
      createdAt: item.createdAt || '',
      backendSaved: !!item.backendSaved,
      remote: false
    }));

    this.setData({ works: localList, loaded: true });

    collageApi
      .getWorks()
      .then((remoteList) => {
        this.setData({ works: this.mergeWorks(localList, remoteList || []) });
      })
      .catch((err) => {
        console.warn('[my-works] 服务器作品加载失败，先只显示本地作品:', err);
      });
  },

  /**
   * 本地与服务端作品合并：同一 workId 以服务端为准（说明已经存进数据库），
   * 图片优先用本地文件（离线也能看），没有本地文件就用服务端 URL。
   */
  mergeWorks(localList, remoteList) {
    const byId = Object.create(null);

    localList.forEach((item) => {
      byId[item.workId] = item;
    });

    remoteList.forEach((item) => {
      const existing = byId[item.workId];
      byId[item.workId] = {
        workId: item.workId,
        imagePath: (existing && existing.imagePath) || item.imageUrl || '',
        imageUrl: item.imageUrl || '',
        title: item.title || (existing && existing.title) || '',
        templateName: (existing && existing.templateName) || item.title || '家庭专属插画',
        itemCount: existing ? existing.itemCount : item.itemCount || 0,
        createdAt: item.createdAt || (existing && existing.createdAt) || '',
        backendSaved: true,
        remote: true
      };
    });

    return Object.keys(byId)
      .map((key) => byId[key])
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
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

        const list = get(WORKS_KEY, []) || [];
        const target = list.filter((item) => item.workId === workId)[0];

        set(
          WORKS_KEY,
          list.filter((item) => item.workId !== workId)
        );

        // 已经存到服务端的作品，删本地时一并删掉
        if (target && target.backendSaved) {
          collageApi.deleteWork(workId).catch((err) => {
            console.warn('[my-works] 服务器删除失败，作品仍保留在服务端:', err);
          });
        }

        this.loadWorks();
        wx.showToast({ title: '已删除', icon: 'none' });
      }
    });
  },

  /** 用这张作品去定制文创（跳商品详情并带上作品图） */
  onCustom(e) {
    const path = e.currentTarget.dataset.path;

    if (!path) {
      wx.showToast({ title: '作品图还没准备好', icon: 'none' });
      return;
    }

    const url =
      '/pages/goods-detail/goods-detail?goodsId=' + CUSTOM_GOODS_ID +
      '&workImage=' + encodeURIComponent(path);

    wx.navigateTo({
      url: url,
      fail: () => wx.redirectTo({ url: url })
    });
  },

  /** 作品图加载失败：标记后改用文字占位，避免出现破图 */
  onWorkImageError(e) {    const workId = e.currentTarget.dataset.id;
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
