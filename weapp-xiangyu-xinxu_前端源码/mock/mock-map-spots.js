// mock/mock-map-spots.js —— 手绘地图点位模拟数据（仅 Demo 使用）
//
// 【字段约定】本文件导出的结构，与 api/map.js 各接口 resolve 出来的结构严格一致。
//
// spots[]   手绘地图点位
//   spotId      string  点位 ID（与 mock-nfc.js 的 spotId 关联）
//   name        string  地点名称
//   mapX        number  设计稿原始像素 X 坐标（左上角为原点，横向）
//   mapY        number  设计稿原始像素 Y 坐标（左上角为原点，纵向）
//   description string  地点描述
//   imageUrl    string  点位配图地址
//   latitude    number  真实纬度（GCJ-02），用于跳转 wx.openLocation
//   longitude   number  真实经度（GCJ-02）
//
// 【坐标系说明】mapX / mapY 是设计稿原图上的绝对像素，不是百分比，也不是页面 rpx。
// 设计稿尺寸固定为 750 x 1334（宽 x 高），mapX 取值 0~750、mapY 取值 0~1334。
// 渲染时需要用 utils/map-calc.js 把设计稿像素换算成当前屏幕的渲染坐标。

const SPOTS = [
  {
    spotId: 'spot-01',
    name: '客家围屋',
    mapX: 168,
    mapY: 420,
    description: '三进两横的方形围屋，门楼朝南，屋前有一口半月形水塘。',
    imageUrl: 'https://cdn.example.com/xiangyu-xinxu/spot/spot-01.png',
    latitude: 24.2886,
    longitude: 116.1225
  },
  {
    spotId: 'spot-02',
    name: '圆形土楼',
    mapX: 486,
    mapY: 268,
    description: '一圈四层的环形土楼，中间天井里还留着那口老石臼。',
    imageUrl: 'https://cdn.example.com/xiangyu-xinxu/spot/spot-02.png',
    latitude: 24.6512,
    longitude: 116.9821
  },
  {
    spotId: 'spot-03',
    name: '擂茶老铺',
    mapX: 302,
    mapY: 742,
    description: '临街的一间老铺，门口摆着陶钵和茶棍，进门先上一碗擂茶。',
    imageUrl: 'https://cdn.example.com/xiangyu-xinxu/spot/spot-03.png',
    latitude: 24.3014,
    longitude: 116.1308
  },
  {
    spotId: 'spot-04',
    name: '花灯工坊',
    mapX: 596,
    mapY: 918,
    description: '作坊里长年堆着竹篾和棉纸，正月前最热闹。',
    imageUrl: 'https://cdn.example.com/xiangyu-xinxu/spot/spot-04.png',
    latitude: 24.2765,
    longitude: 116.1052
  },
  {
    spotId: 'spot-05',
    name: '古渡口',
    mapX: 214,
    mapY: 1068,
    description: '旧时水上货运的起点，石阶被船工踩出了深槽。',
    imageUrl: 'https://cdn.example.com/xiangyu-xinxu/spot/spot-05.png',
    latitude: 24.2601,
    longitude: 116.0918
  }
];

module.exports = {
  // 手绘地图点位列表
  spots: SPOTS
};
