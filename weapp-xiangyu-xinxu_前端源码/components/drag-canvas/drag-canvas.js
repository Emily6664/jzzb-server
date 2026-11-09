// components/drag-canvas/drag-canvas.js —— 手绘拼贴拖拽画布组件
//
// 职责：在一块 Canvas 2D 上完成「摆放素材 → 拖动 → 双指缩放 / 旋转 → 删除 → 导出海报」。
// 对外只暴露方法 + 事件，不关心业务：素材从哪来、音频怎么播、作品怎么存都由页面决定。
//
// 坐标系：内部一律使用「设计稿坐标」，即 750 x 1000 的逻辑画布；
//          屏幕上的 CSS 尺寸由 computeLayout() 按窗口宽度算出，绘制时整体缩放。
//
// 对外方法（页面通过 selectComponent('#dragCanvas') 调用）：
//   addMaterial(material)     加入一个素材到画布中心
//   preset(list)              用预置布局整体替换画布内容
//   clear()                   清空画布
//   removeSelected()          删除当前选中的素材
//   getItems()                取画布内容快照（用于存作品 / 上报）
//   exportPoster()            导出海报图片，返回 Promise<tempFilePath>
//   setTitle(title)           设置海报顶部标题
//   hasItems()                画布上是否有素材
//
// 对外事件：
//   ready    画布初始化完成（页面可开始调用方法）
//   select   { materialId, name }          选中变化，取消选中时 materialId 为 ''
//   change   { items: [...] }              画布内容变化（增删、拖动/缩放结束）

const DEFAULT_ITEM_SIZE = 220;   // 图片加载不出来时的占位尺寸（设计稿单位）
const BADGE_RADIUS = 26;         // 选中角标半径（设计稿单位）
const BADGE_HIT_RADIUS = 46;     // 角标点击热区，比视觉稍大，方便手指点
const MIN_SCALE = 0.3;
const MAX_SCALE = 4;

