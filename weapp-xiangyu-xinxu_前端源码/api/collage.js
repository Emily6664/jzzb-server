// api/collage.js —— AI 拼贴相关接口
//
// 【mock 开关】开关只有一处：utils/api.js 顶部的 USE_MOCK。
//   USE_MOCK = true  -> request() 不发起任何网络请求，直接返回本文件传入的 mock 数据；
//   USE_MOCK = false -> request() 用 BASE_URL + url 发起真实请求。
// 两条路径 resolve 出来的数据结构完全一致，页面层不需要知道当前走的是哪条。
//
// 【返回约定】接口直接 resolve 业务数据（数组 / 对象 / null），不额外包一层 { code, data, msg }。
// 如果后端统一使用 { code, data, msg } 信封，只需在 utils/api.js 的 networkRequest 里解包一次，
// 本文件和 mock 数据都不用改。

const { request } = require('../utils/api');
const mockMaterial = require('../mock/mock-material');

/**
 * 获取拼贴模板列表
 * - 接口含义：返回全部拼贴模板（童趣 / 复古两套），用于拼贴页顶部的模板切换。
 * - 入参：无
 * - 返回：Promise<Array<Object>>，每项字段如下
 *     templateId   string  模板 ID
 *     name         string  模板名称
 *     theme        string  主题，childlike 童趣 | retro 复古
 *     description  string  模板简介
 *     coverUrl     string  模板封面图地址
 *     canvasWidth  number  画布宽（设计稿像素）
 *     canvasHeight number  画布高（设计稿像素）
 */
function getTemplates() {
  return request({
    url: '/collage/templates',
    method: 'GET',
    data: {},
    mock: function () {
      return mockMaterial.templates;
    }
  });
}

/**
 * 获取拼贴素材列表
 * - 接口含义：返回可拖拽的拼贴素材，可按模板筛选。
 * - 入参：params {Object} 可选
 *     templateId string  按模板筛选；不传则返回全部素材
 * - 返回：Promise<Array<Object>>，每项字段如下
 *     id               string  素材 ID
 *     templateId       string  所属模板 ID
 *     name             string  素材名称
 *     imageUrl         string  素材图片地址
 *     description      string  素材简介
 *     audioUrlMandarin string  普通话讲解音频地址
 *     audioUrlHakka    string  客家方言讲解音频地址
 */
function getMaterials(params) {
  return request({
    url: '/collage/materials',
    method: 'GET',
    data: params,
    mock: function (query) {
      const templateId = query && query.templateId;
      if (!templateId) return mockMaterial.materials;

      return mockMaterial.materials.filter(function (item) {
        return item.templateId === templateId;
      });
    }
  });
}

/**
 * 提交拼贴合成
 * - 接口含义：把用户排好的底图 + 素材坐标提交给后端合成一张成图。
 * - 入参：payload {Object}
 *     templateId string   使用的模板 ID
 *     materials  Array    已放置的素材，每项 { id, x, y, scale, rotate }
 * - 返回：Promise<Object>
 *     workId    string  作品 ID
 *     imageUrl  string  合成后的成图地址
 *     width     number  成图宽（像素）
 *     height    number  成图高（像素）
 */
function compose(payload) {
  return request({
    url: '/collage/compose',
    method: 'POST',
    data: payload,
    mock: function () {
      return mockMaterial.composeResult;
    }
  });
}

/**
 * 保存拼贴作品
 * - 接口含义：把合成结果保存到「我的作品」。
 * - 入参：payload {Object}
 *     workId   string  作品 ID（compose 返回的）
 *     imageUrl string  成图地址
 *     title    string  作品标题（用户可编辑）
 * - 返回：Promise<Object>
 *     workId  string   作品 ID
 *     savedAt string   保存时间，格式 YYYY-MM-DD HH:mm:ss
 *     success boolean  是否保存成功
 */
function saveWork(payload) {
  return request({
    url: '/collage/works',
    method: 'POST',
    data: payload,
    mock: function () {
      return mockMaterial.saveResult;
    }
  });
}

module.exports = {
  generate: function (payload) {
    return request({ url: '/collage/generate', method: 'POST', data: payload, timeout: 115000 });
  },
  getTemplates,
  getMaterials,
  compose,
  saveWork,
  /** 我的作品（服务端）：GET /collage/works */
  getWorks: function () {
    return request({ url: '/collage/works', method: 'GET', data: {} });
  },
  /** 删除服务端作品：DELETE /collage/works/{workId} */
  deleteWork: function (workId) {
    return request({ url: '/collage/works/' + workId, method: 'DELETE', data: {} });
  }
};
