# MIDI Survivor MVP

通过麦克风识别钢琴音的 web 游戏原型。这是阶段一：把音高识别做扎实。

## 运行方式

**必须用 HTTP 服务器，不要双击 `index.html`。** ES Module 在 `file://` 协议下会因跨域被浏览器拒绝。

```bash
cd midi-survivor-demo
python3 -m http.server 8000
# 或
npx serve
```

然后浏览器打开 http://localhost:8000

**浏览器要求**：Chrome / Edge / Brave。Safari 不行（getUserMedia + ES Module + Pitchy 组合在 Safari 有兼容问题）。

## 操作

1. 点击「开始麦克风」按钮，授权
2. 看到「校准中」时**保持安静 2 秒**
3. 校准完成后弹琴，屏幕大字会显示识别到的音
4. 左下角 debug 面板显示实时数据

## 阶段一验收测试

请用你的雅马哈三角钢琴依次测试：

- [ ] **C 大调音阶**：弹 C4 D4 E4 F4 G4 A4 B4 C5，记录识别正确的数量。重复 10 次。**目标 9/10 次 8 个全对**。
- [ ] **半音阶**：弹 C4 到 C5 共 13 个键。**目标 9/12 半音正确**（不算两端的 C，只算中间 11 个 + 起点）。
- [ ] **同音连击**：1 秒内连续弹同一个键 3 次。**目标识别 3 次**。
- [ ] **延音踏板下的 C 大调音阶**：踩死延音踏板弹 8 个音，**目标 8 个都被独立识别**。
- [ ] **强弱对比**：同一个音强弹一次、弱弹一次，看 velocity 差值。**目标 velocity 差 > 0.3**。
- [ ] **校准鲁棒**：在安静和稍嘈杂环境各试一次，看 ambient rms 是否反映环境差异，是否都能正常触发。

## 反馈给我什么

把以下信息发回来，方便调参：

1. 每项测试的通过/失败次数
2. 哪些音容易漏（写音名）
3. 哪些音容易误判成别的音（写"弹 X 识别成 Y"）
4. 浏览器 console 里的 `[note]` 日志，特别是失败的那些
5. 延迟感受（弹下去到屏幕显示，主观感觉延迟 ms）

## 调参入口

`pitch-detector.js` 顶部 `this.config`：

| 参数 | 默认 | 意义 |
|---|---|---|
| `clarityThreshold` | 0.9 | Pitchy clarity 阈值。漏音多 → 降到 0.85；误判多 → 升到 0.93 |
| `ambientMultiplier` | 4 | 触发振幅 = ambient × 这个值。嘈杂环境漏音 → 调小到 3；安静环境误触发 → 调大到 5 |
| `energyDerivativeThreshold` | 0.005 | RMS 上升阈值。踏板下漏音 → 调小；连击误触发 → 调大 |
| `debounceMs` | 150 | 同音防抖。连击漏 → 调小（最低 80） |
| `octaveWindowMs` | 200 | 八度过滤窗口 |
| `octaveClarityDelta` | 0.05 | 真八度跳跃的 clarity 差距阈值 |

## 项目结构

```
midi-survivor-demo/
├── index.html          # 入口页面 + debug UI
├── pitch-detector.js   # PianoDetector 核心检测类
├── game.js             # UI 接线 + 主循环
├── README.md           # 此文件
└── notes.md            # 开发日志
```
