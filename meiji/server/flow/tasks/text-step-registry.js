import { savedProjectCharactersInput, reviewProjectCharacters } from '../steps/step-review-project-characters.js'
import { generateScriptChanges } from '../steps/step-generate-script-changes.js'
import { reviewScriptChanges } from '../steps/step-review-script-changes.js'
import { reviseScriptChanges } from '../steps/step-revise-script-changes.js'
import { generateOutline } from '../steps/step-generate-outline.js'
import { reviewOutline, savedOutlineInput } from '../steps/step-review-outline.js'
import { reviseOutline } from '../steps/step-revise-outline.js'
import { extractCharacters } from '../steps/step-extract-characters.js'
import { reviewCharacters, savedCharactersInput } from '../steps/step-review-characters.js'
import { reviseCharacters } from '../steps/step-revise-characters.js'
import { extractScenes } from '../steps/step-extract-scenes.js'
import { reviewScenes, savedScenesInput } from '../steps/step-review-scenes.js'
import { reviseScenes } from '../steps/step-revise-scenes.js'
import { generateSummary } from '../steps/step-generate-summary.js'
import { reviewSummary, savedSummaryInput } from '../steps/step-review-summary.js'
import { reviseSummary } from '../steps/step-revise-summary.js'
import { generateProjectSummary } from '../steps/step-generate-project-summary.js'
import { reviewProjectSummary, savedProjectSummaryInput } from '../steps/step-review-project-summary.js'
import { reviseProjectSummary } from '../steps/step-revise-project-summary.js'
import { generateShotTable } from '../steps/step-generate-shot-table.js'
import { reviewShotTable, savedShotTableInput } from '../steps/step-review-shot-table.js'
import { reviseShotTable } from '../steps/step-revise-shot-table.js'
import { generateSeconds } from '../steps/step-generate-seconds.js'
import { reviewSeconds, savedSecondsInput } from '../steps/step-review-seconds.js'
import { reviseSeconds } from '../steps/step-revise-seconds.js'

// 按业务对象组织可执行步骤；模式选择与顺序在任务层处理。
export const textStepRegistry = {
  script: { generate: generateScriptChanges, review: reviewScriptChanges, revise: reviseScriptChanges },
  'outline': { generate: generateOutline, review: reviewOutline, reviewInput: savedOutlineInput, revise: reviseOutline },
  'characters': { generate: extractCharacters, review: reviewCharacters, reviewInput: savedCharactersInput, revise: reviseCharacters },
  'scenes': { generate: extractScenes, review: reviewScenes, reviewInput: savedScenesInput, revise: reviseScenes },
  'summary': { generate: generateSummary, review: reviewSummary, reviewInput: savedSummaryInput, revise: reviseSummary },
  'project-characters': { generate: extractCharacters, review: reviewProjectCharacters, reviewInput: savedProjectCharactersInput, revise: reviseCharacters },
  'project-summary': { generate: generateProjectSummary, review: reviewProjectSummary, reviewInput: savedProjectSummaryInput, revise: reviseProjectSummary },
  'shots': { generate: generateShotTable, review: reviewShotTable, reviewInput: savedShotTableInput, revise: reviseShotTable },
  'seconds': { generate: generateSeconds, review: reviewSeconds, reviewInput: savedSecondsInput, revise: reviseSeconds },
}
