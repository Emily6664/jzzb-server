// pages/local-map/local-map.js —— 围山手绘动态地图
//
// 流程：铺手绘底图 → 用 utils/map-calc 把设计稿像素换算成屏幕坐标 →
//      按坐标渲染「围山小守」小狗标记 → 点小狗弹窗（名称 / 简介 / 配图）→
//      导航按钮用真实经纬度唤起 wx.openLocation。
//
// 【定位怎么做的】
//   utils/geo.js 用「标定锚点」拟合一个 经纬度 → 图上像素 的变换。
//   - 残差够小：画精确落点「你在这里」（precise）
//   - 残差太大（坐标数据不可信）：只圈住最近的点位 + 报距离方位（near），绝不假装精确
//   - LOCATION_ENABLE=false（演示默认）：用模拟位置，界面标「模拟」，不依赖接口审批
//
// 屏幕适配说明：mock 里的 mapX / mapY 是设计稿 750 x 1334 的绝对像素，
// 这里统一经 mapCalc.imageToView() 换算成页面实际渲染尺寸下的坐标，
// 所以换任何屏幕宽度，小狗都落在底图上同一个位置。

const mapApi = require('../../api/map');
const mapCalc = require('../../utils/map-calc');
const geo = require('../../utils/geo');

const DEFAULT_UI_MODE = 'normal';

const UI_MODE_TEXT = { normal: '普通模式', elder: '长辈大字', child: '儿童简易' };

// 手绘底图与「围山小守」小狗标记（本地资源，换成 CDN 地址也能用）
const MAP_IMAGE_URL = '/assets/map/map-base.png';
const DOG_IMAGE_URL = '/assets/map/dog-marker.png';

// 底图设计稿尺寸：必须与 mock/mock-map-spots.js 里 mapX / mapY 的坐标系一致
const MAP_DESIGN = { width: 750, height: 1334 };

// 页面左右内边距，与 wxss 里 .page 的 padding 保持一致（左右各 32rpx）
const PAGE_PADDING_RPX = 32;

// 地图区域最多占屏幕高度的比例
const MAX_HEIGHT_RATIO = 0.62;

// 落点允许超出设计稿边缘的容差（像素），超出就钳到边上，避免圆点跑到画外
const OFF_MAP_TOLERANCE = 40;

