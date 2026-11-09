// mock/mock-goods.js —— 文创商品模拟数据（仅 Demo 使用）
//
// 【字段约定】本文件导出的结构，与 api/goods.js 各接口 resolve 出来的结构严格一致。
//
// details[]  商品完整数据（详情接口返回的就是这一层结构）
//   goodsId         string   商品 ID
//   name            string   商品名称
//   price           number   价格，单位：元
//   coverUrl        string   封面图地址
//   summary         string   一句话卖点（列表页展示）
//   detailText      string   详情文案
//   detailImageUrls string[] 详情长图地址列表
//   spotId          string   关联手绘地图点位 ID
//
// list[]     商品列表项（由 details 派生，不重复维护）
//   goodsId / name / price / coverUrl / summary / spotId
//
// orders[]   我的订单
//   orderId     string  订单号
//   goodsId     string  商品 ID
//   goodsName   string  下单时的商品名快照
//   coverUrl    string  下单时的封面图快照
//   price       number  单价，单位：元
//   count       number  购买数量
//   totalAmount number  实付金额，单位：元
//   status      string  订单状态，unpaid 待付款 | paid 已付款 | shipped 已发货 | finished 已完成
//   createdAt   string  下单时间，格式 YYYY-MM-DD HH:mm:ss
//
// 注意：图片地址均为占位域名，联调时替换成真实 CDN 地址。

const DETAILS = [
  {
    goodsId: 'goods-01',
    name: '客家围屋冰箱贴',
    price: 39,
    coverUrl: 'https://cdn.example.com/xiangyu-xinxu/goods/goods-01-cover.png',
    summary: '手工上色的围屋门楼，贴在冰箱上就是一小片故乡。',
    detailText:
      '以围屋门楼为原型，树脂材质手工上色，边缘做了旧砖的肌理。背面是整块软磁，吸力足够。每只都有细微色差，属于手工痕迹。',
    detailImageUrls: [
      'https://cdn.example.com/xiangyu-xinxu/goods/goods-01-detail-01.jpg',
      'https://cdn.example.com/xiangyu-xinxu/goods/goods-01-detail-02.jpg'
    ],
    spotId: 'spot-01'
  },
  {
    goodsId: 'goods-02',
    name: '童趣拼贴明信片套装',
    price: 29,
    coverUrl: 'https://cdn.example.com/xiangyu-xinxu/goods/goods-02-cover.png',
    summary: '一套十二张，把拼贴里的小围屋和小花灯寄给朋友。',
    detailText:
      '十二张一套，正面是童趣拼贴模板里的素材插画，背面留了足够写字的空白。纸张 300g，可以直接寄，也可以裱起来。',
    detailImageUrls: [
      'https://cdn.example.com/xiangyu-xinxu/goods/goods-02-detail-01.jpg'
    ],
    spotId: 'spot-05'
  },
  {
    goodsId: 'goods-03',
    name: '擂茶礼盒',
    price: 128,
    coverUrl: 'https://cdn.example.com/xiangyu-xinxu/goods/goods-03-cover.png',
    summary: '茶叶、花生、芝麻分装备好，配一支竹制茶棍。',
    detailText:
      '按老铺的配比分装，茶叶、花生、芝麻各一袋，附竹制茶棍一支和陶钵一只。开水冲调后按同一方向擂匀，风味最接近现擂的。',
    detailImageUrls: [
      'https://cdn.example.com/xiangyu-xinxu/goods/goods-03-detail-01.jpg',
      'https://cdn.example.com/xiangyu-xinxu/goods/goods-03-detail-02.jpg'
    ],
    spotId: 'spot-03'
  },
  {
    goodsId: 'goods-04',
    name: '土楼手绘帆布袋',
    price: 69,
    coverUrl: 'https://cdn.example.com/xiangyu-xinxu/goods/goods-04-cover.png',
    summary: '手绘土楼印在厚帆布上，装得下 A4 和一台相机。',
    detailText:
      '16 安加厚帆布，手绘土楼图案丝网印刷，洗过几次也不易掉色。内里加了一个小口袋，能放钥匙和手机。',
    detailImageUrls: [
      'https://cdn.example.com/xiangyu-xinxu/goods/goods-04-detail-01.jpg'
    ],
    spotId: 'spot-02'
  },
  {
    goodsId: 'goods-05',
    name: '客家花灯书签',
    price: 19,
    coverUrl: 'https://cdn.example.com/xiangyu-xinxu/goods/goods-05-cover.png',
    summary: '黄铜镂空花灯，夹在书里会透出一小块光。',
    detailText:
      '黄铜薄片蚀刻镂空，做成花灯灯面的纹样。单片厚 0.4mm，夹在书里不会顶出折痕，用久了会有自然的氧化色。',
    detailImageUrls: [
      'https://cdn.example.com/xiangyu-xinxu/goods/goods-05-detail-01.jpg'
    ],
    spotId: 'spot-04'
  }
];

// 列表项由详情派生，避免两处字段各写一份导致不一致
const LIST = DETAILS.map(function (item) {
  return {
    goodsId: item.goodsId,
    name: item.name,
    price: item.price,
    coverUrl: item.coverUrl,
    summary: item.summary,
    spotId: item.spotId
  };
});

const ORDERS = [
  {
    orderId: 'ORD-20250315-0001',
    goodsId: 'goods-01',
    goodsName: '客家围屋冰箱贴',
    coverUrl: 'https://cdn.example.com/xiangyu-xinxu/goods/goods-01-cover.png',
    price: 39,
    count: 2,
    totalAmount: 78,
    status: 'paid',
    createdAt: '2025-03-15 10:24:00'
  },
  {
    orderId: 'ORD-20250302-0002',
    goodsId: 'goods-03',
    goodsName: '擂茶礼盒',
    coverUrl: 'https://cdn.example.com/xiangyu-xinxu/goods/goods-03-cover.png',
    price: 128,
    count: 1,
    totalAmount: 128,
    status: 'shipped',
    createdAt: '2025-03-02 16:40:00'
  },
  {
    orderId: 'ORD-20250220-0003',
    goodsId: 'goods-05',
    goodsName: '客家花灯书签',
    coverUrl: 'https://cdn.example.com/xiangyu-xinxu/goods/goods-05-cover.png',
    price: 19,
    count: 3,
    totalAmount: 57,
    status: 'finished',
    createdAt: '2025-02-20 09:05:00'
  }
];

module.exports = {
  // 商品列表项
  list: LIST,

  // 商品完整数据
  details: DETAILS,

  // 我的订单
  orders: ORDERS,

  // 下单返回结构（真实金额由 api/goods.js 的 mock 函数按 goodsId 现算）
  createOrderResult: {
    orderId: '',
    totalAmount: 0,
    status: 'unpaid',
    payParams: null
  }
};
