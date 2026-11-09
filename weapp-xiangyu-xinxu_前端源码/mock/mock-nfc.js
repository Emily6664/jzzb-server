// mock/mock-nfc.js —— NFC 标签溯源模拟数据（仅 Demo 使用）
//
// 【字段约定】本文件导出的结构，与 api/nfc.js 各接口 resolve 出来的结构严格一致。
//
// tags[]   NFC 标签数据集，一张标签对应一处故事
//   tagId           string   NFC 标签唯一标识（硬件写入的 ID）
//   title           string   标签标题
//   storyText       string   故事文本
//   historyImageUrls string[] 史料图片地址列表
//   spotId          string   关联手绘地图点位 ID（对应 mock-map-spots.js 的 spotId）
//   goodsId         string   关联文创商品 ID（对应 mock-goods.js 的 goodsId）
//   audioUrlMandarin string  故事普通话朗读音频地址
//   audioUrlHakka    string  故事客家方言朗读音频地址
//
// reportResult   扫码上报结果
//   success / reportedAt / tagId
//
// 注意：图片、音频地址均为占位域名，联调时替换成真实 CDN 地址。

const TAGS = [
  {
    tagId: 'NFC-TAG-0001',
    title: '围屋门楼',
    storyText:
      '这座围屋建于清光绪年间，门楼上的青砖是从河滩一块块挑回来的。门楣内侧还留着一行小字，记的是当年修屋时各家各户出的工。逢年过节，族人在门楼前摆开八仙桌，一坐就是十几桌。',
    historyImageUrls: [
      'https://cdn.example.com/xiangyu-xinxu/nfc/NFC-TAG-0001-history-01.jpg',
      'https://cdn.example.com/xiangyu-xinxu/nfc/NFC-TAG-0001-history-02.jpg'
    ],
    spotId: 'spot-01',
    goodsId: 'goods-01',
    audioUrlMandarin: 'https://cdn.example.com/xiangyu-xinxu/audio/NFC-TAG-0001-mandarin.mp3',
    audioUrlHakka: 'https://cdn.example.com/xiangyu-xinxu/audio/NFC-TAG-0001-hakka.mp3'
  },
  {
    tagId: 'NFC-TAG-0002',
    title: '土楼天井',
    storyText:
      '圆形土楼中间的天井是整个家族的公共客厅。井边那口石臼用了一百多年，逢年过节打糍粑，几户人家轮流用，谁家先打好都会先给邻居送一碗。',
    historyImageUrls: [
      'https://cdn.example.com/xiangyu-xinxu/nfc/NFC-TAG-0002-history-01.jpg'
    ],
    spotId: 'spot-02',
    goodsId: 'goods-04',
    audioUrlMandarin: 'https://cdn.example.com/xiangyu-xinxu/audio/NFC-TAG-0002-mandarin.mp3',
    audioUrlHakka: 'https://cdn.example.com/xiangyu-xinxu/audio/NFC-TAG-0002-hakka.mp3'
  },
  {
    tagId: 'NFC-TAG-0003',
    title: '擂茶老铺',
    storyText:
      '擂茶要把茶叶、花生、芝麻放进陶钵里，用茶棍一圈一圈擂碎。老铺的茶棍传了三代人，木头中间已经被磨出一个凹槽。客人进门先上一碗，喝完再谈事。',
    historyImageUrls: [
      'https://cdn.example.com/xiangyu-xinxu/nfc/NFC-TAG-0003-history-01.jpg',
      'https://cdn.example.com/xiangyu-xinxu/nfc/NFC-TAG-0003-history-02.jpg'
    ],
    spotId: 'spot-03',
    goodsId: 'goods-03',
    audioUrlMandarin: 'https://cdn.example.com/xiangyu-xinxu/audio/NFC-TAG-0003-mandarin.mp3',
    audioUrlHakka: 'https://cdn.example.com/xiangyu-xinxu/audio/NFC-TAG-0003-hakka.mp3'
  },
  {
    tagId: 'NFC-TAG-0004',
    title: '花灯作坊',
    storyText:
      '作坊里的花灯全靠手工，一盏灯要用掉七十多根竹篾。糊灯面的棉纸刷过桐油，透光却不透风，正月里挂出去能亮一整月。',
    historyImageUrls: [
      'https://cdn.example.com/xiangyu-xinxu/nfc/NFC-TAG-0004-history-01.jpg'
    ],
    spotId: 'spot-04',
    goodsId: 'goods-05',
    audioUrlMandarin: 'https://cdn.example.com/xiangyu-xinxu/audio/NFC-TAG-0004-mandarin.mp3',
    audioUrlHakka: 'https://cdn.example.com/xiangyu-xinxu/audio/NFC-TAG-0004-hakka.mp3'
  }
];

module.exports = {
  // NFC 标签数据集
  tags: TAGS,

  // 扫码上报结果
  reportResult: {
    success: true,
    reportedAt: '2025-03-18 10:24:00',
    tagId: 'NFC-TAG-0001'
  }
};