Page({
  data: {
    uiMode: DEFAULT_UI_MODE,
    uiModeClass: '',
    uiModeText: UI_MODE_TEXT[DEFAULT_UI_MODE],

    mapImageUrl: MAP_IMAGE_URL,
    dogImageUrl: DOG_IMAGE_URL,

    loading: true,
    spots: [],
    markers: [],
    stageW: 0,
    stageH: 0,

    // —— 定位相关 ——
    // userPoint：精确落点（precise 模式），{ left, top } 舞台像素
    // nearPoint：最近点位的舞台像素，near 模式在它周围画圈
    userPoint: null,
    nearPoint: null,
    userMode: 'none', // none | precise | near
    locateState: 'idle', // idle | locating | exact | fuzzy | simulated | denied
    locateTag: '', // '' | 模糊 | 模拟
    locateText: '',
    locateActText: '',

    mapFailed: false,
    activeSpot: null,
    sheetImageFailed: false,
    errorText: ''
  },

  onLoad(options) {
    // NFC 溯源页会带 ?spotId=xxx 跳过来，存在就自动打开对应点位
    this._pendingSpotId = (options && options.spotId) || '';
    this._pendingApplied = false;
    this._markerRetry = 0;

    // 定位状态：位置、来源、上次定位时间、拟合模型缓存
    this._userLatLng = null;
    this._locateSource = '';
    this._locateReason = '';
    this._locatedAt = 0;
    this._geoModel = null;
    this._geoModelKey = '';

    this.syncConfig();
    this.initLayout();
    this.loadSpots();
    this.bindResize();
  },

  onShow() {
    this.syncConfig();
    this.consumePendingSpot();
    // 60 秒内不重复定位，避免每次切 tab 都弹权限框
    this.locateOnce(false);
  },

  onUnload() {
    this.unbindResize();
  },

  /**
   * 从 NFC 页 switchTab 过来时，spotId 走全局变量传（tabBar 页不能带 URL 参数）。
   * 读到就打开对应点位，并清掉标记，避免下次切回本 tab 又弹一次。
   */
  consumePendingSpot() {
    const app = getApp();
    const pending = app && app.globalData && app.globalData.pendingSpotId;

    if (!pending) return;

    app.globalData.pendingSpotId = '';

    const spot = this.spotOf(pending);

    if (spot) {
      this.openSpot(spot);
      return;
    }

    // 点位数据还没加载完，交给 applyPendingSpot() 兜住
    this._pendingSpotId = pending;
    this._pendingApplied = false;
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

  /* ==================== 布局 ==================== */

  /** 按屏幕宽度算出地图区域尺寸，保持 750:1334 比例 */
  initLayout() {
    let win = null;

    try {
      win = typeof wx.getWindowInfo === 'function' ? wx.getWindowInfo() : wx.getSystemInfoSync();
    } catch (err) {
      console.error('[local-map] 获取窗口信息失败:', err);
    }

    const winW = (win && win.windowWidth) || 375;
    const winH = (win && win.windowHeight) || 667;

    const rpx = winW / 750;
    const padPx = PAGE_PADDING_RPX * rpx * 2;

    let stageW = winW - padPx;
    let stageH = (stageW * MAP_DESIGN.height) / MAP_DESIGN.width;

    // 太高就按高度反推宽度，地图居中显示
    const maxH = winH * MAX_HEIGHT_RATIO;
    if (stageH > maxH) {
      stageH = maxH;
      stageW = (stageH * MAP_DESIGN.width) / MAP_DESIGN.height;
    }

    this.setData({ stageW: Math.round(stageW), stageH: Math.round(stageH) }, () => this.computeMarkers());
  },

  /** 屏幕旋转 / 分屏时重新算一遍，避免点位错位 */
  bindResize() {
    if (typeof wx.onWindowResize !== 'function') return;

    this._onResize = () => {
      this.initLayout();
    };

    wx.onWindowResize(this._onResize);
  },

  unbindResize() {
    if (this._onResize && typeof wx.offWindowResize === 'function') {
      wx.offWindowResize(this._onResize);
    }
    this._onResize = null;
  },

  /* ==================== 数据 ==================== */

  loadSpots() {
    this.setData({ loading: true, errorText: '' });

    mapApi
      .getSpots({})
      .then((spots) => {
        this.setData({ loading: false, spots: spots || [] });
        this.computeMarkers();
      })
      .catch((err) => {
        console.error('[local-map] 点位加载失败:', err);
        this.setData({ loading: false, errorText: '点位加载失败，请稍后重试' });
        wx.showToast({ title: '点位加载失败', icon: 'none' });
      });
  },

  spotOf(spotId) {
    if (!spotId) return null;

    const list = this.data.spots || [];
    for (let i = 0; i < list.length; i++) {
      if (list[i].spotId === spotId) return list[i];
    }
    return null;
  },

  /* ==================== 坐标换算 ==================== */

  /** 量出地图区域真实尺寸，把设计稿坐标换算成屏幕坐标 */
  computeMarkers() {
    const query = wx.createSelectorQuery();

    query
      .select('#mapStage')
      .boundingClientRect((rect) => {
        const target = {
          width: (rect && rect.width) || this.data.stageW,
          height: (rect && rect.height) || this.data.stageH
        };

        if (!target.width || !target.height) {
          // 布局还没量到，重试几次
          if (this._markerRetry < 10) {
            this._markerRetry++;
            setTimeout(() => this.computeMarkers(), 60);
          }
          return;
        }

        this._markerRetry = 0;

        const markers = (this.data.spots || []).map((spot) => {
          const pos = mapCalc.imageToView({ x: spot.mapX, y: spot.mapY }, MAP_DESIGN, target);

          return {
            spotId: spot.spotId,
            name: spot.name,
            left: pos ? pos.x : 0,
            top: pos ? pos.y : 0
          };
        });

        this.setData({ markers: markers }, () => {
          this.applyPendingSpot();
          this.refreshUserAfterLayout();
        });
      })
      .exec();
  },

  /** 舞台尺寸变了：有位置就重画，没位置就补一次定位（模拟模式） */
  refreshUserAfterLayout() {
    if (this._userLatLng) {
      this.applyUserPoint(this._locateSource, this._locateReason);
      return;
    }

    if (geo.LOCATION_MODE === 'off') this.useSimulatedPosition('off');
  },

  /** 处理 NFC 页带过来的 spotId：等点位加载完再自动弹窗 */
  applyPendingSpot() {
    if (!this._pendingSpotId || this._pendingApplied) return;
    if (!this.data.spots.length) return;

    this._pendingApplied = true;

    const spot = this.spotOf(this._pendingSpotId);

    if (!spot) {
      wx.showToast({ title: '没有找到点位 ' + this._pendingSpotId, icon: 'none' });
      return;
    }

    this.openSpot(spot);
  },

  /* ==================== 定位 ==================== */

  /**
   * 取一次位置：按 LOCATION_MODE 选接口，失败按 LOCATION_FALLBACK 降级。
   * @param {boolean} force true = 忽略缓存（点了「重新定位」）
   */
  locateOnce(force) {
    const now = Date.now();

    if (!force && this._locatedAt && now - this._locatedAt < geo.LOCATION_TTL_MS) {
      this.applyUserPoint(this._locateSource, this._locateReason);
      return;
    }

    if (geo.LOCATION_MODE === 'off') {
      this.useSimulatedPosition('off');
      return;
    }

    this.setData({ locateState: 'locating', locateText: '正在定位…', locateActText: '', locateTag: '' });

    this.tryLocate(geo.LOCATION_MODE === 'fuzzy' ? 'fuzzy' : 'exact');
  },

  /** 调一次具体接口：exact = wx.getLocation，fuzzy = wx.getFuzzyLocation */
  tryLocate(mode) {
    const isFuzzy = mode === 'fuzzy';
    let api = null;

    if (isFuzzy) {
      api = typeof wx.getFuzzyLocation === 'function' ? wx.getFuzzyLocation : null;
    } else {
      api = typeof wx.getLocation === 'function' ? wx.getLocation : null;
    }

    if (!api) {
      this.onLocateFail(mode, { errMsg: 'api not support: ' + mode });
      return;
    }

    const options = {
      type: 'gcj02',
      success: (res) => {
        this._userLatLng = { latitude: res.latitude, longitude: res.longitude };
        this._locateSource = mode;
        this._locateReason = '';
        this._locatedAt = Date.now();
        this.applyUserPoint(mode, '');
      },
      fail: (err) => this.onLocateFail(mode, err)
    };

    // 高精度开关只有精确接口有，模糊接口不认这个参数
    if (!isFuzzy) options.isHighAccuracy = false;

    api.call(wx, options);
  },

  /**
   * 定位失败：先分清「用户拒绝」还是「接口没开通」，两者处理完全不同。
   * - 用户拒绝：不降级（降级会掩盖用户的选择），引导去设置
   * - 接口未开通 / 临时失败：exact 再试 fuzzy，最后退到模拟位置并如实标注
   */
  onLocateFail(mode, err) {
    const kind = geo.classifyLocateError(err);

    if (kind === 'denied') {
      console.warn('[local-map] ' + mode + ' 定位被用户拒绝:', err);
      this._userLatLng = null;
      this._locateSource = '';
      this._locateReason = '';
      this._locatedAt = Date.now();
      this.setData({
        userPoint: null,
        nearPoint: null,
        userMode: 'none',
        locateState: 'denied',
        locateTag: '',
        locateText: '没开定位权限 · 点小狗一样能导航',
        locateActText: '去设置'
      });
      return;
    }

    console.warn('[local-map] ' + mode + ' 定位失败(' + kind + '):', err);

    if (geo.LOCATION_FALLBACK && mode === 'exact' && geo.LOCATION_MODE !== 'fuzzy') {
      this.tryLocate('fuzzy');
      return;
    }

    this.useSimulatedPosition(kind);
  },

  /** 退到模拟位置：界面标「模拟」，绝不假装是真实定位 */
  useSimulatedPosition(reason) {
    const pos = geo.simulatedPosition(this.data.spots);

    if (!pos) {
      this.setData({ locateState: 'idle', locateText: '点位加载中…', locateActText: '', locateTag: '' });
      return;
    }

    this._userLatLng = pos;
    this._locateSource = 'simulated';
    this._locateReason = reason || '';
    this._locatedAt = Date.now();

    this.applyUserPoint('simulated', this._locateReason);
  },

  /** 有了经纬度之后：算最近点位 / 投影到图上 / 写文案 */
  applyUserPoint(source, reason) {
    const here = this._userLatLng;
    const spots = this.data.spots || [];

    if (!here || !spots.length) {
      this.setData({ locateState: 'idle', locateText: '点位加载中…', locateActText: '' });
      return;
    }

    const nearest = geo.nearestSpot(here.latitude, here.longitude, spots);
    const fit = this.geoModel(spots);

    let userPoint = null;
    let userMode = 'none';

    if (fit && fit.ok) {
      const projected = geo.projectToMap(here.latitude, here.longitude, fit.model);

      if (
        projected &&
        projected.x >= -OFF_MAP_TOLERANCE &&
        projected.x <= MAP_DESIGN.width + OFF_MAP_TOLERANCE &&
        projected.y >= -OFF_MAP_TOLERANCE &&
        projected.y <= MAP_DESIGN.height + OFF_MAP_TOLERANCE
      ) {
        const view = mapCalc.imageToView({ x: projected.x, y: projected.y }, MAP_DESIGN, {
          width: this.data.stageW,
          height: this.data.stageH
        });

        if (view) {
          userPoint = { left: Math.round(view.x), top: Math.round(view.y) };
          userMode = 'precise';
        }
      }
    }

    // 不能用精确落点时，退到「圈住最近的点位」
    let nearPoint = null;
    if (!userPoint && nearest) {
      const marker = this.markerOf(nearest.spot.spotId);
      if (marker) {
        nearPoint = { left: Math.round(marker.left), top: Math.round(marker.top) };
        userMode = 'near';
      }
    }

    // 标签与前缀：模糊要标「模糊」，模拟要标「模拟」，精确什么都不标
    let tag = '';
    if (source === 'fuzzy') tag = '模糊';
    if (source === 'simulated') tag = '模拟';

    let prefix = '';
    if (source === 'fuzzy') {
      prefix = '模糊定位约 1 公里 · ';
    } else if (source === 'simulated') {
      if (reason === 'not-approved') prefix = '接口未开通 · 示意位置 · ';
      else if (reason === 'failed') prefix = '定位没成功 · 示意位置 · ';
    }

    this.setData({
      userPoint: userPoint,
      nearPoint: nearPoint,
      userMode: userMode,
      locateState: source,
      locateTag: tag,
      locateText: prefix + this.buildLocateText(nearest),
      locateActText: '重新定位'
    });
  },

  /** 拟合模型（按点位数据缓存，数据变了才重算） */
  geoModel(spots) {
    const anchors = geo.pickAnchors(spots);
    const source = geo.CALIBRATION.length >= 2 ? geo.CALIBRATION : anchors;
    const key = source
      .map((a) => [a.spotId || '', a.latitude, a.longitude, a.mapX, a.mapY].join(','))
      .join('|');

    if (this._geoModel && this._geoModelKey === key) return this._geoModel;

    this._geoModel = geo.buildModel(source);
    this._geoModelKey = key;

    if (this._geoModel.rms != null && !this._geoModel.ok) {
      console.warn(
        '[local-map] 标定残差过大（rms=' +
          Math.round(this._geoModel.rms) +
          'px，阈值 ' +
          geo.RMS_TOLERANCE_PX +
          'px），改用「最近点位」指示。要精确落点请在 utils/geo.js 的 CALIBRATION 里填 2 个真实坐标。'
      );
    }

    return this._geoModel;
  },

  markerOf(spotId) {
    const markers = this.data.markers || [];
    for (let i = 0; i < markers.length; i++) {
      if (markers[i].spotId === spotId) return markers[i];
    }
    return null;
  },

  /** 一句人话：你在哪、离谁多远、往哪走 */
  buildLocateText(nearest) {
    if (!nearest) return '还没拿到点位数据';

    const name = nearest.spot.name;
    const dist = geo.formatDistance(nearest.distance);

    if (nearest.band === 'here') return '你就在' + name;
    if (nearest.band === 'near') return '你在这附近 · 最近是' + name + ' · ' + dist + ' · ' + nearest.bearingText;
    return '离你最近的是' + name + ' · ' + dist + ' · ' + nearest.bearingText + '，点它可以导航';
  },

  /** 重新定位；被拒绝过就去设置页 */
  onRelocate() {
    if (this.data.locateState === 'denied') {
      if (typeof wx.openSetting !== 'function') return;

      wx.openSetting({
        success: (res) => {
          const granted = res && res.authSetting && res.authSetting['scope.userLocation'];
          if (granted) this.locateOnce(true);
        }
      });
      return;
    }

    this.locateOnce(true);
  },

  /* ==================== 弹窗 ==================== */

  onSpotTap(e) {
    const spotId = e.currentTarget.dataset.id;
    const spot = this.spotOf(spotId);

    if (!spot) return;

    this.openSpot(spot);
  },

  openSpot(spot) {
    this.setData({
      activeSpot: spot,
      sheetImageFailed: false
    });
  },

  onClosePopup() {
    this.setData({ activeSpot: null });
  },

  /** 弹窗内部点击不冒泡到遮罩 */
  stopBubble() {},

  /** 遮罩上禁止滚动穿透 */
  noop() {},

  /* ==================== 图片 ==================== */

  onMapError() {
    console.warn('[local-map] 底图加载失败:', MAP_IMAGE_URL);
    this.setData({ mapFailed: true });
  },

  onSheetImageError() {
    this.setData({ sheetImageFailed: true });
  },

  onPreviewImage() {
    const spot = this.data.activeSpot;
    if (!spot || !spot.imageUrl) return;

    wx.previewImage({ current: spot.imageUrl, urls: [spot.imageUrl] });
  },

  /* ==================== 导航 ==================== */

  onNavigate() {
    const spot = this.data.activeSpot;

    if (!spot) return;

    if (typeof spot.latitude !== 'number' || typeof spot.longitude !== 'number') {
      wx.showToast({ title: '这个点位没有经纬度', icon: 'none' });
      return;
    }

    wx.openLocation({
      latitude: spot.latitude,
      longitude: spot.longitude,
      name: spot.name,
      address: spot.description || '',
      scale: 18,
      fail: (err) => {
        console.error('[local-map] 打开地图失败:', err);
        wx.showToast({ title: '打开地图失败', icon: 'none' });
      }
    });
  }
});
