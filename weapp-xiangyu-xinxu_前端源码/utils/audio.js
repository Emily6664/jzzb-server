// utils/audio.js —— 音频播放封装
//
// 统一创建 / 复用 / 销毁 InnerAudioContext，并对所有可能抛错的地方做捕获，
// 保证音频播放失败不会打断页面主流程。

// 当前正在播放的实例，同一时间只保留一个
let currentAudio = null;

/**
 * 释放当前音频实例
 * @returns {void}
 */
function destroy() {
  if (!currentAudio) return;

  try {
    currentAudio.stop();
  } catch (err) {
    console.error('[audio] 停止失败:', err);
  }

  try {
    currentAudio.destroy();
  } catch (err) {
    console.error('[audio] 销毁失败:', err);
  }

  currentAudio = null;
}

/**
 * 播放一段音频（同一时间只播放一个，播新的会先停掉旧的）
 * @param {string} src 音频地址，支持本地路径 / 临时文件路径 / 网络地址
 * @param {Object} [options] 可选配置
 * @param {boolean} [options.loop=false]     是否循环播放
 * @param {number}  [options.volume=1]       音量 0~1
 * @param {Function} [options.onPlay]        播放开始回调
 * @param {Function} [options.onEnded]       播放结束回调
 * @param {Function} [options.onError]       播放出错回调，入参为错误对象
 * @returns {Object|null} 音频实例，失败时返回 null
 */
function play(src, options) {
  const opts = options || {};

  if (!src || typeof src !== 'string') {
    console.error('[audio] play 参数非法，src 必须是非空字符串');
    return null;
  }

  // 检查基础库是否支持
  if (typeof wx.createInnerAudioContext !== 'function') {
    console.error('[audio] 当前环境不支持 InnerAudioContext');
    return null;
  }

  // 先停掉上一个，避免叠音
  destroy();

  try {
    const audio = wx.createInnerAudioContext();

    audio.src = src;
    audio.loop = !!opts.loop;
    audio.volume = typeof opts.volume === 'number' ? opts.volume : 1;

    audio.onPlay(function () {
      try {
        if (typeof opts.onPlay === 'function') opts.onPlay();
      } catch (err) {
        console.error('[audio] onPlay 回调异常:', err);
      }
    });

    audio.onEnded(function () {
      try {
        if (typeof opts.onEnded === 'function') opts.onEnded();
      } catch (err) {
        console.error('[audio] onEnded 回调异常:', err);
      }
    });

    audio.onError(function (err) {
      console.error('[audio] 播放出错:', src, err);
      try {
        if (typeof opts.onError === 'function') opts.onError(err);
      } catch (cbErr) {
        console.error('[audio] onError 回调异常:', cbErr);
      }
    });

    audio.play();
    currentAudio = audio;

    return audio;
  } catch (err) {
    console.error('[audio] play 失败:', src, err);
    try {
      if (typeof opts.onError === 'function') opts.onError(err);
    } catch (cbErr) {
      console.error('[audio] onError 回调异常:', cbErr);
    }
    return null;
  }
}

/**
 * 停止当前播放
 * @returns {void}
 */
function stop() {
  destroy();
}

module.exports = {
  play,
  stop,
  destroy
};
