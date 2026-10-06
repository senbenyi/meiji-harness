import { runNode } from '../../runtime/step-execution.js'
import { retrieveGatewayVideo } from '../../gateway/model-gateway.js'
import { saveFilmResult } from './shared/video-submit.js'

export const generateVideo = ({ queued, shot, projects, project, track, home, deps }) => runNode('video_generate', async () => {
  const bytes = await (deps.retrieveGatewayVideo || retrieveGatewayVideo)({ baseUrl: queued.baseUrl, promptId: shot.promptId, provider: queued.provider, apiKey: queued.apiKey, signal: deps.signal })
  return saveFilmResult(projects, project, track, bytes, home)
}, { target: `film:${track}`, remoteId: shot.promptId })
