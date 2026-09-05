// 本文件由 scripts/sync-media-gate-contract.mjs 生成，请勿手改。
// 定义源：llm-ai-model/contracts/media-gate-contract.json
//
// 阈值变更等于全部历史 receipt 失效：receipt.contractVersion 低于 CONTRACT.contractVersion
// 的产物不得复用，必须重判。

export const CONTRACT = {
  "contractVersion": "1.0.0",
  "status": "provisional",
  "statusNote": "阈值由 tests/fixtures/media-gate 的合成样本推导，尚未用真实模型产物标定。P4 端到端基线跑完后必须用实测分布复核，届时升为 stable。",
  "description": "输出健康闸门判据。任何产物在标记 succeeded 之前必须通过本契约中 severity=fail 的全部规则。本文件是阈值的唯一定义源；llm-ai-model 与 dsh-elysium 各自实现执行器，用同一套样本集做一致性测试。",
  "conventions": {
    "colorRange": "所有 Y 相关指标取自 ffmpeg signalstats，处于 limited/TV range：纯黑 Y=16，纯白 Y=235。判空不能用 Y<=0，必须用 Y<=20。这是本契约最容易被写错的一点。",
    "ratioClamp": "silenceRatio 等由 detect 类滤镜求和得到的比值可能略大于 1（实测 1.0043），执行器必须 clamp 到 [0,1] 再比较。",
    "decodableIsNotEnough": "ffprobe 对截断的 PNG 会返回成功但 width=height=0 且无帧输出。decodable 必须与 frameCount>=1 和尺寸下限同时校验。"
  },
  "metrics": {
    "bytes": {
      "probe": "stat",
      "type": "int",
      "appliesTo": [
        "image",
        "video",
        "audio"
      ]
    },
    "decodable": {
      "probe": "ffprobe -show_streams -show_format",
      "type": "bool",
      "appliesTo": [
        "image",
        "video",
        "audio"
      ]
    },
    "width": {
      "probe": "ffprobe stream.width",
      "type": "int",
      "appliesTo": [
        "image",
        "video"
      ]
    },
    "height": {
      "probe": "ffprobe stream.height",
      "type": "int",
      "appliesTo": [
        "image",
        "video"
      ]
    },
    "frameCount": {
      "probe": "movie=<f>,signalstats 输出帧数",
      "type": "int",
      "appliesTo": [
        "image",
        "video"
      ]
    },
    "durationSec": {
      "probe": "ffprobe format.duration",
      "type": "float",
      "appliesTo": [
        "video",
        "audio"
      ]
    },
    "fps": {
      "probe": "ffprobe stream.avg_frame_rate",
      "type": "float",
      "appliesTo": [
        "video"
      ]
    },
    "darkFrameRatio": {
      "probe": "signalstats YAVG <= 20 的帧占比",
      "type": "ratio",
      "appliesTo": [
        "image",
        "video"
      ]
    },
    "flatFrameRatio": {
      "probe": "entropy normalized_entropy.normal.Y < 0.05 的帧占比",
      "type": "ratio",
      "appliesTo": [
        "image",
        "video"
      ]
    },
    "staticFrameRatio": {
      "probe": "signalstats YDIF < 0.5 的帧占比（跳过首帧）",
      "type": "ratio",
      "appliesTo": [
        "video"
      ]
    },
    "minDynamicRange": {
      "probe": "signalstats YMAX-YMIN 的逐帧最小值",
      "type": "int",
      "appliesTo": [
        "image"
      ]
    },
    "hasAudioStream": {
      "probe": "ffprobe 存在 codec_type=audio 的流",
      "type": "bool",
      "appliesTo": [
        "audio"
      ]
    },
    "audioCodec": {
      "probe": "ffprobe stream.codec_name",
      "type": "string",
      "appliesTo": [
        "audio"
      ]
    },
    "sampleRate": {
      "probe": "ffprobe stream.sample_rate",
      "type": "int",
      "appliesTo": [
        "audio"
      ]
    },
    "integratedLufs": {
      "probe": "ffmpeg -af ebur128=framelog=quiet 的 I 值；下限约 -70",
      "type": "float",
      "appliesTo": [
        "audio"
      ]
    },
    "silenceRatio": {
      "probe": "silencedetect=noise=-50dB:d=0.05 的静音总时长 / 总时长",
      "type": "ratio",
      "appliesTo": [
        "audio"
      ]
    }
  },
  "rules": [
    {
      "id": "file.non-empty",
      "appliesTo": [
        "image",
        "video",
        "audio"
      ],
      "metric": "bytes",
      "op": "gt",
      "value": 0,
      "severity": "fail",
      "message": "输出文件为空"
    },
    {
      "id": "file.decodable",
      "appliesTo": [
        "image",
        "video",
        "audio"
      ],
      "metric": "decodable",
      "op": "eq",
      "value": true,
      "severity": "fail",
      "message": "输出文件无法解码"
    },
    {
      "id": "frame.present",
      "appliesTo": [
        "image",
        "video"
      ],
      "metric": "frameCount",
      "op": "gte",
      "value": 1,
      "severity": "fail",
      "message": "解码成功但没有任何可用帧（典型为文件截断）"
    },
    {
      "id": "size.min-width",
      "appliesTo": [
        "image",
        "video"
      ],
      "metric": "width",
      "op": "gte",
      "value": 256,
      "severity": "fail",
      "message": "画面宽度低于下限"
    },
    {
      "id": "size.min-height",
      "appliesTo": [
        "image",
        "video"
      ],
      "metric": "height",
      "op": "gte",
      "value": 256,
      "severity": "fail",
      "message": "画面高度低于下限"
    },
    {
      "id": "image.not-dark",
      "appliesTo": [
        "image",
        "video"
      ],
      "metric": "darkFrameRatio",
      "op": "lte",
      "value": 0.15,
      "severity": "fail",
      "message": "过暗或全黑帧占比过高"
    },
    {
      "id": "image.not-dark.warn",
      "appliesTo": [
        "image",
        "video"
      ],
      "metric": "darkFrameRatio",
      "op": "lte",
      "value": 0.02,
      "severity": "warn",
      "message": "存在少量过暗帧，需人工留意"
    },
    {
      "id": "image.not-flat",
      "appliesTo": [
        "image",
        "video"
      ],
      "metric": "flatFrameRatio",
      "op": "lte",
      "value": 0.1,
      "severity": "fail",
      "message": "近纯色帧占比过高，画面无有效内容"
    },
    {
      "id": "image.dynamic-range",
      "appliesTo": [
        "image"
      ],
      "metric": "minDynamicRange",
      "op": "gte",
      "value": 8,
      "severity": "fail",
      "message": "亮度动态范围过窄，画面接近纯色"
    },
    {
      "id": "video.not-frozen",
      "appliesTo": [
        "video"
      ],
      "metric": "staticFrameRatio",
      "op": "lte",
      "value": 0.95,
      "severity": "fail",
      "message": "全片近乎静帧，没有有效运动"
    },
    {
      "id": "video.not-frozen.warn",
      "appliesTo": [
        "video"
      ],
      "metric": "staticFrameRatio",
      "op": "lte",
      "value": 0.8,
      "severity": "warn",
      "message": "运动量偏低，可能是慢镜或生成退化"
    },
    {
      "id": "video.min-fps",
      "appliesTo": [
        "video"
      ],
      "metric": "fps",
      "op": "gte",
      "value": 8,
      "severity": "fail",
      "message": "帧率低于下限"
    },
    {
      "id": "video.duration",
      "appliesTo": [
        "video",
        "audio"
      ],
      "metric": "durationSec",
      "op": "withinRatioOf",
      "value": {
        "expectedFrom": "request.durationSec",
        "toleranceRatio": 0.1
      },
      "severity": "fail",
      "message": "时长与请求值偏差超过 10%"
    },
    {
      "id": "audio.track-present",
      "appliesTo": [
        "audio"
      ],
      "metric": "hasAudioStream",
      "op": "eq",
      "value": true,
      "severity": "fail",
      "message": "声明包含音频但没有音轨"
    },
    {
      "id": "audio.codec",
      "appliesTo": [
        "audio"
      ],
      "metric": "audioCodec",
      "op": "in",
      "value": [
        "aac",
        "mp3",
        "opus",
        "flac",
        "vorbis",
        "pcm_s16le",
        "pcm_s24le"
      ],
      "severity": "fail",
      "message": "音频编码不在白名单内"
    },
    {
      "id": "audio.sample-rate",
      "appliesTo": [
        "audio"
      ],
      "metric": "sampleRate",
      "op": "gte",
      "value": 16000,
      "severity": "fail",
      "message": "采样率低于下限"
    },
    {
      "id": "audio.loudness",
      "appliesTo": [
        "audio"
      ],
      "metric": "integratedLufs",
      "op": "gte",
      "value": -50,
      "severity": "fail",
      "message": "整体响度过低，等同无声"
    },
    {
      "id": "audio.loudness.warn",
      "appliesTo": [
        "audio"
      ],
      "metric": "integratedLufs",
      "op": "gte",
      "value": -35,
      "severity": "warn",
      "message": "响度偏低，成片前可能需要归一化"
    },
    {
      "id": "audio.not-silent",
      "appliesTo": [
        "audio"
      ],
      "metric": "silenceRatio",
      "op": "lte",
      "value": 0.95,
      "severity": "fail",
      "message": "几乎全程静音"
    },
    {
      "id": "audio.not-silent.warn",
      "appliesTo": [
        "audio"
      ],
      "metric": "silenceRatio",
      "op": "lte",
      "value": 0.6,
      "severity": "warn",
      "message": "静音占比偏高"
    }
  ],
  "verdict": {
    "pass": "无 severity=fail 的规则未通过",
    "failureReporting": "失败必须携带全部未通过规则的 id 与实测值，写入 receipt.qc.technical.failures，并作为重试时调整参数的依据",
    "warnHandling": "warn 不阻断放行，但必须写入 receipt 并在专业模式可见"
  }
}

/** 规范化 JSON 的 sha256，用于检测与定义源的漂移。 */
export const CONTRACT_HASH = "64b3993e1dd162fe684925cfa173245df0920a5463b42742003e16778702adbd"
