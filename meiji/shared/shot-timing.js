export function shotSecondsReady(shot) { return [1, 2].includes(shot?.seconds?.content?.version) && Array.isArray(shot.seconds.content.beats) && shot.seconds.content.beats.length > 0 }
