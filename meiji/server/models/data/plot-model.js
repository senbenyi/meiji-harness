import { node } from './content-node.js'

// 一集剧情：故事小段、人物、场景、道具。
export function plotModel() {
  return {
    ...node('plot'),
    outline: node('outline'),
    characters: { ...node('characters'), items: [] },
    scenes: { ...node('scenes'), items: [] },
    props: { ...node('props'), items: [] },
  }
}
