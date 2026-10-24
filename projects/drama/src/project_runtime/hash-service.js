import { createHash } from 'node:crypto'
import { NodeStateModel } from '@agent-modules/task/models'
import { nodeRules, scriptOutput } from '../node_runtime/node_state.js'
import { createNode } from '../node_runtime/node_initializer.js'
import { groupOutput, characterGroups } from '../node_box/group_setting/state.js'
import { shotCharacters } from '../node_box/shot_design/state.js'

/** 跨盒子内容指纹与下游过期处理；暂未接入任何生产执行链。 */
export class HashService {
  digest(value) {
    const json = JSON.stringify(value, (_, entry) => entry && typeof entry === 'object' && !Array.isArray(entry)
      ? Object.fromEntries(Object.keys(entry).sort().map(key => [key, entry[key]])) : entry)
    return createHash('sha256').update(json).digest('hex')
  }

  matches(left, right) { return this.digest(left) === this.digest(right) }

  scriptFingerprint(project) {
    return this.digest({
      original: project.basic_info.original_script_file_path,
      rules: Object.fromEntries(Object.entries(project.basic_info.script_revision_node.rules).map(([action, rule]) => [action, {
        base: rule.base, supplement: project.basic_info.script_revision_node.supports_supplement ? rule.supplement : '',
      }])),
      supports_supplement: project.basic_info.script_revision_node.supports_supplement,
    })
  }

  storyFingerprint(project) {
    return this.digest({ basic_info: scriptOutput(project), rules: nodeRules(project.story_segments.node_state) })
  }

  sceneFingerprint(project) {
    return this.digest({ segments: project.story_segments.segments, rules: nodeRules(project.scene_extraction.node_state) })
  }

  groupFingerprint(project) {
    return this.digest({ segments: project.story_segments.segments, scenes: project.scene_extraction?.scenes || [], rules: nodeRules(project.group_setting.node_state) })
  }

  characterFingerprint(project) {
    return this.digest({ segments: project.story_segments.segments,
      scenes: project.scene_extraction?.scenes || [], groups: groupOutput(project).groups, group_status: project.group_setting?.node_state.status, rules: nodeRules(project.character_extraction.node_state) })
  }

  shotFingerprint(project) {
    return this.digest({ segments: project.story_segments.segments, outline_status: project.story_segments.node_state.status,
      upstream: ['scene_extraction','group_setting','character_extraction'].map(type => ({ type, status: project[type].node_state.status,
        output: type === 'scene_extraction' ? project[type].scenes : type === 'group_setting' ? project[type].groups : shotCharacters(project) })), rules: nodeRules(project.shot_design.node_state) })
  }

  imageFingerprint(project, target) {
    return this.digest({ character: target.character, costume: target.costume, groups: target.groups,
      aspect_ratio: '3:4', reference_image: target.image.reference_image,
      rules: nodeRules(target.image.node_state) })
  }

  sceneImageFingerprint(project, target) {
    return this.digest({ scene: target.scene, aspect_ratio: project.basic_info.aspect_ratio,
      reference_image: target.image.reference_image, opinion: target.image.node_state.opinion, rules: nodeRules(target.image.node_state) })
  }

  expireScriptDependents(project) {
    const visit = value => {
      if (!value || typeof value !== 'object') return
      if (value.node_state && value.node_state.status !== 'empty') value.node_state = new NodeStateModel({ ...value.node_state, status: 'expired', reason: '上游剧本已变化，需重新确认或生成' }).toJSON()
      for (const [key, child] of Object.entries(value)) if (!['node_state', 'rules', 'output'].includes(key)) visit(child)
    }
    for (const key of ['story_segments', 'group_setting', 'character_extraction', 'scene_extraction', 'shot_design', 'clip_arrangement', 'video_prompt', 'videos', 'episodes']) visit(project[key])
  }

  expireStoryDependents(project) {
    const visit = value => {
      if (!value || typeof value !== 'object') return
      if (value.node_state && value.node_state.status !== 'empty') value.node_state = new NodeStateModel({ ...value.node_state, status: 'expired', reason: '上游故事大纲已变化，需重新确认或生成' }).toJSON()
      for (const [key, child] of Object.entries(value)) if (!['node_state', 'rules'].includes(key)) visit(child)
    }
    for (const key of ['group_setting', 'character_extraction', 'scene_extraction', 'shot_design', 'clip_arrangement', 'video_prompt', 'videos', 'episodes']) visit(project[key])
  }

