// mock/mock-material.js —— AI 拼贴素材库模拟数据（仅 Demo 使用）
//
// 【字段约定】本文件导出的结构，与 api/collage.js 各接口 resolve 出来的结构严格一致。
//
// templates[]  拼贴模板（童趣 / 复古两套）
//   templateId   string  模板 ID
//   name         string  模板名称
//   theme        string  主题，childlike 童趣 | retro 复古
//   description  string  模板简介
//   coverUrl     string  模板封面图地址
//   canvasWidth  number  画布宽（设计稿像素）
//   canvasHeight number  画布高（设计稿像素）
//
// materials[]  拼贴素材
//   id               string  素材 ID
//   templateId       string  所属模板 ID，与 templates[].templateId 关联
//   name             string  素材名称
//   imageUrl         string  素材图片地址
//   description      string  素材简介
//   audioUrlMandarin string  普通话讲解音频地址
//   audioUrlHakka    string  客家方言讲解音频地址
//
// composeResult  拼贴合成结果
//   workId / imageUrl / width / height
//
// saveResult     作品保存结果
//   workId / savedAt / success
//
// 注意：图片、音频地址均为占位域名，联调时替换成真实 CDN 地址；
// 小程序需要在后台配置对应的 downloadFile 合法域名，否则真机无法播放。

const TEMPLATES = [
  {
    templateId: 'tpl-childlike',
    name: '童趣拼贴',
    theme: 'childlike',
    description: '圆润线条配明亮配色，小朋友也能一眼认出的围屋、土楼和花灯。',
    coverUrl: 'https://cdn.example.com/xiangyu-xinxu/template/tpl-childlike-cover.png',
    canvasWidth: 750,
    canvasHeight: 1000
  },
  {
    templateId: 'tpl-retro',
    name: '复古拼贴',
    theme: 'retro',
    description: '做旧纸感与低饱和色调，把老照片里的客家日常重新拼起来。',
    coverUrl: 'https://cdn.example.com/xiangyu-xinxu/template/tpl-retro-cover.png',
    canvasWidth: 750,
    canvasHeight: 1000
  }
];

const MATERIALS = [
  // ==================== 童趣套装 ====================
  {
    id: 'mat-childlike-01',
    templateId: 'tpl-childlike',
    name: '卡通围屋',
    imageUrl: '/assets/images/materials/mat-childlike-01.png',
    description: '圆角造型的客家围屋，屋前还趴着一只打盹的黄狗。',
    audioUrlMandarin: 'https://cdn.example.com/xiangyu-xinxu/audio/mat-childlike-01-mandarin.mp3',
    audioUrlHakka: 'https://cdn.example.com/xiangyu-xinxu/audio/mat-childlike-01-hakka.mp3'
  },
  {
    id: 'mat-childlike-02',
    templateId: 'tpl-childlike',
    name: '卡通土楼',
    imageUrl: '/assets/images/materials/mat-childlike-02.png',
    description: '圆圆一圈的土楼，屋顶上画了几只飞过的燕子。',
    audioUrlMandarin: 'https://cdn.example.com/xiangyu-xinxu/audio/mat-childlike-02-mandarin.mp3',
    audioUrlHakka: 'https://cdn.example.com/xiangyu-xinxu/audio/mat-childlike-02-hakka.mp3'
  },
  {
    id: 'mat-childlike-03',
    templateId: 'tpl-childlike',
    name: '花灯小灯',
    imageUrl: '/assets/images/materials/mat-childlike-03.png',
    description: '提着就能走的小花灯，灯面上画了笑脸。',
    audioUrlMandarin: 'https://cdn.example.com/xiangyu-xinxu/audio/mat-childlike-03-mandarin.mp3',
    audioUrlHakka: 'https://cdn.example.com/xiangyu-xinxu/audio/mat-childlike-03-hakka.mp3'
  },
  {
    id: 'mat-childlike-04',
    templateId: 'tpl-childlike',
    name: '擂茶小碗',
    imageUrl: '/assets/images/materials/mat-childlike-04.png',
    description: '冒着热气的一碗擂茶，旁边还摆着花生和芝麻。',
    audioUrlMandarin: 'https://cdn.example.com/xiangyu-xinxu/audio/mat-childlike-04-mandarin.mp3',
    audioUrlHakka: 'https://cdn.example.com/xiangyu-xinxu/audio/mat-childlike-04-hakka.mp3'
  },

  // ==================== 复古套装 ====================
  {
    id: 'mat-retro-01',
    templateId: 'tpl-retro',
    name: '老围屋',
    imageUrl: '/assets/images/materials/mat-retro-01.png',
    description: '上世纪八十年代拍下的围屋正门，墙面斑驳，门楣上还留着红漆字。',
    audioUrlMandarin: 'https://cdn.example.com/xiangyu-xinxu/audio/mat-retro-01-mandarin.mp3',
    audioUrlHakka: 'https://cdn.example.com/xiangyu-xinxu/audio/mat-retro-01-hakka.mp3'
  },
  {
    id: 'mat-retro-02',
    templateId: 'tpl-retro',
    name: '竹编茶篮',
    imageUrl: '/assets/images/materials/mat-retro-02.png',
    description: '用了二十多年的竹编茶篮，提手已经磨得发亮。',
    audioUrlMandarin: 'https://cdn.example.com/xiangyu-xinxu/audio/mat-retro-02-mandarin.mp3',
    audioUrlHakka: 'https://cdn.example.com/xiangyu-xinxu/audio/mat-retro-02-hakka.mp3'
  },
  {
    id: 'mat-retro-03',
    templateId: 'tpl-retro',
    name: '旧式花灯',
    imageUrl: '/assets/images/materials/mat-retro-03.png',
    description: '糊着棉纸的旧式花灯，灯骨是老师傅一根根削出来的。',
    audioUrlMandarin: 'https://cdn.example.com/xiangyu-xinxu/audio/mat-retro-03-mandarin.mp3',
    audioUrlHakka: 'https://cdn.example.com/xiangyu-xinxu/audio/mat-retro-03-hakka.mp3'
  },
  {
    id: 'mat-retro-04',
    templateId: 'tpl-retro',
    name: '绣花鞋',
    imageUrl: '/assets/images/materials/mat-retro-04.png',
    description: '一双褪了色的绣花鞋，鞋面上的牡丹还能看出针脚。',
    audioUrlMandarin: 'https://cdn.example.com/xiangyu-xinxu/audio/mat-retro-04-mandarin.mp3',
    audioUrlHakka: 'https://cdn.example.com/xiangyu-xinxu/audio/mat-retro-04-hakka.mp3'
  }
];

module.exports = {
  // 拼贴模板列表（童趣 / 复古）
  templates: TEMPLATES,

  // 拼贴素材列表
  materials: MATERIALS,

  // 拼贴合成结果
  composeResult: {
    workId: 'work-demo-0001',
    imageUrl: 'https://cdn.example.com/xiangyu-xinxu/work/work-demo-0001.png',
    width: 750,
    height: 1000
  },

  // 作品保存结果
  saveResult: {
    workId: 'work-demo-0001',
    savedAt: '2025-03-18 10:24:00',
    success: true
  }
};
