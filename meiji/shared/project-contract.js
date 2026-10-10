import {
  createId,
  assertId,
  assertRecord,
  assertText,
  assertEnum,
  assertNumber,
  assertFields,
  validateNode,
  invalid,
  BUSINESS_TARGET,
} from "./task-contract.js";
const media = () => ({ 状态: "empty", 原因: "", 地址: "" });
const text = () => ({ 状态: "empty", 原因: "", 正文: "" });
export function emptyProject(fields = {}) {
  return {
    id: createId("project"),
    名称: "",
    创作方式: "自由创作",
    画幅: "1344x768",
    创作方向: "",
    输出语言: "zh-CN",
    参考单集时长秒: 150,
    规则: [],
    项目摘要: { ...text(), 剧本版本: 1 },
    剧本: {
      版本: 1,
      更新时间: "",
      正文: "",
      后续剧情: "",
      修改记录: [],
    },
    角色库: { 状态: "empty", 原因: "", 角色: [] },
    剧集: [],
    ...fields,
  };
}
export function emptyEpisode(fields = {}) {
  return {
    id: createId("episode"),
    序号: 1,
    时长秒: 150,
    实际时长秒: 0,
    本集要求: "",
    封面: "",
    剧情: "",
    摘要: text(),
    故事大纲: { 状态: "empty", 原因: "", 小段: [] },
    本集资产: { 状态: "empty", 原因: "", 角色: [] },
    镜头表: { 状态: "empty", 原因: "", 镜头: [] },
    合片: media(),
    ...fields,
  };
}
export function emptyShot(fields = {}) {
  return {
    id: createId("shot"),
    序号: 1,
    编号: "S01",
    时长秒: 12,
    实际时长秒: 0,
    标题: "",
    正文: "",
    出镜角色: [],
    每秒分镜: {
      状态: "empty",
      原因: "",
      衔接上一镜方式: "",
      内容: { 事件: "", 节拍: [], 环境声: [], 配乐: [] },
    },
    文本提示词: { 状态: "empty", 原因: "", 正文: [], 环境声: "", 配乐: "" },
    视频: media(),
    尾帧: media(),
    ...fields,
  };
}
const list = (v, path) => {
  if (!Array.isArray(v)) invalid(path, "需为数组");
  return v;
};
export function validateProject(p) {
  assertFields(
    p,
    [
      "id",
      "名称",
      "创作方式",
      "画幅",
      "创作方向",
      "输出语言",
      "参考单集时长秒",
      "规则",
      "项目摘要",
      "剧本",
      "角色库",
      "剧集",
    ],
    "项目",
  );
  const ids = new Set();
  const register = (v, path) => {
    assertId(v.id, `${path}.id`);
    if (ids.has(v.id)) invalid(`${path}.id`, "重复 ID");
    ids.add(v.id);
  };
  register(p, "项目");
  for (const k of ["名称", "画幅", "创作方向"]) assertText(p[k], `项目.${k}`);
  if (!/^\d+x\d+$/.test(p.画幅)) invalid("画幅", "需为分辨率");
  assertEnum(p.创作方式, ["剧本", "自由创作"], "创作方式");
  assertEnum(p.输出语言, ["zh-CN", "en"], "输出语言");
  assertNumber(p.参考单集时长秒, "参考单集时长秒", 1);
  validateNode(p.项目摘要, "项目摘要");
  assertText(p.项目摘要.正文, "项目摘要.正文");
  assertNumber(p.项目摘要.剧本版本, "项目摘要.剧本版本", 1);
  assertFields(
    p.剧本,
    ["版本", "更新时间", "正文", "后续剧情", "修改记录"],
    "剧本",
  );
  assertNumber(p.剧本.版本, "剧本.版本", 1);
  for (const k of ["更新时间", "正文", "后续剧情"])
    assertText(p.剧本[k], `剧本.${k}`);
  list(p.剧本.修改记录, "剧本.修改记录");
  validateNode(p.角色库, "角色库");
  const chars = new Map(),
    costumes = new Map(),
    numbers = new Set();
  const numbered = (row, path) => {
    assertText(row.编号, `${path}.编号`);
    if (!row.编号 || numbers.has(row.编号))
      invalid(`${path}.编号`, "重复或空编号");
    numbers.add(row.编号);
  };
  for (const c of list(p.角色库.角色, "角色库.角色")) {
    register(c, "角色");
    numbered(c, "角色");
    chars.set(c.id, c);
    for (const k of [
      "名称",
      "国籍",
      "身份",
      "身份特征",
      "性别",
      "年代",
      "年龄",
      "身高",
      "体型",
      "面相",
      "声音",
      "默认服装id",
    ])
      assertText(c[k], `角色.${k}`);
    if (typeof c.必出 !== "boolean") invalid("角色.必出", "需为布尔值");
    validateNode(c.图片, "角色.图片");
    assertText(c.图片.地址, "角色.图片.地址");
    assertText(c.参考图?.地址, "角色.参考图.地址");
    for (const co of list(c.服装, "角色.服装")) {
      register(co, "服装");
      numbered(co, "服装");
      costumes.set(co.id, c.id);
      assertText(co.名称, "服装.名称");
      assertText(co.描述, "服装.描述");
      validateNode(co.图片, "服装.图片");
      assertText(co.图片.地址, "服装.图片.地址");
    }
    if (c.默认服装id && costumes.get(c.默认服装id) !== c.id)
      invalid("角色.默认服装id", "服装不属于该角色");
  }
  const character = (id, path) => {
    if (!chars.has(id)) invalid(path, "角色引用不存在");
  };
  const episodes = new Set();
  for (const e of list(p.剧集, "剧集")) {
    register(e, "剧集");
    episodes.add(e.id);
    assertNumber(e.序号, "剧集.序号", 1);
    assertNumber(e.时长秒, "剧集.时长秒", 1);
    if (
      typeof e.实际时长秒 !== "number" ||
      !Number.isFinite(e.实际时长秒) ||
      e.实际时长秒 < 0
    )
      invalid("剧集.实际时长秒", "需为非负秒数");
    assertText(e.本集要求, "剧集.本集要求");
    assertText(e.封面, "剧集.封面");
    assertText(e.剧情, "剧集.剧情");
    for (const key of ["摘要", "故事大纲", "本集资产", "镜头表", "合片"])
      validateNode(e[key], `剧集.${key}`);
    assertText(e.摘要.正文, "摘要.正文");
    assertText(e.合片.地址, "合片.地址");
    for (const part of list(e.故事大纲.小段, "故事大纲.小段")) {
      assertNumber(part.序号, "小段.序号", 1);
      assertNumber(part.时长秒, "小段.时长秒", 1);
      assertText(part.正文, "小段.正文");
    }
    for (const r of list(e.本集资产.角色, "本集资产.角色")) {
      character(r.角色id, "本集资产.角色id");
      assertEnum(r.出镜, ["出镜", "仅声音"], "本集资产.出镜");
    }
    const shots = new Set();
    for (const s of list(e.镜头表.镜头, "镜头表.镜头")) {
      register(s, "镜头");
      assertNumber(s.序号, "镜头.序号", 1);
      assertText(s.编号, "镜头.编号");
      if (!s.编号 || shots.has(s.编号)) invalid("镜头.编号", "重复或空编号");
      shots.add(s.编号);
      assertNumber(s.时长秒, "镜头.时长秒", 1);
      if (s.实际时长秒 !== undefined && (typeof s.实际时长秒 !== "number" || !Number.isFinite(s.实际时长秒) || s.实际时长秒 < 0))
        invalid("镜头.实际时长秒", "需为非负有限秒数");
      if (s.时长秒 > 15) invalid("镜头.时长秒", "最多 15 秒");
      assertText(s.标题, "镜头.标题");
      assertText(s.正文, "镜头.正文");
      for (const r of list(s.出镜角色, "镜头.出镜角色")) {
        character(r.角色id, "出镜角色.角色id");
        if (r.服装id && costumes.get(r.服装id) !== r.角色id)
          invalid("出镜角色.服装id", "服装不属于该角色");
      }
      for (const key of ["每秒分镜", "文本提示词", "视频", "尾帧"])
        validateNode(s[key], `镜头.${key}`);
      for (const key of ["视频", "尾帧"])
        assertText(s[key].地址, `${key}.地址`);
      assertText(s.每秒分镜.衔接上一镜方式, "每秒分镜.衔接上一镜方式");
      const content = s.每秒分镜.内容;
      assertRecord(content, "每秒分镜.内容");
      assertText(content.事件, "每秒分镜.事件");
      for (const beat of list(content.节拍, "每秒分镜.节拍")) {
        range(beat, "节拍", s.时长秒);
        for (const k of ["动作", "镜头", "空间", "声音", "交接"])
          assertText(beat[k], `节拍.${k}`);
        for (const d of list(beat.对白, "节拍.对白")) {
          assertText(d.说话人id, "对白.说话人id");
          if (d.说话人名称 !== undefined)
            assertText(d.说话人名称, "对白.说话人名称");
          if (d.说话人id) character(d.说话人id, "对白.说话人id");
          assertEnum(d.方式, ["画内", "画外", "心声"], "对白.方式");
          assertText(d.表演, "对白.表演");
          assertText(d.台词, "对白.台词");
        }
      }
      for (const key of ["环境声", "配乐"])
        for (const a of list(content[key], `每秒分镜.${key}`)) {
          range(a, key, s.时长秒);
          assertText(a.正文, `${key}.正文`);
        }
      for (const row of list(s.文本提示词.正文, "文本提示词.正文")) {
        range(row, "文本提示词", s.时长秒);
        for (const k of [
          "动作",
          "镜头",
          "空间",
          "同步声音",
          "对白",
          "心声",
          "结尾状态",
        ])
          assertText(row[k], `文本提示词.${k}`);
      }
      assertText(s.文本提示词.环境声, "文本提示词.环境声");
      assertText(s.文本提示词.配乐, "文本提示词.配乐");
    }
  }
  for (const r of list(p.规则, "规则")) {
    register(r, "规则");
    assertEnum(r.范围, ["project", "node"], "规则.范围");
    assertText(r.节点id, "规则.节点id");
    if (r.范围 === "node" && !ids.has(r.节点id))
      invalid("规则.节点id", "目标引用不存在");
    if (r.范围 === "project" && r.节点id !== "")
      invalid("规则.节点id", "项目规则为空");
    for (const b of list(r.适用业务, "规则.适用业务"))
      assertEnum(b, Object.keys(BUSINESS_TARGET), "规则.适用业务");
    assertEnum(
      r.类别,
      ["动作", "表情", "武术", "特效", "声音", "对白", "配乐", "其他"],
      "规则.类别",
    );
    assertEnum(r.约束, ["必须", "参考"], "规则.约束");
    assertText(r.内容, "规则.内容");
  }
  return p;
}
function range(row, path, duration) {
  for (const k of ["开始秒", "结束秒"])
    if (typeof row[k] !== "number" || !Number.isFinite(row[k]) || row[k] < 0)
      invalid(`${path}.${k}`, "需为非负秒数");
  if (row.开始秒 >= row.结束秒 || row.结束秒 > duration)
    invalid(path, "时段需非空且不超出本镜");
}
