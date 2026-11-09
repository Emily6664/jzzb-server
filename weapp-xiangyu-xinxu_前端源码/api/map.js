// api/map.js —— 手绘地图点位接口
//
// 【mock 开关】开关只有一处：utils/api.js 顶部的 USE_MOCK。
//   USE_MOCK = true  -> request() 不发起任何网络请求，直接返回本文件传入的 mock 数据；
//   USE_MOCK = false -> request() 用 BASE_URL + url 发起真实请求。
// 两条路径 resolve 出来的数据结构完全一致，页面层不需要知道当前走的是哪条。
//
// 【返回约定】接口直接 resolve 业务数据（数组 / 对象 / null），不额外包一层 { code, data, msg }。
// 如果后端统一使用 { code, data, msg } 信封，只需在 utils/api.js 的 networkRequest 里解包一次。
//
// 【坐标系说明】mapX / mapY 是手绘地图设计稿上的绝对像素（设计稿 750 x 1334），
// 不是百分比也不是 rpx，渲染前需要用 utils/map-calc.js 换算成当前屏幕的坐标。
// latitude / longitude 是真实经纬度（GCJ-02），只用于跳转 wx.openLocation。

const { request } = require('../utils/api');
const mockMapSpots = require('../mock/mock-map-spots');

/**
 * 获取手绘地图点位列表
 * - 接口含义：返回手绘地图上全部点位，用于在地图底图上打点。
 * - 入参：params {Object} 可选
 *     spotIds string[]  只取指定点位；不传则返回全部点位
 * - 返回：Promise<Array<Object>>，每项字段如下
 *     spotId      string  点位 ID
 *     name        string  地点名称
 *     mapX        number  设计稿原始像素 X 坐标（0~750）
 *     mapY        number  设计稿原始像素 Y 坐标（0~1334）
 *     description string  地点描述
 *     imageUrl    string  点位配图地址
 *     latitude    number  真实纬度（GCJ-02）
 *     longitude   number  真实经度（GCJ-02）
 */
function getSpots(params) {
  return request({
    url: '/map/spots',
    method: 'GET',
    data: params,
    mock: function (query) {
      const spotIds = query && query.spotIds;
      if (!spotIds || !spotIds.length) return mockMapSpots.spots;

      return mockMapSpots.spots.filter(function (item) {
        return spotIds.indexOf(item.spotId) > -1;
      });
    }
  });
}

/**
 * 获取单个点位详情
 * - 接口含义：点击地图上的点位后，拉取该点位的完整信息。
 * - 入参：spotId {string} 点位 ID
 * - 返回：Promise<Object|null>，字段与 getSpots 的列表项完全一致；未命中 resolve null
 *     spotId      string  点位 ID
 *     name        string  地点名称
 *     mapX        number  设计稿原始像素 X 坐标（0~750）
 *     mapY        number  设计稿原始像素 Y 坐标（0~1334）
 *     description string  地点描述
 *     imageUrl    string  点位配图地址
 *     latitude    number  真实纬度（GCJ-02）
 *     longitude   number  真实经度（GCJ-02）
 */
function getSpotDetail(spotId) {
  return request({
    url: '/map/spots/' + spotId,
    method: 'GET',
    data: {},
    mock: function () {
      const hit = mockMapSpots.spots.filter(function (item) {
        return item.spotId === spotId;
      })[0];

      return hit || null;
    }
  });
}

module.exports = {
  getSpots,
  getSpotDetail
};
