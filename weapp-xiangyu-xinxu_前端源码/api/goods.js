// api/goods.js —— 文创商品接口
//
// 【mock 开关】开关只有一处：utils/api.js 顶部的 USE_MOCK。
//   USE_MOCK = true  -> request() 不发起任何网络请求，直接返回本文件传入的 mock 数据；
//   USE_MOCK = false -> request() 用 BASE_URL + url 发起真实请求。
// 两条路径 resolve 出来的数据结构完全一致，页面层不需要知道当前走的是哪条。
//
// 【返回约定】接口直接 resolve 业务数据（数组 / 对象 / null），不额外包一层 { code, data, msg }。
// 如果后端统一使用 { code, data, msg } 信封，只需在 utils/api.js 的 networkRequest 里解包一次。

const { request } = require('../utils/api');
const mockGoods = require('../mock/mock-goods');

/**
 * 获取文创商品列表
 * - 接口含义：返回商品列表，用于商品列表页；可按关联点位筛选（点位详情里推荐商品）。
 * - 入参：params {Object} 可选
 *     spotId string  按关联点位筛选；不传则返回全部商品
 * - 返回：Promise<Array<Object>>，每项字段如下
 *     goodsId  string  商品 ID
 *     name     string  商品名称
 *     price    number  价格，单位：元
 *     coverUrl string  封面图地址
 *     summary  string  一句话卖点
 *     spotId   string  关联手绘地图点位 ID
 */
function getList(params) {
  return request({
    url: '/goods/list',
    method: 'GET',
    data: params,
    mock: function (query) {
      const spotId = query && query.spotId;
      if (!spotId) return mockGoods.list;

      return mockGoods.list.filter(function (item) {
        return item.spotId === spotId;
      });
    }
  });
}

/**
 * 获取商品详情
 * - 接口含义：商品详情页用，返回包含详情图文的完整商品数据。
 * - 入参：goodsId {string} 商品 ID
 * - 返回：Promise<Object|null>，字段如下；未命中 resolve null
 *     goodsId         string   商品 ID
 *     name            string   商品名称
 *     price           number   价格，单位：元
 *     coverUrl        string   封面图地址
 *     summary         string   一句话卖点
 *     detailText      string   详情文案
 *     detailImageUrls string[] 详情长图地址列表
 *     spotId          string   关联手绘地图点位 ID
 */
function getDetail(goodsId) {
  return request({
    url: '/goods/detail',
    method: 'GET',
    data: { goodsId: goodsId },
    mock: function (query) {
      const targetId = query && query.goodsId;

      const hit = mockGoods.details.filter(function (item) {
        return item.goodsId === targetId;
      })[0];

      return hit || null;
    }
  });
}

/**
 * 获取我的订单列表
 * - 接口含义：我的订单页用，返回当前用户在 demo 中的订单记录。
 * - 入参：params {Object} 可选
 *     status string  按订单状态筛选，unpaid | paid | shipped | finished；不传则返回全部
 * - 返回：Promise<Array<Object>>，每项字段如下
 *     orderId     string  订单号
 *     goodsId     string  商品 ID
 *     goodsName   string  下单时的商品名快照
 *     coverUrl    string  下单时的封面图快照
 *     price       number  单价，单位：元
 *     count       number  购买数量
 *     totalAmount number  实付金额，单位：元
 *     status      string  订单状态，unpaid | paid | shipped | finished
 *     createdAt   string  下单时间，格式 YYYY-MM-DD HH:mm:ss
 */
function getOrders(params) {
  return request({
    url: '/goods/orders',
    method: 'GET',
    data: params,
    mock: function (query) {
      const status = query && query.status;
      if (!status) return mockGoods.orders;

      return mockGoods.orders.filter(function (item) {
        return item.status === status;
      });
    }
  });
}

/**
 * 创建订单（统一下单）
 * - 接口含义：把商品 + 收货地址 + 定制作品图提交给后端，锁库存并生成待支付订单。
 * - 入参：payload {Object}
 *     goodsId   string  商品 ID
 *     count     number  购买数量
 *     addressId string  收货地址 ID
 *     address   Object  收货地址快照 { name, phone, region, detail }
 *     workImage string  定制作品图地址（可选，文创定制用）
 * - 返回：Promise<Object>
 *     orderId     string  后端订单号
 *     totalAmount number  应付金额，单位：元
 *     status      string  订单状态，初始为 unpaid
 *     payParams   Object|null  调起支付参数 { timeStamp, nonceStr, package, signType, paySign }；
 *                             null 表示后端未开启支付或无需支付
 */
function createOrder(payload) {
  return request({
    url: '/goods/orders',
    method: 'POST',
    data: payload,
    mock: function (body) {
      const p = body || {};
      // 金额由后端按 goodsId 计算，前端传的价格不作数（mock 这里也照这个规则来）
      const hit = mockGoods.details.filter(function (item) {
        return item.goodsId === p.goodsId;
      })[0];
      const price = hit ? hit.price : 0;
      const count = Number(p.count) || 1;

      return Object.assign({}, mockGoods.createOrderResult, {
        // 加随机后缀，避免同一毫秒内下两单撞单号
        orderId: 'ORD-MOCK-' + Date.now() + '-' + Math.floor(Math.random() * 9000 + 1000),
        totalAmount: Math.round(price * count * 100) / 100
      });
    }
  });
}

/**
 * 获取订单支付参数（未支付订单再次发起支付时用）
 * - 接口含义：后端按订单号重新签名，返回可调起微信支付的参数。
 * - 入参：orderId {string} 订单号
 * - 返回：Promise<Object>
 *     orderId   string  订单号
 *     status    string  订单状态，paid 表示已支付（无需再次支付）
 *     payParams Object|null  支付参数，同 createOrder
 */
function payOrder(orderId) {
  return request({
    url: '/goods/orders/' + orderId + '/pay',
    method: 'POST',
    data: {},
    mock: function () {
      return {
        orderId: orderId,
        status: 'unpaid',
        payParams: null
      };
    }
  });
}

module.exports = {
  getList,
  getDetail,
  getOrders,
  createOrder,
  payOrder
};
