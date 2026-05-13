# 开发日志

## 2026-05-13 · 阶段一完成，请用钢琴测试

### 已实现

**1.1 环境噪音校准**：点击开始麦克风 → 授权 → 校准 2 秒 → ambient_rms 落定。触发阈值 = ambient × 4。

**1.2 音高检测主循环**：
- AudioContext 请求 44100Hz（实际 sampleRate 启动时 console.log 打印一次以便核查）
- AnalyserNode fftSize 2048，smoothingTimeConstant=0（不要平滑，会糊掉瞬态）
- getUserMedia 关闭了 echoCancellation / autoGainControl / noiseSuppression — 这三个是钢琴杀手，开启会把泛音和瞬态全削掉
- 钢琴范围 27.5–4186Hz 过滤

**1.3 八度误判过滤**：
- 维护 500ms 内的 pitch history（包括所有 valid pitch 帧，不只是触发帧）
- 新音频率 / 历史频率 ≈ 2.0（±5%）且 clarity 提升不到 0.05 → 判为泛音忽略
- 反向（新音是旧音的一半）不过滤——真低八度通过

**1.4 能量上扬触发**：
- 帧到帧 RMS 差分
- 触发条件 = `rms > ambient×4` AND `rmsDelta > 0.005` AND `clarity > 0.9` AND `27.5 ≤ pitch ≤ 4186`
- 注意：history 在 above-ambient + valid-pitch 时就更新（不依赖触发），这样过滤算法能比较"持续响着的旧音"和"新冒出来的高泛音"

**1.5 同音防抖**：按 note name（如 `C4`）记录上次触发时间，150ms 内不重复。

**1.6 velocity**：触发瞬间 `rms / maxObservedRms`，clamp 到 [0,1]。`maxObservedRms` 初始 `ambient × 8` 以避免一开头几个音 velocity 全是 1。

**1.7 调试 UI**：左下角实时显示 freq / note / clarity / rms / rms delta / ambient / 触发阈值 / 最近触发。屏幕中央大字显示当前识别到的音 + velocity。

**1.8 性能日志**：每秒 console.log 一次 FPS、平均处理时间、当前 ambient/maxRms。

### 已知的、留到实测验证的隐患

1. **延音踏板叠加多音时，Pitchy 锁哪个音**：理论上 attack 瞬间新音最响会被锁，但若新音很弱可能锁不上。需要实测。
2. **真八度跳跃误过滤**：如果用户故意快速弹 C4 → C5（200ms 内）且 C5 clarity 提升不显著，C5 会被吞掉。可调 `octaveClarityDelta` 缓解。
3. **maxObservedRms 单调上升**：极强一击之后所有音的 velocity 都会被压低。MVP 范围内接受。后续可加缓慢衰减。
4. **`sampleRate: 44100` 是 hint，不保证**：某些设备会强制 48000。代码用 `audioContext.sampleRate` 自适应，但 buffer 长度仍是 2048 帧——对应时间会变成 ~42.7ms 而不是 46.4ms，影响轻微。
5. **半音阶检测的 cents 偏差**：未做 cents 显示，但 `freqToNote` 已返回 cents 字段，未来 debug 可用。

### 阶段一完成，请用钢琴测试

测试清单见 README.md。把每项的通过率 + 失败案例（哪些音漏、哪些音误判成什么）发回来，我会调参。
