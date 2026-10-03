// 兼容出口：实现已拆分到 tasks/、actions/、shared/ 下的独立文件（阶段 2 结束后删除本文件）。
export { generateShotStoryboard, generateStoryboard } from './tasks/film-storyboard.js'
export { generateAllSeconds } from './tasks/seconds.js'
export { generateShotSeconds } from './tasks/shot-seconds.js'
export { readShotSections, generateShots, reviseShot } from './tasks/shot-table.js'
