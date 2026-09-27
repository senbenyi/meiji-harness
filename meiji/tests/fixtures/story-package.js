export function storyPackageFixture(seconds = 10) {
  return {
    outline: `（${seconds}秒）旅人在庭院等待回应。`,
    characters: { items: [{ name: '旅人', appearance: '方脸短发的高大成年男子', identity: '本集旅人的独立身体', look: '国籍：中国\n姓名：旅人\n身份：旅人\n性别：男\n年代：现代\n年龄：30岁\n服装：灰色外套\n身高：180cm\n体型：高大\n面相：方脸短发', clothes: [], props: [], hairstyles: [] }] },
    scenes: { items: [{ name: '庭院', landmark: '北侧拱门', light: '西侧月光', space: '中央小径通向北侧拱门', look: '开阔石庭院的中央小径通往完整北侧拱门' }] },
  }
}
