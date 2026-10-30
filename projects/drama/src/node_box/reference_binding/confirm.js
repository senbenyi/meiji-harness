export async function confirm(p){if((!p.shot_design.shots.length||p.shot_design.shots.some(s=>s.characters.length&&!s.reference_images.length)))throw new TypeError('镜头参考尚未绑定')
}
