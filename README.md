# 打印助手 PrintKit

在浏览器里把图案、文字和参数变成可以直接 3D 打印的模型，导出 3MF / STL。
所有模型都在你的设备上生成，不会上传任何文件。针对 **Bambu Lab P1S**（256³ mm，0.4 喷嘴，Bambu Studio）调好了默认值。

**在线使用：** https://lydiafanfan.github.io/printkit/

## 工具

### 图案变模型
| 工具 | 做什么 |
|---|---|
| 印章 | 线稿或文字做成印章，自动镜像，可附带手柄 |
| 线稿加厚 | SVG / PNG 线稿挤出成有厚度的模型，可加底板 |
| 钥匙扣 | 图案加外圈和挂孔：凸起 / 凹刻 / 平面双色（AMS） |
| 饼干模 | 沿外轮廓生成刀刃，带加宽的扶手边 |
| 仿欧根纱 | 底部一层薄纱 + 凸起线条，纱层不超出轮廓 |
| 相框工作室 | 上传高度图（白高灰低黑空）生成浮雕相框；5 种背面夹层、挂钉孔、冰箱磁铁坑、挂绳环、插入式底座 |

### 参数化零件
| 工具 | 做什么 |
|---|---|
| 公差测试件 | 测出你打印机的配合间隙，保存后其他零件自动使用 |
| 收纳盒 | 按内部尺寸，分格、套盖 / 内嵌盖、可叠放 |
| 线轴架 | 缝纫线 / 宝塔线 / 梭芯，桌面或上墙 |
| 标签牌 | 文字标签：凸字 / 凹字 / 平面双色，挂孔、磁铁坑 |
| 侧插扣 | 织带插扣，平放打印 |

### 模型处理
| 工具 | 做什么 |
|---|---|
| 拼接连接件 | 上传切好 / 分件的 STL、OBJ，自动补洞、找接触面，加定位销 / 凸销凹孔 / 卡扣 / 燕尾 / 嵌入定位 |

## 本地运行

浏览器不允许直接双击打开使用 ES 模块的网页，需要一个本地服务器：

```bash
cd printkit
python3 -m http.server 5174
```

然后打开 http://localhost:5174

## 技术

- 纯静态网页，没有构建步骤：HTML + CSS + 原生 JavaScript 模块
- 3D 预览与导出：[three.js](https://threejs.org) 0.160
- 实体布尔运算（封闭网格）：[manifold-3d](https://github.com/elalish/manifold) 3.5.4
- 线稿 → 轮廓：自己写的光栅 + 距离场 + marching squares（`js/engine.js`）

## 文件结构

```
index.html        页面骨架
style.css         样式
js/app.js         界面、路由、导出
js/engine.js      图案光栅化、轮廓追踪、分层挤出
js/tools.js       图案类工具
js/framestudio.js 相框工作室
js/heightmap.js   高度图分析
js/parts.js       公差测试件、收纳盒
js/parts2.js      线轴架、标签牌、侧插扣
js/joiner.js      拼接连接件（读取、修补、布尔运算）
js/export3mf.js   3MF 导出
js/viewer.js      3D 预览与缩略图
```
