// utils/api.js —— 请求统一封装
//
// 【mock 总开关就在这个文件】
// USE_MOCK = true  时，request 不发起任何网络请求，直接把调用方传入的 mock 数据返回；
// USE_MOCK = false 时，走 wx.request 请求 BASE_URL 拼接出的真实接口。
//
// 调用约定：api/*.js 里统一用 request()，并把 mock 数据一并传进来：
//   request({ url: '/goods/list', method: 'GET', data: params, mock: () => mockGoods.list })

// ==================== 配置 ====================

// 真实联调：请求下方配置的后端域名。
const USE_MOCK = false;

// 后端接口地址占位，联调时替换成真实域名（需在小程序后台配置 request 合法域名）
const BASE_URL = 'https://jjzb.proxy.lc.cygnomatic.net/api';

// 微信支付开关（与 USE_MOCK 是「与」关系）：
//   PAY_ENABLE = false —— 模拟支付：不调用微信支付，直接判定支付成功（Demo / 答辩默认走这个）
//   PAY_ENABLE = true  —— 真实微信支付：需要「企业主体小程序 + 微信支付商户号 + 后端统一下单签名」
// 注意：只有 USE_MOCK = false 且 PAY_ENABLE = true 时才会真正调起 wx.requestPayment，
//       个人主体小程序无法使用微信支付，配了也会失败。
const PAY_ENABLE = false;


// ==================== 后端返回格式约定 ====================
// 约定：{ code, msg, data }，code 为 0 或 200 视为成功，业务数据在 data 里。
// 如果后端不是这个格式（比如直接返回数组/对象），把 UNWRAP_ENVELOPE 改成 false 就原样透传。
const UNWRAP_ENVELOPE = true;
const SUCCESS_CODES = [0, 200];
const FIELD_CODE = 'code';
const FIELD_MSG = 'msg';
const FIELD_DATA = 'data';

// 请求超时时间（毫秒）
const TIMEOUT = 10000;

// ==================== 占位资源识别 ====================
// mock 里的图片、音频都指向这个占位域名，实际打不开。
// 用它来判断"该不该尝试播放/加载"，避免把"资源还没做"当成"播放失败"报给用户。
const MOCK_CDN_HOST = 'cdn.example.com';

/**
 * 判断地址是不是占位资源（mock 的假地址）
 * @param {string} url
 * @returns {boolean}
 */
function isMockUrl(url) {
  if (!url || typeof url !== 'string') return false;
  return url.toLowerCase().indexOf(MOCK_CDN_HOST) > -1;
}

// mock 模式下模拟的异步延迟（毫秒），设为 0 表示立即返回
const MOCK_DELAY = 0;

// ==================== 内部方法 ====================

/**
 * 解析 mock 数据：支持直接给值，也支持传函数（延迟到请求时才计算）
 * @param {*} mock 调用方传入的 mock
 * @param {*} data 请求参数，函数形式时作为入参
 * @returns {*} mock 数据
 */
function resolveMock(mock, data) {
  const value = typeof mock === 'function' ? mock(data) : mock;
  return value === undefined ? null : value;
}

/**
 * mock 模式下返回数据
 * @param {*} mock 调用方传入的 mock
 * @param {*} data 请求参数
 * @returns {Promise<*>}
 */
function mockRequest(mock, data) {
  return new Promise(function (resolve, reject) {
    if (mock === undefined) {
      reject(new Error('[api] USE_MOCK 为 true，但本次请求没有提供 mock 数据'));
      return;
    }

    const deliver = function () {
      try {
        resolve(resolveMock(mock, data));
      } catch (err) {
        reject(err);
      }
    };

    if (MOCK_DELAY > 0) {
      setTimeout(deliver, MOCK_DELAY);
    } else {
      deliver();
    }
  });
}

/**
 * 真实网络请求
 * @param {Object} options 见 request 注释
 * @returns {Promise<*>}
 */
function networkRequest(options) {
  return new Promise(function (resolve, reject) {
    const url = /^https?:\/\//.test(options.url)
      ? options.url
      : BASE_URL + options.url;

    try {
      wx.request({
        url: url,
        method: options.method,
        data: options.data,
        timeout: options.timeout,
        header: options.header,
        success: function (res) {
          const statusCode = res && res.statusCode;

          if (!(statusCode >= 200 && statusCode < 300)) {
            console.error('[api] 接口返回异常:', url, statusCode, res);
            reject(new Error('请求失败，HTTP 状态码 ' + statusCode));
            return;
          }

          const body = res.data;

          // 不是 {code,msg,data} 这种信封（比如直接返回数组/字符串），原样透传
          const isEnvelope =
            UNWRAP_ENVELOPE && body && typeof body === 'object' &&
            !Array.isArray(body) && Object.prototype.hasOwnProperty.call(body, FIELD_CODE);

          if (!isEnvelope) {
            resolve(body);
            return;
          }

          if (SUCCESS_CODES.indexOf(body[FIELD_CODE]) === -1) {
            const msg = body[FIELD_MSG] || '业务错误';
            console.error('[api] 业务错误:', url, body[FIELD_CODE], msg, body);
            const bizError = new Error(msg);
            bizError.code = body[FIELD_CODE];
            bizError.url = url;
            reject(bizError);
            return;
          }

          resolve(body[FIELD_DATA] === undefined ? null : body[FIELD_DATA]);
        },
        fail: function (err) {
          console.error('[api] 请求失败:', url, err);
          reject(err);
        }
      });
    } catch (err) {
      console.error('[api] 请求异常:', url, err);
      reject(err);
    }
  });
}

// ==================== 对外方法 ====================

/**
 * 通用请求
 * @param {Object} options
 * @param {string} options.url        接口路径（相对 BASE_URL）或完整地址
 * @param {string} [options.method]   请求方法，默认 GET
 * @param {Object} [options.data]     请求参数 / 请求体
 * @param {Object} [options.header]   自定义请求头
 * @param {number} [options.timeout]  超时时间，默认 TIMEOUT
 * @param {*}      [options.mock]     mock 数据；可以是值，也可以是 (data) => 数据的函数
 * @returns {Promise<*>} resolve 接口业务数据，reject 错误对象
 */
function request(options) {
  const opts = options || {};

  if (!opts.url) {
    return Promise.reject(new Error('[api] request 缺少 url'));
  }

  const normalized = {
    url: opts.url,
    method: opts.method || 'GET',
    data: opts.data === undefined ? {} : opts.data,
    header: Object.assign(
      { 'content-type': 'application/json' },
      opts.header || {}
    ),
    timeout: opts.timeout || TIMEOUT
  };

  if (USE_MOCK) {
    return mockRequest(opts.mock, normalized.data);
  }

  return networkRequest(normalized);
}

/**
 * GET 简写
 * @param {string} url 接口路径
 * @param {Object} [data] 查询参数
 * @param {*} [mock] mock 数据
 * @returns {Promise<*>}
 */
function get(url, data, mock) {
  return request({ url: url, method: 'GET', data: data, mock: mock });
}

/**
 * POST 简写
 * @param {string} url 接口路径
 * @param {Object} [data] 请求体
 * @param {*} [mock] mock 数据
 * @returns {Promise<*>}
 */
function post(url, data, mock) {
  return request({ url: url, method: 'POST', data: data, mock: mock });
}

module.exports = {
  USE_MOCK,
  MOCK_CDN_HOST,
  isMockUrl,
  BASE_URL,
  PAY_ENABLE,
  TIMEOUT,
  request,
  get,
  post
};
