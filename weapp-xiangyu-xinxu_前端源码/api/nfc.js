// api/nfc.js —— NFC 溯源相关接口
//
// 【mock 开关】开关只有一处：utils/api.js 顶部的 USE_MOCK。
//   USE_MOCK = true  -> request() 不发起任何网络请求，直接返回本文件传入的 mock 数据；
//   USE_MOCK = false -> request() 用 BASE_URL + url 发起真实请求。
// 两条路径 resolve 出来的数据结构完全一致，页面层不需要知道当前走的是哪条。
//
// 【返回约定】接口直接 resolve 业务数据（对象 / null），不额外包一层 { code, data, msg }。
// 如果后端统一使用 { code, data, msg } 信封，只需在 utils/api.js 的 networkRequest 里解包一次。

const { request } = require('../utils/api');
const mockNfc = require('../mock/mock-nfc');

/**
 * 根据 NFC 标签 ID 获取溯源详情
 * - 接口含义：用户碰一碰 NFC 标签后，用标签 ID 换取这条标签背后的故事、史料图和关联内容。
 * - 入参：tagId {string} NFC 标签唯一标识
 * - 返回：Promise<Object|null>，命中时字段如下；未命中 resolve null
 *     tagId            string   标签唯一标识
 *     title            string   标签标题
 *     storyText        string   故事文本
 *     historyImageUrls string[] 史料图片地址列表
 *     spotId           string   关联手绘地图点位 ID
 *     goodsId          string   关联文创商品 ID
 *     audioUrlMandarin string   普通话朗读音频地址
 *     audioUrlHakka    string   客家方言朗读音频地址
 */
function getTraceByTag(tagId) {
  return request({
    url: '/nfc/trace',
    method: 'GET',
    data: { tagId: tagId },
    mock: function (query) {
      const targetId = query && query.tagId;

      const hit = mockNfc.tags.filter(function (item) {
        return item.tagId === targetId;
      })[0];

      return hit || null;
    }
  });
}

/**
 * 上报一次 NFC 扫码记录
 * - 接口含义：记录用户何时何地扫了哪个标签，用于后台统计和后续运营。
 * - 入参：payload {Object}
 *     tagId     string  标签唯一标识
 *     scannedAt string  扫码时间，格式 YYYY-MM-DD HH:mm:ss
 *     latitude  number  扫码位置纬度（可空）
 *     longitude number  扫码位置经度（可空）
 * - 返回：Promise<Object>
 *     success    boolean 是否上报成功
 *     reportedAt string  服务端记录时间，格式 YYYY-MM-DD HH:mm:ss
 *     tagId      string  回执的标签 ID
 */
function reportScan(payload) {
  return request({
    url: '/nfc/scan-log',
    method: 'POST',
    data: payload,
    mock: function () {
      return mockNfc.reportResult;
    }
  });
}

module.exports = {
  getTraceByTag,
  reportScan
};
