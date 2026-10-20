// 兼容 meiji 的原有入口；旧协议仅保留在业务项目内。
export {
  generateGatewayImage, submitGatewayVideo, retrieveGatewayVideo,
  gatewayImageSize, gatewayVideoSize, requestByteLimit, dataUrl, publicData,
} from '../http/elysium/legacy/gateway.js';
