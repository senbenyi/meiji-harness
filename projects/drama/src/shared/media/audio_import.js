import {probeBytes,command as mediaCommand,withTemporary} from './media.js'
import {writeFile,readFile} from 'node:fs/promises'
import {join} from 'node:path'
const commandMedia=(args,signal)=>mediaCommand('ffmpeg',args,{signal})
export async function importAudio(projects,id,ctx,command,{minimum=0,maximum=Infinity,invalidMessage='无效音频'}={}){
      const bytes=Buffer.from(command.base64||'','base64');if(!bytes.length||bytes.length>24*1024*1024)throw new TypeError('音频最多24MiB')
      const media=await probeBytes(bytes,'wav',{signal:ctx.signal});if(!media.audio||media.duration<=0||media.duration<minimum||media.duration>maximum)throw new TypeError(invalidMessage)
      const normalized=await withTemporary(async root=>{const input=join(root,'input'),output=join(root,'audio.wav');await writeFile(input,bytes);await commandMedia(['-v','error','-i',input,'-vn','-ar','48000','-ac','1','-y',output],ctx.signal);return readFile(output)})
      const file_ref=await projects.documents.writeArtifact(id,normalized,{kind:'audio',extension:'wav'})
      return {file_ref,media}
}
