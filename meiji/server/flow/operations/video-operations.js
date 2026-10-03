// 兼容出口：实现已拆分到 tasks/、actions/、shared/ 下的独立文件（阶段 2 结束后删除本文件）。
export { submitH3, filmClipUrl, prepareFilmOpening, previewFilmSubmit, formatFilmRequest, filmSubmit, saveFilmResult, saveTailFrame, submitFilm, filmWrites, writeFilm } from './tasks/film-video.js'
export { produceShots } from './tasks/film.js'