  expireSceneDependents(project) {
    const expire = node => {
      if (node?.node_state && node.node_state.status !== 'empty') node.node_state = new NodeStateModel({ ...node.node_state, status: 'expired', reason: '场景资料或规则已变化，需重新确认或生成' }).toJSON()
    }
    // 团队/人物需要重审场景相容性；照片仍保留，造型真正改变后由对应盒子使照片过期。
    for (const type of ['group_setting', 'character_extraction', 'shot_design', 'clip_arrangement', 'video_prompt']) expire(project[type])
    const visit = value => {
      if (!value || typeof value !== 'object') return
      expire(value)
      for (const [key, child] of Object.entries(value)) if (!['node_state', 'rules'].includes(key)) visit(child)
    }
    visit(project.videos); visit(project.episodes)
  }

  expireGroupDependents(project, previous = groupOutput(project).groups, groups = groupOutput(project).groups) {
    const expire = (node, reason) => {
      if (node?.node_state && node.node_state.status !== 'empty') node.node_state = new NodeStateModel({ ...node.node_state, status: 'expired', reason }).toJSON()
    }
    const people = project.character_extraction
    expire(people, '团队资料或规则已变化，需重新确认人物与服装关联')
    for (const asset of people.assets) {
      const character = people.characters.find(row => row.id === asset.character_id)
      if (!character) continue
      for (const image of asset.costume_images) {
        const costume = character.costumes.find(row => row.id === image.costume_id)
        if (image.address && this.digest(characterGroups(previous, character, costume)) !== this.digest(characterGroups(groups, character, costume)))
          expire(image, '关联团队形象或制服已变化，需重新生成')
      }
    }
    for (const type of ['shot_design', 'clip_arrangement', 'video_prompt']) expire(project[type], '团队资料或规则已变化，需重新生成')
  }

  expireCharacterDependents(project) {
    for (const type of ['shot_design', 'clip_arrangement', 'video_prompt']) {
      const node = project[type]
      if (node?.node_state.status !== 'empty') node.node_state = new NodeStateModel({ ...node.node_state, status: 'expired', reason: '人物或团队资料已变化，需重新生成' }).toJSON()
    }
  }

  expireShotDependents(project) {
    const visit = value => {
      if (!value || typeof value !== 'object') return
      if(value.node_state && value.node_state.status!=='empty') value.node_state = new NodeStateModel({...value.node_state,status:'expired',reason:'分镜资料或规则已变化，需重新生成'}).toJSON()
      for(const [key,child] of Object.entries(value)) if(!['node_state','rules'].includes(key)) visit(child)
    }
    for(const key of ['clip_arrangement','video_prompt','videos','episodes']) visit(project[key])
  }

  async reconcileSceneAssets(assets, previous, scenes, aspectRatio) {
    const result = []
    for (const scene of scenes) {
      const asset = structuredClone(assets.find(row => row.scene_id === scene.id) || { scene_id: scene.id })
      asset.image_generation ||= { ...await createNode('scene_image'), aspect_ratio: aspectRatio }
      const old = previous.find(row => row.id === scene.id), image = asset.image_generation
      if ((!old && image.address) || old && this.digest(old) !== this.digest(scene)) image.node_state = new NodeStateModel({ ...image.node_state,
        status: image.address ? 'expired' : 'empty', reason: image.address ? '场景资料已变化，需重新生成' : '' }).toJSON()
      result.push(asset)
    }
    return [...result, ...assets.filter(row => !scenes.some(scene => scene.id === row.scene_id))]
  }

  async reconcileCharacterAssets(assets, previous, characters, previousGroups = [], groups = []) {
    const result = []
    for (const character of characters) {
      const asset = structuredClone(assets.find(row => row.character_id === character.id) || { character_id: character.id, reference_image: '', costume_images: [] })
      const old = previous.find(row => row.id === character.id)
      // 保留历史照片，仅使受人物或其关联团队变化影响的照片过期。
      for (const image of asset.costume_images) {
        const costume = character.costumes.find(row => row.id === image.costume_id), oldCostume = old?.costumes.find(row => row.id === image.costume_id)
        if (old && (this.digest(old) !== this.digest(character) || this.digest(characterGroups(previousGroups, old, oldCostume)) !== this.digest(characterGroups(groups, character, costume)))) {
          image.node_state = new NodeStateModel({ ...image.node_state, status: image.address ? 'expired' : 'empty', reason: image.address ? '人物或关联团队资料已变化，需重新生成' : '' }).toJSON()
        }
      }
      for (const costumeId of character.costumes.length ? character.costumes.map(row => row.id) : [null]) {
        if (!asset.costume_images.some(row => row.costume_id === costumeId)) asset.costume_images.push({ costume_id: costumeId, ...await createNode('costume_image') })
      }
      result.push(asset)
    }
    return [...result, ...assets.filter(row => !characters.some(character => character.id === row.character_id))]
  }
}
