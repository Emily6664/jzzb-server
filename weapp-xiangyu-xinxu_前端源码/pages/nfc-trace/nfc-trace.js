// pages/nfc-trace/nfc-trace.js —— NFC 溯源
//
// 流程：能力检测 → 触碰 / 扫码 / 模拟演示 拿到 tagId → nfcApi.getTraceByTag →
//      渲染故事文本与史料图片 → 按全局 voiceType 播放音频 →
//      跳转地图点位（spotId）或商品详情（goodsId）。
//
// 使用 NFCAdapter 读取 NDEF；小程序外唤起由微信设备能力另行配置。

const nfcApi = require('../../api/nfc');
const audio = require('../../utils/audio');
const api = require('../../utils/api');

const DEFAULT_UI_MODE = 'normal';
const DEFAULT_VOICE_TYPE = 'mandarin';

const UI_MODE_TEXT = { normal: '普通模式', elder: '长辈大字', child: '儿童简易' };
const VOICE_TEXT = { mandarin: '普通话', hakka: '客家方言' };

// 答辩演示用的示例标签（与 mock/mock-nfc.js 的 tagId 对齐）
const DEMO_TAGS = ['NFC-TAG-0001', 'NFC-TAG-0002', 'NFC-TAG-0003', 'NFC-TAG-0004'];
const DEFAULT_DEMO_TAG = DEMO_TAGS[0];

// 等待触碰的超时时间，避免「正在读取」一直卡着
const READ_TIMEOUT = 20000;

/* ==================================================================
 * NFC 适配层（页面内封装，不改动 utils / api）
 * ================================================================== */

/**
 * 从各种可能的读卡回调里提取 tagId
 * @param {Object} res 读卡回调对象
 * @returns {string} 解析不出时返回空字符串
 */
