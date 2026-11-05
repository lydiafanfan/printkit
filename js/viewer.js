/* 打印助手 · 三维预览 */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

export class Viewer {
  constructor(el) {
    this.el = el;
    const r = this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    r.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.05;
    el.appendChild(r.domElement);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(32, 1, 0.5, 8000);
    this.camera.up.set(0, 0, 1);
    this.camera.position.set(90, -140, 120);
    this.controls = new OrbitControls(this.camera, r.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.09;
    this.controls.maxPolarAngle = Math.PI * 0.49;
    this.flipped = false;

    this.scene.add(new THREE.HemisphereLight(0xffffff, 0xb8ad98, 0.85));
    const key = new THREE.DirectionalLight(0xffffff, 2.6); key.position.set(-70, -110, 120); this.scene.add(key);
    const rim = new THREE.DirectionalLight(0xfff1e0, 0.9); rim.position.set(150, 80, 60); this.scene.add(rim);

    this.mats = [
      new THREE.MeshStandardMaterial({ color: 0x8fd3c1, roughness: 0.55, metalness: 0 }),
      new THREE.MeshStandardMaterial({ color: 0xf4c6b8, roughness: 0.55, metalness: 0 }),
    ];
    this.group = new THREE.Group(); this.scene.add(this.group);
    this.plate = new THREE.Group(); this.scene.add(this.plate);
    this.shadow = this.makeShadow(); this.scene.add(this.shadow);
    this.lastSize = 0;

    new ResizeObserver(() => this.resize()).observe(el);
    this.resize();
    const loop = () => { this.controls.update(); r.render(this.scene, this.camera); requestAnimationFrame(loop); };
    loop();
  }
  resize() {
    const w = this.el.clientWidth, h = this.el.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
  }
  setColor(hex, hex2) { this.mats[0].color.set(hex); if (hex2) this.mats[1].color.set(hex2); }
  makeShadow() {
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const g = c.getContext('2d'), grd = g.createRadialGradient(64, 64, 8, 64, 64, 64);
    grd.addColorStop(0, 'rgba(60,45,30,0.22)'); grd.addColorStop(1, 'rgba(60,45,30,0)');
    g.fillStyle = grd; g.fillRect(0, 0, 128, 128);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, premultipliedAlpha: true, depthWrite: false }));
    m.position.z = 0.05;
    return m;
  }
  buildPlate(size) {
    this.plate.clear();
    const s = Math.max(60, Math.ceil(size * 1.5 / 20) * 20);
    const shape = new THREE.Shape(); const h = s / 2, rr = s * 0.06;
    shape.moveTo(-h + rr, -h); shape.lineTo(h - rr, -h); shape.quadraticCurveTo(h, -h, h, -h + rr); shape.lineTo(h, h - rr);
    shape.quadraticCurveTo(h, h, h - rr, h); shape.lineTo(-h + rr, h); shape.quadraticCurveTo(-h, h, -h, h - rr); shape.lineTo(-h, -h + rr); shape.quadraticCurveTo(-h, -h, -h + rr, -h);
    const plate = new THREE.Mesh(new THREE.ShapeGeometry(shape), new THREE.MeshBasicMaterial({ color: 0xfbfaf6, transparent: true, premultipliedAlpha: true, opacity: 0.85 }));
    plate.position.z = -0.4; this.plate.add(plate);
    const pts = [];
    for (let x = -h + 10; x < h - 0.1; x += 10) pts.push(x, -h + 4, 0, x, h - 4, 0);
    for (let y = -h + 10; y < h - 0.1; y += 10) pts.push(-h + 4, y, 0, h - 4, y, 0);
    const lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    const lines = new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: 0xe6e1d6 }));
    lines.position.z = -0.3; this.plate.add(lines);
  }
  /** parts: [{geo, label}]；fit=true 时把镜头对准模型 */
  setParts(parts, fit) {
    this.group.clear();
    this.glass ||= new THREE.MeshPhysicalMaterial({ color: 0xf6f3ff, transparent: true, premultipliedAlpha: true, opacity: 0.5, roughness: 0.25, depthWrite: false, side: THREE.DoubleSide });
    this.colorMats ||= new Map();
    const matFor = hex => { if (!this.colorMats.has(hex)) this.colorMats.set(hex, new THREE.MeshStandardMaterial({ color: hex, roughness: 0.55, metalness: 0 })); return this.colorMats.get(hex); };
    parts.forEach((p, i) => {
      const mesh = new THREE.Mesh(p.geo, p.translucent ? this.glass : p.color ? matFor(p.color) : this.mats[p.keepPlace && i > 0 ? 1 : 0]);
      if (p.offset) mesh.position.set(...p.offset); // 只影响预览（比如“分开查看”）
      this.group.add(mesh);
    });
    this.applyFlip();
    const box = new THREE.Box3().setFromObject(this.group);
    const size = box.getSize(new THREE.Vector3());
    const span = Math.max(size.x, size.y);
    this.shadow.scale.set(size.x * 1.35 + 10, size.y * 1.35 + 10, 1);
    if (fit || Math.abs(span - this.lastSize) / Math.max(this.lastSize, 1) > 0.35) { this.buildPlate(span); this.frame(box); }
    this.lastSize = span;
  }
  frame(box = new THREE.Box3().setFromObject(this.group), dir = new THREE.Vector3(0.45, -0.85, 0.75)) {
    if (box.isEmpty()) return;
    const c = box.getCenter(new THREE.Vector3()), s = box.getSize(new THREE.Vector3());
    const r = Math.max(s.x, s.y, s.z * 1.5) * 0.62;
    const dist = r / Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)) * (this.camera.aspect < 1 ? 1.5 : 1.1);
    this.controls.target.copy(c);
    this.camera.position.copy(c).add(dir.normalize().multiplyScalar(dist));
    this.camera.updateProjectionMatrix();
  }
  /** 只在预览里把模型翻个面（看相框正面、印章印面等），不影响导出 */
  flip() {
    this.flipped = !this.flipped;
    this.applyFlip();
  }
  applyFlip() {
    const box = new THREE.Box3();
    this.group.rotation.set(0, 0, 0); this.group.position.set(0, 0, 0); this.group.updateMatrixWorld(true);
    box.setFromObject(this.group);
    if (this.flipped) { this.group.rotation.y = Math.PI; this.group.position.z = box.max.z + box.min.z; }
  }
  top() { this.frame(undefined, new THREE.Vector3(0, -0.001, 1)); }
}

