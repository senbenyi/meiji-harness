import promptModel from '../../prompts/models/scene-image.js';
import costume from './costume-image.js';
import { commonValues } from '../../prompts/inputs.js';
const input={language:'string',requirements:'string',scene:'object',aspectRatio:'string',references:'array'};
export default {promptModel,compose:value=>({...commonValues(value),场景资料:value.scene}),validateInput:costume.validateInput,
  actions:{generate:{input,output:costume.actions.generate.output},regenerate:{input:{...input,opinion:'string'},output:costume.actions.generate.output}}};
