// pages/collage/collage.js —— AI 家庭拼贴共创引擎
//
// 流程：读 mock 素材库 → 选模板 / 一键预置 → 画布上拖动、缩放、旋转、删除 →
//      选中素材听双语音频 → 导出海报存相册 + 存 storage（我的作品）→ 用作品图去挑文创。

const collageApi = require('../../api/collage');
const { get: getStorage, set: setStorage } = require('../../utils/storage');
const audio = require('../../utils/audio');
const api = require('../../utils/api');

const DEFAULT_UI_MODE = 'normal';
const DEFAULT_VOICE_TYPE = 'mandarin';

// 作品本地存储：键名与 my-works 页保持一致
const WORKS_KEY = 'MY_WORKS';
const WORKS_LIMIT = 20;

// 定制文创默认带的商品 ID（goods-detail 尚未接入作品图，先带示例商品）
const CUSTOM_GOODS_ID = 'goods-01';

const UI_MODE_TEXT = {
  normal: '普通模式',
  elder: '长辈大字',
  child: '儿童简易'
};

const VOICE_TEXT = {
  mandarin: '普通话',
  hakka: '客家方言'
};

// 一键预置布局：坐标是 750 x 1000 设计稿坐标，与模板画布一致
const PRESETS = {
  'tpl-childlike': [
    { materialId: 'mat-childlike-01', x: 375, y: 320, scale: 1.7, rotate: 0 },
    { materialId: 'mat-childlike-03', x: 220, y: 620, scale: 1.0, rotate: -8 },
    { materialId: 'mat-childlike-04', x: 530, y: 640, scale: 1.0, rotate: 10 },
    { materialId: 'mat-childlike-02', x: 375, y: 830, scale: 1.1, rotate: 0 }
  ],
  'tpl-retro': [
    { materialId: 'mat-retro-01', x: 375, y: 330, scale: 1.8, rotate: 0 },
    { materialId: 'mat-retro-02', x: 225, y: 640, scale: 1.0, rotate: -6 },
    { materialId: 'mat-retro-03', x: 525, y: 620, scale: 1.0, rotate: 8 },
    { materialId: 'mat-retro-04', x: 375, y: 840, scale: 1.0, rotate: 0 }
  ]
};