/** 离屏渲染缩略图（首页卡片用） */
export class Thumbnailer {
  constructor(w, h) {
    this.w = w; this.h = h;
    const r = this.r = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    r.setPixelRatio(1); r.setSize(w, h, false);
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping; r.toneMappingExposure = 1.08;
    this.scene = new THREE.Scene();
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0xb8ad98, 0.95));
    const key = new THREE.DirectionalLight(0xffffff, 2.5); key.position.set(-70, -110, 140); this.scene.add(key);
    const rim = new THREE.DirectionalLight(0xfff1e0, 0.9); rim.position.set(150, 80, 60); this.scene.add(rim);
    this.camera = new THREE.PerspectiveCamera(28, w / h, 0.5, 8000); this.camera.up.set(0, 0, 1);
    // 柔和的接触阴影
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const g = c.getContext('2d'), grd = g.createRadialGradient(64, 64, 6, 64, 64, 64);
    grd.addColorStop(0, 'rgba(70,50,30,0.28)'); grd.addColorStop(1, 'rgba(70,50,30,0)');
    g.fillStyle = grd; g.fillRect(0, 0, 128, 128);
    this.shadow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, premultipliedAlpha: true, depthWrite: false }));
    this.scene.add(this.shadow);
    this.group = new THREE.Group(); this.scene.add(this.group);
  }
  render(parts, hex, bg = '#efe9df') {
    this.group.clear();
    this.scene.background = new THREE.Color(bg); // 不透明背景：缩略图不会出现透明度错误的杂点
    const mat = new THREE.MeshStandardMaterial({ color: hex, roughness: 0.5, metalness: 0 });
    const glass = new THREE.MeshPhysicalMaterial({ color: 0xffffff, transparent: true, premultipliedAlpha: true, opacity: 0.55, roughness: 0.25, depthWrite: false, side: THREE.DoubleSide });
    const alt = new THREE.MeshStandardMaterial({ color: new THREE.Color(hex).offsetHSL(0, -0.1, 0.18), roughness: 0.5 });
    parts.forEach((p, i) => this.group.add(new THREE.Mesh(p.geo, p.translucent ? glass : (p.keepPlace && i > 0 ? alt : mat))));
    const box = new THREE.Box3().setFromObject(this.group);
    const ctr = box.getCenter(new THREE.Vector3()), s = box.getSize(new THREE.Vector3());
    this.shadow.position.set(ctr.x, ctr.y, 0.02); this.shadow.scale.set(s.x * 1.5 + 8, s.y * 1.5 + 8, 1);
    const r = Math.max(s.x, s.y * 1.1, s.z * 1.6) * 0.58;
    const dist = r / Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)) * 1.05;
    const dir = new THREE.Vector3(0.42, -0.9, 0.95).normalize();
    this.camera.position.copy(ctr).add(dir.multiplyScalar(dist));
    this.camera.lookAt(ctr.x, ctr.y, ctr.z * 0.6);
    this.r.render(this.scene, this.camera);
    let url = this.r.domElement.toDataURL('image/webp', 0.86);
    if (!url.startsWith('data:image/webp')) url = this.r.domElement.toDataURL('image/png');
    mat.dispose(); glass.dispose(); alt.dispose();
    return url;
  }
  dispose() { this.group.clear(); this.r.dispose(); this.r.forceContextLoss?.(); }
}
