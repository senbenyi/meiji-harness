import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export function loadConfigFile() {
  const path = process.env.DSH_SVS_CONFIG || join(homedir(), '.dsh', 'dsh-short-video-studio.json')
  try {
    if (existsSync(path)) return JSON.parse(readFileSync(path, 'utf8')) || {}
  } catch { /* 忽略损坏的配置，回退默认 */ }
  return {}
}

const initialConfig = loadConfigFile()
const initialModels = initialConfig.models || {}
const env = (key, fallback) => (
  process.env[key] !== undefined && process.env[key] !== '' ? process.env[key] : fallback
)

export const featureEnabled = (name) => initialConfig.features?.[name] !== false

export const COMFY_BASE_URL = env('DSH_SVS_COMFY_URL', initialConfig.baseUrl || 'http://localhost:8188').replace(/\/+$/, '')
export const COMFY_API_KEY = env('DSH_SVS_COMFY_KEY', initialConfig.apiKey || '')
export const POLL_INTERVAL_MS = Number(env('DSH_SVS_POLL_MS', initialConfig.pollMs || 2000))
export const GENERATION_TIMEOUT_MS = Number(env('DSH_SVS_TIMEOUT_MS', initialConfig.timeoutMs || 15 * 60 * 1000))

export const FLUX_MODEL = env('DSH_SVS_FLUX_MODEL', initialModels.fluxUnet || 'flux2_dev_fp8mixed.safetensors')
export const FLUX_CLIP = env('DSH_SVS_FLUX_CLIP', initialModels.fluxClip || 'mistral_3_small_flux2_bf16.safetensors')
export const FLUX_CLIP_TYPE = 'flux2'
export const FLUX_VAE = env('DSH_SVS_FLUX_VAE', initialModels.fluxVae || 'flux2-vae.safetensors')

export const H3_MODEL = env('DSH_SVS_H3_MODEL', initialModels.h3Unet || 'minimax_h3_fl2va_pruned_int8_convrot.safetensors')
export const H3_CLIP = env('DSH_SVS_H3_CLIP', initialModels.h3Clip || 'qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors')
export const H3_CLIP_TYPE = 'minimax'
export const H3_VAE = env('DSH_SVS_H3_VAE', initialModels.h3VideoVae || 'minimax_h3_video_vae_fp16.safetensors')
export const H3_AUDIO_VAE = env('DSH_SVS_H3_AUDIO_VAE', initialModels.h3AudioVae || 'minimax_h3_audio_vae_fp32.safetensors')
export const H3_MODEL_REF = env('DSH_SVS_H3_MODEL_REF', initialModels.h3RefUnet || 'minimax_h3_ref2va_pruned_int8_convrot.safetensors')
export const H3_LORA_FAST = env('DSH_SVS_H3_LORA_FAST', initialModels.h3FastLora || 'minimax_h3_ref2v_turbo_4step_v0.1_comfyui_bf16.safetensors')
export const H3_FPS = Number(env('DSH_SVS_H3_FPS', initialModels.h3Fps || 24))

export const CONFIG_PATH = process.env.DSH_SVS_CONFIG || join(homedir(), '.dsh', 'dsh-short-video-studio.json')

export function getCfg() {
  const config = loadConfigFile()
  const models = config.models || {}
  return {
    baseUrl: env('DSH_SVS_COMFY_URL', config.baseUrl || 'http://localhost:8188').replace(/\/+$/, ''),
    apiKey: env('DSH_SVS_COMFY_KEY', config.apiKey || ''),
    pollMs: Number(env('DSH_SVS_POLL_MS', config.pollMs || 2000)),
    timeoutMs: Number(env('DSH_SVS_TIMEOUT_MS', config.timeoutMs || 15 * 60 * 1000)),
    canvasHome: config.canvasHome === 'sidebar' ? 'sidebar' : 'tab',
    features: {
      promptSnapshots: config.features?.promptSnapshots !== false,
      workflowInspector: config.features?.workflowInspector !== false,
      attemptDiagnostics: config.features?.attemptDiagnostics !== false,
    },
    models: {
      fluxUnet: env('DSH_SVS_FLUX_MODEL', models.fluxUnet || 'flux2_dev_fp8mixed.safetensors'),
      fluxClip: env('DSH_SVS_FLUX_CLIP', models.fluxClip || 'mistral_3_small_flux2_bf16.safetensors'),
      fluxVae: env('DSH_SVS_FLUX_VAE', models.fluxVae || 'flux2-vae.safetensors'),
      h3RefUnet: env('DSH_SVS_H3_MODEL_REF', models.h3RefUnet || 'minimax_h3_ref2va_pruned_int8_convrot.safetensors'),
      h3FlUnet: env('DSH_SVS_H3_MODEL_FL', models.h3FlUnet || 'minimax_h3_fl2va_pruned_int8_convrot.safetensors'),
      h3Clip: env('DSH_SVS_H3_CLIP', models.h3Clip || 'qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors'),
      h3VideoVae: env('DSH_SVS_H3_VAE', models.h3VideoVae || 'minimax_h3_video_vae_fp16.safetensors'),
      h3AudioVae: env('DSH_SVS_H3_AUDIO_VAE', models.h3AudioVae || 'minimax_h3_audio_vae_fp32.safetensors'),
      h3FastLora: env('DSH_SVS_H3_LORA_FAST', models.h3FastLora || 'minimax_h3_ref2v_turbo_4step_v0.1_comfyui_bf16.safetensors'),
      h3FlFastLora: env('DSH_SVS_H3_LORA_FL_FAST', models.h3FlFastLora || 'minimax_h3_fl2v_lightx2v_turbo_4step_v0.1_comfy.safetensors'),
      h3BalancedLora: env('DSH_SVS_H3_LORA_BALANCED', models.h3BalancedLora || 'minimax_h3_ref2v_turbo_8step_v1.0_768p_comfyui_bf16.safetensors'),
      h3FlBalancedLora: env('DSH_SVS_H3_LORA_FL_BALANCED', models.h3FlBalancedLora || 'minimax_h3_fl2v_turbo_8step_v1.0_768p_comfyui_bf16.safetensors'),
      h3PddRef2v: env('DSH_SVS_H3_PDD_REF2V', models.h3PddRef2v || 'minimax_h3_ref2va_pdd_acc_8step_comfyui.safetensors'),
      h3PddFl2v: env('DSH_SVS_H3_PDD_FL2VA', models.h3PddFl2v || 'minimax_h3_fl2va_pdd_acc_8step_comfyui.safetensors'),
      h3Fps: Number(env('DSH_SVS_H3_FPS', models.h3Fps || 24)),
    },
    assetOverrides: config.assetOverrides || {},
    preferred: config.preferred || {},
    tiers: config.tiers && typeof config.tiers === 'object' ? config.tiers : {},
    strategies: config.strategies && typeof config.strategies === 'object' ? config.strategies : {},
    strategyOf: config.strategyOf && typeof config.strategyOf === 'object' ? config.strategyOf : {},
  }
}

export const DEFAULT_TIER = 'fast'

export const DEFAULT_PREFERRED = {
  'image.text2image': ['elysium-qwen-image-21-t2i'],
  'image.image2image': ['elysium-qwen-image-21-i2i'],
  'video.reference2video': ['elysium-minimax-h3-ref2v'],
  'video.image2video': ['elysium-minimax-h3-i2v'],
}

export const GUIDANCE_ORDER = 150