Component({
  properties: {
    // 是否允许双指旋转手势；儿童模式下页面会置为 false
    rotateEnabled: {
      type: Boolean,
      value: true
    }
  },

  data: {
    cssW: 0,
    cssH: 0,
    ready: false
  },

  lifetimes: {
    attached() {
      // 设计稿坐标下的画布尺寸，与 mock 模板的 canvasWidth / canvasHeight 对齐
      this.designW = 750;
      this.designH = 1000;

      this.items = [];            // 画布内容，最后一个在最上层
      this.seq = 0;               // 素材实例自增序号，用于生成 key
      this.selectedKey = null;
      this.imageCache = Object.create(null);   // materialId -> Image
      this.imageFail = Object.create(null);    // materialId -> true
      this.gesture = null;
      this.posterTitle = '';

      this.computeLayout();
    },

    ready() {
      this.initCanvas();
    },

    detached() {
      this.items = [];
      this.imageCache = null;
      this.imageFail = null;
      this.canvas = null;
      this.ctx = null;
    }
  },

  methods: {
    /* ==================== 初始化 ==================== */

    /** 按窗口尺寸算出画布在页面上的 CSS 尺寸，保持 750:1000 比例 */
    computeLayout() {
      let win = null;
      try {
        win = typeof wx.getWindowInfo === 'function' ? wx.getWindowInfo() : wx.getSystemInfoSync();
      } catch (err) {
        console.error('[drag-canvas] 获取窗口信息失败:', err);
      }

      const winW = (win && win.windowWidth) || 375;
      const winH = (win && win.windowHeight) || 667;
      this.pixelRatio = (win && win.pixelRatio) || 2;

      const padSide = 28;
      let cssW = winW - padSide * 2;
      let cssH = (cssW * this.designH) / this.designW;

      // 画布最多占屏高一半多一点，给素材条和按钮留出空间
      const maxH = Math.max(winH * 0.52, 240);
      if (cssH > maxH) {
        cssH = maxH;
        cssW = (cssH * this.designW) / this.designH;
      }

      this.cssW = Math.max(Math.floor(cssW), 120);
      this.cssH = Math.max(Math.floor(cssH), 160);

      this.setData({ cssW: this.cssW, cssH: this.cssH });
    },

    /** 拿到 canvas 节点，按 dpr 设置物理像素 */
    initCanvas() {
      const query = this.createSelectorQuery();

      query
        .select('#dc-canvas')
        .fields({ node: true, size: true, rect: true })
        .exec((res) => {
          const info = res && res[0];
          if (!info || !info.node) {
            console.error('[drag-canvas] 获取 canvas 节点失败');
            return;
          }

          const canvas = info.node;
          const dpr = this.pixelRatio || 2;

          canvas.width = Math.floor(this.cssW * dpr);
          canvas.height = Math.floor(this.cssH * dpr);

          this.canvas = canvas;
          this.ctx = canvas.getContext('2d');
          this.rectLeft = info.left || 0;
          this.rectTop = info.top || 0;

          this.setData({ ready: true });
          this.render();
          this.triggerEvent('ready');
        });
    },

    /* ==================== 坐标换算 ==================== */

    /** 触摸点（canvas 内 CSS 像素）→ 设计稿坐标 */
    toDesign(touch) {
      const scaleX = this.designW / (this.cssW || 1);
      const scaleY = this.designH / (this.cssH || 1);

      let x = touch && touch.x;
      let y = touch && touch.y;

      if (typeof x !== 'number' || typeof y !== 'number') {
        x = ((touch && touch.clientX) || 0) - (this.rectLeft || 0);
        y = ((touch && touch.clientY) || 0) - (this.rectTop || 0);
      }

      return { x: x * scaleX, y: y * scaleY };
    },

    dist(a, b) {
      const dx = a.x - b.x;
      const dy = a.y - b.y;
      return Math.sqrt(dx * dx + dy * dy);
    },

    /* ==================== 素材实例 ==================== */

    /**
     * 构造一个画布素材实例
     * @param {Object} material 来源于 mock 的素材对象（id / name / imageUrl）
     * @param {Object} [preset] 预置位置 { x, y, scale, rotate }
     * @returns {Object|null}
     */
    buildItem(material, preset) {
      if (!material || !material.id) return null;

      const p = preset || {};
      const key = 'it' + ++this.seq;

      const item = {
        key: key,
        materialId: material.id,
        name: material.name || '',
        imageUrl: material.imageUrl || '',
        // 图片加载成功后会按真实宽高比重新计算 baseW / baseH
        baseW: DEFAULT_ITEM_SIZE,
        baseH: DEFAULT_ITEM_SIZE,
        x: typeof p.x === 'number' ? p.x : this.designW / 2,
        y: typeof p.y === 'number' ? p.y : this.designH / 2,
        scale: typeof p.scale === 'number' ? p.scale : 1,
        rotate: typeof p.rotate === 'number' ? p.rotate : 0
      };

      this.ensureImage(item);

      return item;
    },

    /** 懒加载素材图片；加载失败标记一下，绘制时走占位块 */
    ensureImage(item) {
      const id = item.materialId;

      if (this.imageCache[id]) {
        this.applyBaseSize(id, this.imageCache[id].width, this.imageCache[id].height);
        return;
      }
      if (this.imageFail[id]) return;

      const canvas = this.canvas;
      if (!canvas || typeof canvas.createImage !== 'function') {
        this.imageFail[id] = true;
        return;
      }

      const img = canvas.createImage();

      img.onload = () => {
        this.imageCache[id] = img;
        this.applyBaseSize(id, img.width, img.height);
        this.render();
      };

      img.onerror = () => {
        // mock / 联调地址不可达时走占位块，保证画布仍然可交互
        this.imageFail[id] = true;
        this.render();
      };

      img.src = item.imageUrl;
    },

    /** 按图片真实比例算出它铺进画布后的基准尺寸 */
    applyBaseSize(materialId, w, h) {
      if (!w || !h) return;

      const maxW = this.designW * 0.42;
      const maxH = this.designH * 0.42;

      let bw = maxW;
      let bh = (maxW * h) / w;
      if (bh > maxH) {
        bh = maxH;
        bw = (maxH * w) / h;
      }

      this.items.forEach((item) => {
        if (item.materialId === materialId) {
          item.baseW = bw;
          item.baseH = bh;
        }
      });
    },

    /* ==================== 命中检测 ==================== */

    /** 把设计稿坐标点转到素材自身的局部坐标（去掉位移与旋转） */
    localOf(item, point) {
      const rad = (-item.rotate * Math.PI) / 180;
      const dx = point.x - item.x;
      const dy = point.y - item.y;
      const cos = Math.cos(rad);
      const sin = Math.sin(rad);

      return { x: dx * cos - dy * sin, y: dx * sin + dy * cos };
    },

    hitItem(item, point) {
      const local = this.localOf(item, point);
      const halfW = (item.baseW * item.scale) / 2;
      const halfH = (item.baseH * item.scale) / 2;

      return Math.abs(local.x) <= halfW && Math.abs(local.y) <= halfH;
    },

    /** 删除角标的圆心位置（设计稿坐标），与 drawSelection 的绘制位置保持一致 */
    badgeCenter(item) {
      const rad = (item.rotate * Math.PI) / 180;
      const localX = (item.baseW * item.scale) / 2;
      const localY = -(item.baseH * item.scale) / 2;
      const cos = Math.cos(rad);
      const sin = Math.sin(rad);

      return {
        x: item.x + localX * cos - localY * sin,
        y: item.y + localX * sin + localY * cos
      };
    },

    hitBadge(item, point) {
      return this.dist(this.badgeCenter(item), point) <= BADGE_HIT_RADIUS;
    },

    /** 自顶向下找第一个命中的素材 */
    topmostAt(point) {
      for (let i = this.items.length - 1; i >= 0; i--) {
        if (this.hitItem(this.items[i], point)) return this.items[i];
      }
      return null;
    },

    selectedItem() {
      if (!this.selectedKey) return null;

      for (let i = 0; i < this.items.length; i++) {
        if (this.items[i].key === this.selectedKey) return this.items[i];
      }
      return null;
    },

    /** 选中某个素材；同一个素材重复点不重复抛事件 */
    select(item) {
      const key = item ? item.key : null;
      if (this.selectedKey === key) return;

      this.selectedKey = key;
      this.triggerEvent('select', {
        materialId: item ? item.materialId : '',
        name: item ? item.name : ''
      });
    },

    moveToTop(item) {
      const index = this.items.indexOf(item);
      if (index < 0 || index === this.items.length - 1) return;

      this.items.splice(index, 1);
      this.items.push(item);
    },

    /* ==================== 绘制 ==================== */

    render() {
      const ctx = this.ctx;
      if (!ctx) return;

      const k = (this.cssW * (this.pixelRatio || 2)) / this.designW;
      ctx.setTransform(k, 0, 0, k, 0, 0);
      ctx.clearRect(0, 0, this.designW, this.designH);

      this.drawBackground(ctx);

      this.items.forEach((item) => this.drawItem(ctx, item));

      const selected = this.selectedItem();
      if (selected) this.drawSelection(ctx, selected);
    },

    drawBackground(ctx) {
      const w = this.designW;
      const h = this.designH;

      ctx.fillStyle = '#fffdf7';
      ctx.fillRect(0, 0, w, h);

      ctx.strokeStyle = '#e8e1d2';
      ctx.lineWidth = 6;
      ctx.strokeRect(16, 16, w - 32, h - 32);

      if (this.posterTitle) {
        ctx.fillStyle = '#8b6f47';
        ctx.font = 'bold 32px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(this.posterTitle, w / 2, 68);
      }
    },

    drawItem(ctx, item) {
      const img = this.imageCache[item.materialId];

      ctx.save();
      ctx.translate(item.x, item.y);
      ctx.rotate((item.rotate * Math.PI) / 180);
      ctx.scale(item.scale, item.scale);

      if (img) {
        ctx.drawImage(img, -item.baseW / 2, -item.baseH / 2, item.baseW, item.baseH);
      } else {
        this.drawPlaceholder(ctx, item);
      }

      ctx.restore();
    },

    /** 图片不可用时的占位块：色块 + 素材名，保证画布上能看见东西 */
    drawPlaceholder(ctx, item) {
      const w = item.baseW;
      const h = item.baseH;

      this.roundRect(ctx, -w / 2, -h / 2, w, h, 20);
      ctx.fillStyle = this.colorOf(item.materialId);
      ctx.fill();

      ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
      ctx.lineWidth = 5;
      ctx.stroke();

      ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
      ctx.font = 'bold 28px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(item.name || '素材', 0, 0);
    },

    drawSelection(ctx, item) {
      const halfW = (item.baseW * item.scale) / 2;
      const halfH = (item.baseH * item.scale) / 2;

      ctx.save();
      ctx.translate(item.x, item.y);
      ctx.rotate((item.rotate * Math.PI) / 180);

      ctx.setLineDash([12, 10]);
      ctx.strokeStyle = '#8b6f47';
      ctx.lineWidth = 5;
      ctx.strokeRect(-halfW, -halfH, halfW * 2, halfH * 2);
      ctx.setLineDash([]);

      // 右上角删除角标
      ctx.beginPath();
      ctx.arc(halfW, -halfH, BADGE_RADIUS, 0, Math.PI * 2);
      ctx.fillStyle = '#d9534f';
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 4;
      ctx.stroke();

      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 30px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('×', halfW, -halfH + 1);

      ctx.restore();
    },

    roundRect(ctx, x, y, w, h, r) {
      const radius = Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2);

      ctx.beginPath();
      ctx.moveTo(x + radius, y);
      ctx.arcTo(x + w, y, x + w, y + h, radius);
      ctx.arcTo(x + w, y + h, x, y + h, radius);
      ctx.arcTo(x, y + h, x, y, radius);
      ctx.arcTo(x, y, x + w, y, radius);
      ctx.closePath();
    },

    /** 由素材 ID 生成一个稳定的占位色 */
    colorOf(id) {
      const str = String(id || '');
      let hash = 0;

      for (let i = 0; i < str.length; i++) {
        hash = (hash * 31 + str.charCodeAt(i)) % 360;
      }

      return 'hsl(' + hash + ', 52%, 62%)';
    },

    /* ==================== 手势 ==================== */

    onTouchStart(e) {
      if (!this.ctx) return;

      const touches = (e && e.touches) || [];

      if (touches.length >= 2) {
        this.beginPinch(touches);
        return;
      }
      if (touches.length === 1) {
        this.beginDrag(touches[0]);
      }
    },

    onTouchMove(e) {
      const touches = (e && e.touches) || [];
      const gesture = this.gesture;

      if (!gesture) return;

      if (gesture.mode === 'pinch') {
        if (touches.length >= 2) this.updatePinch(touches);
        return;
      }

      if (gesture.mode === 'drag' && touches.length === 1) {
        this.updateDrag(touches[0]);
      }
    },

    onTouchEnd() {
      if (!this.gesture) return;

      this.gesture = null;
      this.emitChange();
    },

    beginDrag(touch) {
      const point = this.toDesign(touch);
      const selected = this.selectedItem();

      // 先判删除角标，避免点角标时把素材又拖走
      if (selected && this.hitBadge(selected, point)) {
        this.removeItem(selected);
        return;
      }

      const hit = this.topmostAt(point);

      if (hit) {
        this.select(hit);
        this.moveToTop(hit);
        this.gesture = { mode: 'drag', item: hit, last: point };
      } else {
        this.select(null);
        this.gesture = null;
      }

      this.render();
    },

    updateDrag(touch) {
      const point = this.toDesign(touch);
      const gesture = this.gesture;
      const item = gesture.item;

      item.x += point.x - gesture.last.x;
      item.y += point.y - gesture.last.y;

      // 素材中心至少留在画布内，防止拖丢
      item.x = Math.min(Math.max(item.x, 0), this.designW);
      item.y = Math.min(Math.max(item.y, 0), this.designH);

      gesture.last = point;
      this.render();
    },

    beginPinch(touches) {
      const item = this.selectedItem();
      if (!item) return;

      const a = this.toDesign(touches[0]);
      const b = this.toDesign(touches[1]);
      const distance = this.dist(a, b);

      if (distance < 1) return;

      this.gesture = {
        mode: 'pinch',
        item: item,
        startDist: distance,
        startAngle: Math.atan2(b.y - a.y, b.x - a.x),
        startScale: item.scale,
        startRotate: item.rotate
      };
    },

    updatePinch(touches) {
      const gesture = this.gesture;
      if (!gesture || gesture.mode !== 'pinch') return;

      const a = this.toDesign(touches[0]);
      const b = this.toDesign(touches[1]);
      const distance = this.dist(a, b);

      if (distance < 1) return;

      const item = gesture.item;

      item.scale = Math.min(
        Math.max(gesture.startScale * (distance / gesture.startDist), MIN_SCALE),
        MAX_SCALE
      );

      // 儿童模式禁用旋转：只缩放，不改变角度
      if (this.data.rotateEnabled) {
        const angle = Math.atan2(b.y - a.y, b.x - a.x);
        const delta = ((angle - gesture.startAngle) * 180) / Math.PI;
        item.rotate = gesture.startRotate + delta;
      }

      this.render();
    },

    /* ==================== 对外方法 ==================== */

    addMaterial(material) {
      const item = this.buildItem(material, null);
      if (!item) return null;

      // 稍微错开，连续添加时不会完全重叠
      const index = this.items.length;
      item.x = this.designW / 2 + ((index % 3) - 1) * 60;
      item.y = this.designH / 2 + ((Math.floor(index / 3) % 3) - 1) * 60;

      this.items.push(item);
      this.select(item);
      this.render();
      this.emitChange();

      return item.key;
    },

    /**
     * 用预置布局整体替换画布内容
     * @param {Array<{ material: Object, x: number, y: number, scale: number, rotate: number }>} list
     */
    preset(list) {
      this.items = [];
      this.seq = 0;
      this.selectedKey = null;

      (list || []).forEach((entry) => {
        if (!entry || !entry.material) return;

        const item = this.buildItem(
          entry.material,
          { x: entry.x, y: entry.y, scale: entry.scale, rotate: entry.rotate }
        );

        if (item) this.items.push(item);
      });

      this.triggerEvent('select', { materialId: '', name: '' });
      this.render();
      this.emitChange();
    },

    clear() {
      this.items = [];
      this.seq = 0;
      this.selectedKey = null;
      this.triggerEvent('select', { materialId: '', name: '' });
      this.render();
      this.emitChange();
    },

    removeItem(item) {
      const index = this.items.indexOf(item);
      if (index < 0) return;

      this.items.splice(index, 1);

      if (this.selectedKey === item.key) {
        this.selectedKey = null;
        this.triggerEvent('select', { materialId: '', name: '' });
      }

      this.gesture = null;
      this.render();
      this.emitChange();
    },

    removeSelected() {
      const selected = this.selectedItem();
      if (!selected) return false;

      this.removeItem(selected);
      return true;
    },

    setTitle(title) {
      this.posterTitle = title || '';
      this.render();
    },

    hasItems() {
      return this.items.length > 0;
    },

    getItems() {
      return this.items.map((item) => ({
        key: item.key,
        materialId: item.materialId,
        name: item.name,
        x: Math.round(item.x),
        y: Math.round(item.y),
        scale: Number(item.scale.toFixed(2)),
        rotate: Math.round(item.rotate)
      }));
    },

    emitChange() {
      this.triggerEvent('change', { items: this.getItems() });
    },

    /**
     * 导出海报图片
     * @returns {Promise<string>} resolve 临时文件路径
     */
    exportPoster() {
      return new Promise((resolve, reject) => {
        if (!this.canvas) {
          reject(new Error('画布还没初始化完成'));
          return;
        }

        wx.canvasToTempFilePath(
          {
            canvas: this.canvas,
            x: 0,
            y: 0,
            width: this.cssW,
            height: this.cssH,
            destWidth: Math.round(this.designW * 2),
            destHeight: Math.round(this.designH * 2),
            fileType: 'png',
            success: (res) => resolve(res.tempFilePath),
            fail: (err) => reject(err || new Error('导出海报失败'))
          },
          this
        );
      });
    }
  }
});