function extractTagId(text) {
  if (typeof text !== 'string') return '';
  const value = text.trim();
  const match = value.match(/(?:[?&]|^)(?:tagId|tag)=([^&#]+)/i);
  let id = match ? match[1] : value;
  try { id = decodeURIComponent(id); } catch (err) { return ''; }
  if (!match && id.indexOf('xiangyu://nfc/') === 0) id = id.slice(14);
  return /^[A-Za-z0-9_-]{1,128}$/.test(id) ? id : '';
}

function recordTagId(record) {
  const type = new Uint8Array(record.type || new ArrayBuffer(0));
  const payload = new Uint8Array(record.payload || new ArrayBuffer(0));
  if (!payload.length) return '';
  // NDEF Text: 状态字节 + 语言代码；URI: 首字节为 URI 前缀编号。
  let offset = 0;
  if (type.length === 1 && type[0] === 84) {
    if (payload[0] & 128) return ''; // 本项目写入 UTF-8 文本。
    offset = 1 + (payload[0] & 63);
  } else if (type.length === 1 && type[0] === 85) {
    offset = 1;
  } else { return ''; }
  let text = '';
  for (let i = offset; i < payload.length; i++) text += String.fromCharCode(payload[i]);
  return extractTagId(text);
}

let reader = null;
let discovered = null;
function probeNfc() {
  return Promise.resolve({
    supported: typeof wx.getNFCAdapter === 'function',
    reason: typeof wx.getNFCAdapter === 'function' ? '' : '当前微信环境不支持页面内读卡，可扫码查看故事'
  });
}
function startNfcReader(handlers) {
  try {
    reader = wx.getNFCAdapter();
    discovered = (event) => {
      const messages = event.messages || [];
      for (let i = 0; i < messages.length; i++) {
        const records = messages[i].records || [];
        for (let j = 0; j < records.length; j++) {
          const id = recordTagId(records[j]);
          if (id) { handlers.onTag(id); return; }
        }
      }
      handlers.onError({ message: '标签没有有效的溯源编号，请先写入 NDEF 标签内容' });
    };
    reader.onDiscovered(discovered);
    reader.startDiscovery({
      fail: (err) => handlers.onError({ message: (err && err.errMsg) || '请检查手机 NFC 是否开启' })
    });
    return true;
  } catch (err) {
    handlers.onError({ message: '当前设备无法读卡，请扫码查看故事' });
    return false;
  }
}
function stopNfcReader() {
  const current = reader;
  reader = null;
  if (!current) return;
  try {
    if (discovered) current.offDiscovered(discovered);
    current.stopDiscovery({ fail: () => {} });
  } catch (err) { console.warn('[nfc-trace] 停止读卡失败', err); }
  discovered = null;
}

/* ==================================================================
 * 页面
 * ================================================================== */

Page({
  data: {
    uiMode: DEFAULT_UI_MODE,
    uiModeClass: '',
    uiModeText: UI_MODE_TEXT[DEFAULT_UI_MODE],
    voiceType: DEFAULT_VOICE_TYPE,
    voiceText: VOICE_TEXT[DEFAULT_VOICE_TYPE],

    // NFC 能力
    nfcReady: false,
    nfcSupported: false,
    nfcReason: '',
    reading: false,

    // 演示
    demoTags: DEMO_TAGS,
    demoTagId: DEFAULT_DEMO_TAG,

    // 数据
    loading: false,
    trace: null,
    playing: false,
    historyFailed: {},
    errorText: ''
  },

  onLoad(options) {
    this._readTimer = null;

    this.syncConfig();
    this.loadCapability();
    const query = options || {};
    let scene = query.scene || '';
    try { scene = decodeURIComponent(scene); } catch (err) { scene = ''; }
    const tagId = extractTagId(query.tagId || scene || query.q || '');
    if (tagId) this.loadTrace(tagId);
  },

  onShow() {
    this.syncConfig();
  },

  onHide() {
    this.stopAudio();
    this.cancelRead();
  },

  onUnload() {
    this.stopAudio();
    this.cancelRead();
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
      voiceType: voiceType,
      voiceText: VOICE_TEXT[voiceType] || VOICE_TEXT[DEFAULT_VOICE_TYPE]
    });
  },

  /* ==================== NFC 能力检测 ==================== */

  loadCapability() {
    probeNfc().then((info) => {
      this.setData({
        nfcReady: true,
        nfcSupported: !!info.supported,
        nfcReason: info.reason || ''
      });
    });
  },

  /* ==================== 读取入口 ==================== */

  /** 触碰 NFC 标签 */
  onTouchTap() {
    if (!this.data.nfcSupported || this.data.reading) return;

    this.setData({ reading: true, errorText: '' });

    const started = startNfcReader({
      onTag: (tagId) => {
        this.clearReadTimer();
        stopNfcReader();
        this.setData({ reading: false });
        this.loadTrace(tagId);
      },
      onError: (err) => {
        this.clearReadTimer();
        stopNfcReader();
        this.setData({ reading: false, errorText: err.message || 'NFC 读取失败' });
        wx.showToast({ title: err.message || 'NFC 读取失败', icon: 'none' });
      }
    });

    if (!started) {
      this.clearReadTimer();
      this.setData({ reading: false });
      return;
    }

    // 超时兜底：一直没碰到标签就恢复按钮
    this.clearReadTimer();
    this._readTimer = setTimeout(() => {
      stopNfcReader();
      this.setData({ reading: false, errorText: '等待超时，请重新碰一下标签' });
    }, READ_TIMEOUT);
  },

  onCancelRead() {
    if (!this.data.reading) return;

    this.cancelRead();
    this.setData({ reading: false });
  },

  cancelRead() {
    this.clearReadTimer();
    stopNfcReader();
  },

  clearReadTimer() {
    if (this._readTimer) {
      clearTimeout(this._readTimer);
      this._readTimer = null;
    }
  },

  /** 扫码入口：扫二维码 / 条形码拿 tagId */
  onScanTap() {
    wx.scanCode({
      scanType: ['qrCode', 'barCode'],
      success: (res) => {
        const tagId = extractTagId(res && res.result);
        if (!tagId) {
          wx.showToast({ title: '没识别到标签 ID', icon: 'none' });
          return;
        }
        this.loadTrace(tagId);
      },
      fail: (err) => {
        const msg = (err && err.errMsg) || '';
        // 用户主动取消不打扰
        if (msg.indexOf('cancel') > -1) return;
        wx.showToast({ title: '扫码失败，请重试', icon: 'none' });
      }
    });
  },

  /* ==================== 模拟演示 ==================== */

  onDemoInput(e) {
    this.setData({ demoTagId: (e && e.detail && e.detail.value) || '' });
  },

  onDemoTap() {
    const tagId = extractTagId(this.data.demoTagId);
    if (!tagId) {
      wx.showToast({ title: '请输入 tagId', icon: 'none' });
      return;
    }
    this.loadTrace(tagId);
  },

  onDemoChipTap(e) {
    const tagId = e.currentTarget.dataset.tag;
    if (!tagId) return;

    this.setData({ demoTagId: tagId });
    this.loadTrace(tagId);
  },

  /* ==================== 数据 ==================== */

  /**
   * 用 tagId 拉取溯源详情
   * @param {string} rawTagId 可能带 URL 前缀的原始值
   */
  loadTrace(rawTagId) {
    const tagId = extractTagId(rawTagId);

    if (!tagId) {
      wx.showToast({ title: 'tagId 无效', icon: 'none' });
      return;
    }

    this.stopAudio();
    this.setData({ loading: true, errorText: '', playing: false, historyFailed: {} });

    nfcApi
      .getTraceByTag(tagId)
      .then((trace) => {
        if (!trace) {
          this.setData({
            loading: false,
            trace: null,
            errorText: '没有查到标签「' + tagId + '」，换一个 tagId 或标签试试'
          });
          wx.showToast({ title: '标签未登记', icon: 'none' });
          return;
        }

        this.setData({ loading: false, trace: trace, demoTagId: tagId });

        // 读卡成功后静默上报一次，失败不影响主流程
        this.reportScan(tagId);

        // 拿到内容就把故事读出来，长辈 / 儿童模式不用再点一次
        this.playTraceAudio();
      })
      .catch((err) => {
        console.error('[nfc-trace] 溯源数据加载失败:', err);
        this.setData({ loading: false, errorText: '数据加载失败，请稍后重试' });
        wx.showToast({ title: '数据加载失败', icon: 'none' });
      });
  },

  /** 静默上报扫码记录 */
  reportScan(tagId) {
    nfcApi
      .reportScan({ tagId: tagId, scannedAt: this.formatNow() })
      .catch((err) => console.warn('[nfc-trace] 扫码上报失败（不阻塞）:', err));
  },

  formatNow() {
    const now = new Date();
    const pad = (n) => (n < 10 ? '0' + n : '' + n);

    return (
      now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate()) +
      ' ' + pad(now.getHours()) + ':' + pad(now.getMinutes()) + ':' + pad(now.getSeconds())
    );
  },

  /* ==================== 音频 ==================== */

  onToggleAudio() {
    if (this.data.playing) {
      this.stopAudio();
      return;
    }

    this.playTraceAudio();
  },

  /** 按全局 voiceType 播放当前故事的音频 */
  playTraceAudio() {
    const trace = this.data.trace;
    if (!trace) return;

    const isHakka = this.data.voiceType === 'hakka';
    const src = isHakka ? trace.audioUrlHakka : trace.audioUrlMandarin;

    if (!src) {
      wx.showToast({ title: '这条故事暂无' + this.data.voiceText + '音频', icon: 'none' });
      return;
    }

    // 占位音频还没录：直接说明，不进入"播放中"状态，也不报"播放失败"
    if (api.isMockUrl(src)) {
      wx.showToast({ title: '这段故事还没录音', icon: 'none' });
      return;
    }

    this.setData({ playing: true });

    audio.play(src, {
      onEnded: () => {
        this.setData({ playing: false });
      },
      onError: () => {
        this.setData({ playing: false });
        wx.showToast({ title: '语音加载失败，稍后再试', icon: 'none' });
      }
    });
  },

  stopAudio() {
    audio.stop();

    if (this.data.playing) {
      this.setData({ playing: false });
    }
  },

  /* ==================== 史料图片 ==================== */

  onPreviewImage(e) {
    const src = e.currentTarget.dataset.src;
    const urls = (this.data.trace && this.data.trace.historyImageUrls) || [];

    if (!src || !urls.length) return;

    wx.previewImage({ current: src, urls: urls });
  },

  onHistoryImageError(e) {
    const index = e.currentTarget.dataset.idx;
    if (index === undefined || index === null) return;

    const failed = Object.assign({}, this.data.historyFailed);
    failed[index] = true;

    this.setData({ historyFailed: failed });
  },

  /* ==================== 跳转 ==================== */

  onViewSpot() {
    const spotId = (this.data.trace && this.data.trace.spotId) || '';
    if (!spotId) {
      wx.showToast({ title: '这条故事没有关联点位', icon: 'none' });
      return;
    }

    // 地图是 tabBar 页：switchTab 不能带参数，spotId 通过全局变量传递
    const app = getApp();
    if (app && app.globalData) app.globalData.pendingSpotId = spotId;

    wx.switchTab({
      url: '/pages/local-map/local-map',
      fail: () => wx.reLaunch({ url: '/pages/local-map/local-map' })
    });
  },

  onViewGoods() {
    const goodsId = (this.data.trace && this.data.trace.goodsId) || '';
    if (!goodsId) {
      wx.showToast({ title: '这条故事没有关联商品', icon: 'none' });
      return;
    }

    wx.navigateTo({
      url: '/pages/goods-detail/goods-detail?goodsId=' + goodsId,
      fail: () => wx.redirectTo({ url: '/pages/goods-detail/goods-detail?goodsId=' + goodsId })
    });
  }
});
