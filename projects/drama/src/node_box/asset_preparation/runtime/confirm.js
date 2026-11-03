import {requiredAssets} from './assets.js'
export async function confirm(p){if(requiredAssets(p).some(({asset})=>!asset.selected_image_id))throw new TypeError('尚有素材未选用')
}
