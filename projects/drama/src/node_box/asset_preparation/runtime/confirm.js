import {preparationState} from './assets.js'
export async function confirm(p){const state=preparationState(p);if(state.status!=='confirmed')throw new TypeError(state.reason)
}
