export function shotSecondsReady(shot) { return shot?.seconds?.content?.version === 1 && Array.isArray(shot.seconds.content.beats) && shot.seconds.content.beats.length > 0 }