Page({
  data: {
    uiMode: DEFAULT_UI_MODE,
    uiModeClass: '',
    voiceType: DEFAULT_VOICE_TYPE,
    voiceText: VOICE_TEXT[DEFAULT_VOICE_TYPE],
    rotateEnabled: true,

    loading: true,
    templates: [],
    activeTemplateId: '',
    activeTemplateName: '',
    materials: [],
    failedImages: {},

    selectedMaterialId: '',
    selectedName: '',
    selectedDesc: '',

    itemCount: 0,
    saving: false,
    navigating: false
  },

  onLoad() {
    this.templateList = [];
    this.materialList = [];
    this._canvasReady = false;
    this._pendingMaterials = [];
    this._lastPlayedMaterialId = '';

    this.loadData();
  },

  onShow() {
    this.syncConfig();
  },

  /* ==================== 全局配置 ==================== */

  /** 跟随全局 uiMode / voiceType（设置页改动后回到本页立即生效） */
  syncConfig() {
    const app = getApp();
    const globalData = (app && app.globalData) || {};

    const uiMode = globalData.uiMode || DEFAULT_UI_MODE;
    const voiceType = globalData.voiceType || DEFAULT_VOICE_TYPE;

    this.setData({
      uiMode: uiMode,
      uiModeClass: uiMode === 'normal' ? '' : 'ui-mode-' + uiMode,
      voiceType: voiceType,
      voiceText: VOICE_TEXT[voiceType] || VOICE_TEXT[DEFAULT_VOICE_TYPE],
      // 儿童模式禁用双指旋转手势
      rotateEnabled: uiMode !== 'child'
    });
  },

  /* ==================== 数据加载 ==================== */

  loadData() {
    this.setData({ loading: true });

    Promise.all([collageApi.getTemplates(), collageApi.getMaterials({})])
      .then((res) => {
        this.templateList = res[0] || [];
        this.materialList = res[1] || [];

        const first = this.templateList[0];
        const activeId = first ? first.templateId : '';

        this.setData({
          loading: false,
          templates: this.decorateTemplates(activeId),
          activeTemplateId: activeId,
          activeTemplateName: first ? first.name : '',
          materials: this.filterMaterials(activeId)
        });

        this.applyCanvasTitle();
      })
      .catch((err) => {
        console.error('[collage] 素材加载失败:', err);
        this.setData({ loading: false });
        wx.showToast({ title: '素材加载失败', icon: 'none' });
      });
  },

  /** 给模板列表打上 active / themeText，WXML 里直接判断 */
  decorateTemplates(activeId) {
    return this.templateList.map((item) => ({
      templateId: item.templateId,
      name: item.name,
      theme: item.theme,
      themeText: item.theme === 'childlike' ? '童趣' : '复古',
      coverUrl: item.coverUrl,
      active: item.templateId === activeId
    }));
  },

  filterMaterials(templateId) {
    if (!templateId) return this.materialList;

    return this.materialList.filter((item) => item.templateId === templateId);
  },

  materialOf(materialId) {
    if (!materialId) return null;

    const hit = this.materialList.filter((item) => item.id === materialId)[0];
    return hit || null;
  },

  /* ==================== 画布桥接 ==================== */

  canvas() {
    if (!this._canvasComp) {
      this._canvasComp = this.selectComponent('#dragCanvas');
    }
    return this._canvasComp;
  },

  applyCanvasTitle() {
    const comp = this.canvas();
    if (comp && this._canvasReady) {
      comp.setTitle(this.data.activeTemplateName);
    }
  },

  onCanvasReady() {
    this._canvasReady = true;

    const comp = this.canvas();
    if (comp) comp.setTitle(this.data.activeTemplateName);

    // 组件就绪前用户可能已经点过素材，这里补上
    const pending = this._pendingMaterials;
    this._pendingMaterials = [];

    pending.forEach((material) => {
      if (comp) comp.addMaterial(material);
    });
  },

  /** 加一个素材到画布；组件未就绪时先排队 */
  addToCanvas(material) {
    if (!material) return;

    const comp = this.canvas();

    if (comp && this._canvasReady) {
      comp.addMaterial(material);
      return;
    }

    this._pendingMaterials.push(material);
  },

  onCanvasSelect(e) {
    const detail = (e && e.detail) || {};
    const materialId = detail.materialId || '';

    if (!materialId) {
      this.setData({ selectedMaterialId: '', selectedName: '', selectedDesc: '' });
      return;
    }

    const material = this.materialOf(materialId);

    this.setData({
      selectedMaterialId: materialId,
      selectedName: (material && material.name) || detail.name || '',
      selectedDesc: (material && material.description) || ''
    });

    // 选中即按当前语音播报（长辈 / 儿童模式也免二次点击）
    this.playMaterialAudio(material);
  },

  onCanvasChange(e) {
    const items = (e && e.detail && e.detail.items) || [];
    this.setData({ itemCount: items.length });
  },

  /* ==================== 模板 / 预置 ==================== */

  onTemplateTap(e) {
    const templateId = e.currentTarget.dataset.id;
    if (!templateId || templateId === this.data.activeTemplateId) return;

    const hit = this.templateList.filter((item) => item.templateId === templateId)[0];
    if (!hit) return;

    this.setData({
      activeTemplateId: templateId,
      activeTemplateName: hit.name,
      templates: this.decorateTemplates(templateId),
      materials: this.filterMaterials(templateId),
      selectedMaterialId: '',
      selectedName: '',
      selectedDesc: ''
    });

    const comp = this.canvas();
    if (comp) {
      comp.clear();
      comp.setTitle(hit.name);
    }

    this._lastPlayedMaterialId = '';
  },

  /** 一键预置：把当前模板的推荐布局铺到画布上 */
  onPresetTap() {
    const templateId = this.data.activeTemplateId;
    const layout = PRESETS[templateId];

    if (!layout || !layout.length) {
      wx.showToast({ title: '这个模板暂无预置内容', icon: 'none' });
      return;
    }

    const comp = this.canvas();

    if (!comp || !this._canvasReady) {
      wx.showToast({ title: '画布还在准备中', icon: 'none' });
      return;
    }

    const list = [];

    layout.forEach((entry) => {
      const material = this.materialOf(entry.materialId);
      if (!material) return;

      list.push({
        material: material,
        x: entry.x,
        y: entry.y,
        scale: entry.scale,
        rotate: entry.rotate
      });
    });

    comp.preset(list);
    this._lastPlayedMaterialId = '';

    wx.showToast({ title: '已预置 ' + list.length + ' 个素材', icon: 'none' });
  },

  /* ==================== 素材操作 ==================== */

  onMaterialTap(e) {
    const materialId = e.currentTarget.dataset.id;
    const material = this.materialOf(materialId);

    if (!material) return;

    this.addToCanvas(material);
  },

  onImageError(e) {
    const id = e.currentTarget.dataset.id;
    if (!id) return;

    const failed = Object.assign({}, this.data.failedImages);
    failed[id] = true;

    this.setData({ failedImages: failed });
  },

  /* ==================== 音频 ==================== */

  onPlayAudio() {
    const material = this.materialOf(this.data.selectedMaterialId);

    if (!material) {
      wx.showToast({ title: '先选中一个素材', icon: 'none' });
      return;
    }

    this.playMaterialAudio(material, true);
  },

  /**
   * 按全局 voiceType 播放素材讲解
   * @param {Object} material 素材对象
   * @param {boolean} [force] 为 true 时即使同一素材也重播
   */
  playMaterialAudio(material, force) {
    if (!material) return;

    const isHakka = this.data.voiceType === 'hakka';
    const src = isHakka ? material.audioUrlHakka : material.audioUrlMandarin;

    if (!src) return;

    // 占位音频：不去尝试播放（必然失败），也不弹错误框。
    // 只有用户主动点「听普通话」时才温和说明一句，自动播报时完全静默。
    if (api.isMockUrl(src)) {
      if (force) wx.showToast({ title: '这段语音还没录好', icon: 'none' });
      return;
    }

    // 同一个素材反复选中时不重复播放
    if (!force && this._lastPlayedMaterialId === material.id) return;
    this._lastPlayedMaterialId = material.id;

    audio.play(src, {
      onError: () => {
        wx.showToast({ title: '语音加载失败，稍后再试', icon: 'none' });
      }
    });
  },

  /* ==================== 画布操作 ==================== */

  onDeleteSelected() {
    const comp = this.canvas();

    if (!comp || !comp.removeSelected()) {
      wx.showToast({ title: '先选中一个素材', icon: 'none' });
    }
  },

  onClear() {
    const comp = this.canvas();

    if (!comp || !comp.hasItems()) {
      wx.showToast({ title: '画布还是空的', icon: 'none' });
      return;
    }

    wx.showModal({
      title: '清空画布',
      content: '画布上的素材会全部移除，确定吗？',
      confirmColor: '#8b6f47',
      success: (res) => {
        if (!res.confirm) return;

        comp.clear();
        this._lastPlayedMaterialId = '';
      }
    });
  },

  /* ==================== 生成海报 ==================== */

  async onGenerateAI() {
    if (this.data.saving) return;
    const comp = this.canvas();
    if (!comp || !comp.hasItems()) {
      wx.showToast({ title: '先把素材放入画布', icon: 'none' });
      return;
    }
    this.setData({ saving: true });
    wx.showLoading({ title: '正在绘制家庭插画', mask: true });
    try {
      const templateId = this.data.activeTemplateId;
      const path = await comp.exportPoster();
      const image = await new Promise((resolve, reject) => {
        wx.getFileSystemManager().readFile({ filePath: path, encoding: 'base64',
          success: res => resolve('data:image/png;base64,' + res.data), fail: reject });
      });
      const result = await collageApi.generate({ templateId: templateId, image: image });
      await collageApi.saveWork({ workId: result.workId, imageUrl: result.imageUrl, title: '家庭专属插画' });
      const local = await new Promise((resolve, reject) => {
        wx.downloadFile({ url: result.imageUrl,
          success: res => res.statusCode === 200 ? resolve(res.tempFilePath) : reject(new Error('图片下载失败')),
          fail: reject });
      });
      const saved = await this.persistImage(local);
      const record = this.saveWorkRecord(saved);
      const list = getStorage(WORKS_KEY, []) || [];
      const index = list.findIndex(item => item.workId === record.workId);
      if (index >= 0) {
        list[index].workId = result.workId;
        list[index].imageUrl = result.imageUrl;
        setStorage(WORKS_KEY, list);
      }
      wx.hideLoading();
      wx.previewImage({ current: saved, urls: [saved] });
    } catch (err) {
      wx.hideLoading();
      wx.showModal({ title: '插画生成未完成', content: (err && (err.message || err.errMsg)) || '请稍后重试', showCancel: false });
    } finally {
      this.setData({ saving: false });
    }
  },

  onSavePoster() {
    if (this.data.saving) return;

    const comp = this.canvas();

    if (!comp || !comp.hasItems()) {
      wx.showToast({ title: '先把素材放入画布', icon: 'none' });
      return;
    }

    this.setData({ saving: true });

    comp
      .exportPoster()
      .then((tempPath) => this.persistImage(tempPath))
      .then((imagePath) => {
        this.saveWorkRecord(imagePath);

        return this.saveToAlbum(imagePath)
          .then(() => true)
          .catch(() => false);
      })
      .then((albumOk) => {
        wx.showToast({
          title: albumOk ? '已保存到相册' : '作品已存，相册未授权',
          icon: 'none'
        });

        audio.stop();
      })
      .catch((err) => {
        console.error('[collage] 生成海报失败:', err);
        wx.showToast({ title: '海报生成失败', icon: 'none' });
      })
      .then(() => {
        this.setData({ saving: false });
      });
  },

  /** 把临时图落到本地持久目录，避免重启后作品图失效 */
  persistImage(tempPath) {
    return new Promise((resolve) => {
      try {
        wx.getFileSystemManager().saveFile({
          tempFilePath: tempPath,
          success: (res) => resolve(res.savedFilePath || tempPath),
          fail: () => resolve(tempPath)
        });
      } catch (err) {
        console.warn('[collage] saveFile 不可用，退回临时路径:', err);
        resolve(tempPath);
      }
    });
  },

  saveToAlbum(filePath) {
    return new Promise((resolve, reject) => {
      wx.saveImageToPhotosAlbum({
        filePath: filePath,
        success: () => resolve(),
        fail: (err) => {
          const msg = (err && err.errMsg) || '';

          if (msg.indexOf('auth') > -1 || msg.indexOf('authorize') > -1) {
            wx.showModal({
              title: '需要相册权限',
              content: '保存海报需要「保存到相册」权限，请在设置里开启。',
              confirmText: '去设置',
              success: (res) => {
                if (res.confirm) wx.openSetting();
              }
            });
          }

          reject(err);
        }
      });
    });
  },

  /** 作品存本地 storage，供「我的作品」页展示 */
  saveWorkRecord(imagePath) {
    const now = new Date();
    const pad = (n) => (n < 10 ? '0' + n : '' + n);

    const createdAt =
      now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate()) +
      ' ' + pad(now.getHours()) + ':' + pad(now.getMinutes()) + ':' + pad(now.getSeconds());

    const record = {
      workId: 'work-' + now.getTime(),
      imagePath: imagePath,
      templateId: this.data.activeTemplateId,
      templateName: this.data.activeTemplateName,
      itemCount: this.data.itemCount,
      uiMode: this.data.uiMode,
      createdAt: createdAt
    };

    const list = getStorage(WORKS_KEY, []) || [];
    const next = [record].concat(list).slice(0, WORKS_LIMIT);

    setStorage(WORKS_KEY, next);

    // TODO 联调时同步到后端：collageApi.saveWork({ workId, imageUrl, title })

    return record;
  },

  /* ==================== 定制文创 ==================== */

  /** 带上作品图片参数跳到商品详情 */
  onCustomGoods() {
    if (this.data.navigating) return;

    const base = '/pages/goods-detail/goods-detail?goodsId=' + CUSTOM_GOODS_ID;
    const comp = this.canvas();

    if (!comp || !comp.hasItems()) {
      wx.navigateTo({ url: base, fail: () => wx.redirectTo({ url: base }) });
      return;
    }

    this.setData({ navigating: true });

    comp
      .exportPoster()
      .then((tempPath) => {
        const url = base + '&workImage=' + encodeURIComponent(tempPath);
        wx.navigateTo({
          url: url,
          fail: () => wx.redirectTo({ url: url }),
          complete: () => this.setData({ navigating: false })
        });
      })
      .catch((err) => {
        console.error('[collage] 作品图导出失败，降级跳转:', err);
        wx.navigateTo({
          url: base,
          fail: () => wx.redirectTo({ url: base }),
          complete: () => this.setData({ navigating: false })
        });
      });
  }
});
