import {randomUUID} from 'node:crypto'

export const uid=prefix=>`${prefix}_${randomUUID()}`
export async function readJSON(projects,id,ref){return JSON.parse((await projects.documents.readArtifact(id,ref)).toString())}
export const stageStep=(kind,metadata={},round=0)=>({kind,round,name:kind,executor:['generate','revise','review'].includes(kind)?'ai':'program',metadata})
