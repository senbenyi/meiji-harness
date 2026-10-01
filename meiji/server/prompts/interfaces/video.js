import { FilmModel } from '../models/film-model.js'
export default task => new FilmModel(task).toGenerateSegments()
