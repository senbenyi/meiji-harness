import { episodeBudgetRules, reviewLanguageRule, visualExpressionRule, spatialContinuityRule, positiveVisualRule } from './common.js';
// 节点动作要求；输入/输出契约定义在 server/http/nodes。
// 生成、修订、审核都用短规则。审核分类由 reviewPolicy 统一追加。
export const shotJsonRules = '本次只返回镜头表 shots，或修订用的 patch/replace。修改意见里的是否通过、原因是历史诊断，不能改成审核响应或返回空表。body、on_screen_characters、background_characters、continuity_transition、reference_anchor、audio_arrangement 都在镜头根层。reference_anchor 只含 fixed_landmark、character_positions、departed_characters、lighting。audio_arrangement 只含 narration、dialogue、sound_effects。on_screen_characters 每项只含 character_id、costume_id。示例：{"body":"本镜正文","on_screen_characters":[],"background_characters":"","reference_anchor":{"fixed_landmark":"","character_positions":"","departed_characters":"","lighting":""},"audio_arrangement":{"narration":"","dialogue":"","sound_effects":""}}。不返回空 shots，不把同一正文复制到其他镜头，不加注释或尾逗号。';
const sceneSetupRules = "镜头表确定整镜共用的场景与摄影，供每秒分镜继承，不新增字段。body 在完整事件之外交代可见场景背景及整镜摄影安排（机位或运镜、观察方向、对焦）；shot_scale 定景别；reference_anchor.fixed_landmark 写固定参照和关键物件位置，character_positions 写位置、朝向、初始姿态和实际可见范围，lighting 写光源方向和明暗；continuity_transition 写开场及前后衔接；audio_arrangement 写整镜音频基线。未写明的摄影可以设计，但不改变剧情，不杜撰地点、时代、物件、服装或新事件。剧情里的报秒终点和发射时刻必须留在对应事件镜头，不改原报数，也不把剧情时钟当成镜头时长。每镜有明确的叙事或情绪作用，按剧情分配建立空间、行动、反应和结果的画面。空间参照写现有锚点，观察方向写body，位置变化和切点写衔接；静态关系可继承，不另建字段。只写整镜，不写逐秒。不因没有逐字原文就拒绝合理拍摄设计。";
const shotCastRules = "1. 镜头表同时确定出镜与着装。on_screen_characters 只列本镜实际可见的卡内人物，character_id、costume_id 原样取自【角色与服装目录】，同一人只列一次。只提及、画外发声或独立旁白不列入。不能因为目录里有姓名就安排出场。\n2. 有服装目录时必须选择一套属于该人物且符合本镜剧情的服装；没有目录时 costume_id 为空。优先用本段写明的着装和同场景前镜已确定的穿着。同一连续场景里先写群体、后写其中一人的具体衣服，以具体描述为准，不另造一套。只有写明换装或有时间省略才改服装。不用别人的服装，不自造 ID。目录缺少上游指定的服装时指出缺口，不用其他服装顶替。\n3. body 写清谁出镜、可见表演和已知着装，不以 ID 代替可拍摄描述。资料没写的细节标未明确，不编造。\n4. background_characters 写上游已有的不具名群演及其动作。群演可以抬手、点头、移动、说上游已有的台词，不因可见动作就要求角色卡、服装 ID 或参考图，也不占三名重要人物上限。\n5. 原文身份明确对应目录人物时使用该 ID。不把未具名者强配给具名角色。";
const sceneBindingRules = "场景目录只含反复出现、重要或用户要求固定的地点。目录地点 scene_id 原样绑定并继承布局；一次性地点 scene_id 为空，写在 body，不要求新建或配图。scene_state 写本镜有依据的昼夜、天气、损坏，不因机位变化新建场景。scene_transition 只能是连续接拍、切换机位、换场：要接前镜末帧的连续动作才写连续接拍，正反打写切换机位，换地点或明显时间跳跃写换场。这三个字段在镜头根层。不因一次性地点未建档拒绝。";
const splitRules = "1. 按【本集故事小段】的 sequence 转成镜头，不续写、不重排、不跨段合镜。一段可以对应多镜。body 是剧情依据，causal 只帮助理解因果。\n2. 直接使用【时长规划】里的 budget_seconds、min_shots、max_shots 和整集目标，不手算，也不因本集参考时长去伸缩小段预算。\n3. 每镜 4 至 15 秒，镜数落在该段 min_shots 到 max_shots。各段合计贴近该段整数预算；全表与小段合计取整相差不超过 30 秒。某段预算不足 4 秒时保留事件，用一镜 4 秒，计入这 30 秒，不删段。\n4. 先锁定每段的镜数、顺序、范围和时长，再填字段。末镜接收剩余秒数；不足 4 秒或超过 15 秒时，先在同段内调整。锁定后不边填边加镜或改顺序。\n5. 该段写明的人物、动作、对象、环境、因果、情绪、道具、衣着、对白和结尾都要落到这段连续镜头，保留程度和语气。原台词和说话人不改。长对白按语义拆开，拼回后仍是原话。不为凑时长删对白、快进、新编事件或重复过程，也不为钩子或景别发明剧情。";
const fieldRules = "1. title 概括本镜事件。已有镜头沿用原 id，新镜头 id 为空字符串，不输出 number。顺序就是播放顺序。\n2. body 写完整事件和原台词。shot_scale 写景别。hook 只从这八个里选：视觉笑点、反转、悬念、温情、追逐、揭示、回扣、表情拍。按已有内容选，不设配额，不为标签编事件。\n3. continuity_transition 只写本镜开场承接和结束时点，不提前执行下一镜动作。首镜写开场，末镜停在原结尾；机位切换不是人物移动。body、衔接、人物位置和音频须对应同一镜内事实；拆镜或移走动作时同步改相关字段，不能只删正文却在衔接或位置里保留已完成的旧动作。\n4. reference_anchor 只写固定参照、人物位置朝向与可见范围、实际离场和光位。未入镜不等于离场，没有要记的人就留空。audio_arrangement 只写原有旁白、对白、音效及说话人，与 body 一致；没有的声音留空，不新增解说或配乐，不写逐秒。\n5. 单镜有动作或对白的重要角色不超过 3 人，群演不计。同场景相邻镜头的地标和光位要么继承，要么写明变化。已离场的角色再记一镜，连续两镜明确不在场后不再记。";
const generateRules = {
  画面表达: visualExpressionRule,
  空间连续性: spatialContinuityRule,
  正向描述: positiveVisualRule,
  固定集预算: episodeBudgetRules,
  统一场景绑定: sceneBindingRules,
  整镜设定: sceneSetupRules,
  拆分: splitRules,
  字段填写: fieldRules,
  角色与服装: shotCastRules,
};
const nodeLanguageRule = "自然语言使用{{输出语言}}；对白、旁白和心声台词保留原文。字段名、钩子枚举和编号不翻译。";
export default {
  generate: {
    system: { 规则: generateRules, 语言要求: nodeLanguageRule },
    user: {
      任务: "先按小段预算锁定每镜 4 至 15 秒的镜头，再填写字段，只返回本集完整镜头表。",
      背景信息: {
        本集故事小段: "{{本集故事小段}}",
        本集参考时长秒: "{{本集时长秒}}",
        时长规划: "{{时长规划}}",
        角色与服装目录: "{{本集角色资料}}",
        本集场景资料: "{{本集场景资料}}",
      },
      补充需求: "{{补充需求}}",
    },
  },
  regenerate: {
    system: {
      规则: {
        ...generateRules,
        修改范围: "先核对最新候选，已改对的历史意见不再改。只改仍有问题的小段和字段。id为空的新候选用candidate_index（完整基稿从0开始的数组位置）和原 title；审核位置从 1 计，candidate_index 用该位置减 1，title 必须与该下标标题一致，对不上就改用 mode=replace。已有非空唯一 id 用 id 与 changes。增删、拆并、重排必须 mode=replace，新镜头 id 为空。不能用空 id 做 patch。纯时长数字错误只改 duration_seconds；动作或对白放不下才改该段镜数和正文。",
      },
      语言要求: nodeLanguageRule,
    },
    user: {
      任务: "只修正最新候选里仍存在的问题。待修订表只作切镜和身份参考，按局部或全表契约返回。",
      修改意见: "{{修改意见}}",
    },
  },
  review: {
    system: {
      规则: {
        程序与AI分工: "本次只审核，不改候选，不返回镜头表。程序已核对 JSON、人物和服装 ID、单镜 4 至 15 秒以及全表时长合计。AI 不因 ID 格式、未知字段或时长合计拒绝。镜头编号不是小段编号，一段多镜是合法的。修改意见只用来核对上次的问题是否已解决，已修复的不再报。",
        画面表达: visualExpressionRule,
        空间连续性: spatialContinuityRule,
        正向描述: positiveVisualRule,
        固定集预算: episodeBudgetRules,
        统一场景绑定: sceneBindingRules,
        整镜设定: sceneSetupRules,
        角色与服装: shotCastRules,
        核对清单: "1. 每个小段的事件、动作、原台词和结尾都落在自己的连续镜头里，顺序不跳、不倒，不把不同小段写进同一镜。拒绝时写出同一镜里来自不同小段的两项事实，或实际跳过的段。位置从 1 计，不能引用不存在的镜。\n2. 叙事可以同义转写。原对白和画面文字必须逐字保留。漏掉明确动作、对象、结果或限定才拒绝。正文或对白已经写了的内容，不因锚点没再写一遍而判遗漏。\n3. 钩子必须是八个枚举之一，且对应已有内容。景别可以连续相同。重要角色单镜不超过 3 人。同场景地标和光位要么继承，要么有变化说明。未入镜不等于离场。\n4. 候选已经承认时序或空间缺口、又没有可执行转场依据的，判未通过，并指出要补的上游事实。已有依据的回叙、换场和时间省略可以通过。不要求本节点编出舱或倒叙。\n5. 不因没有参考图、群演未绑定、一次性地点未建档或个人节奏偏好拒绝。没有其他问题时通过，原因留空。",
        原因格式: "拒绝时一行一条：小段或镜位｜字段｜依据原文｜改法。",
      },
      语言要求: reviewLanguageRule,
    },
    user: {
      任务: "按核对清单审核最新镜头表。通过时原因留空。",
      背景信息: {
        本集故事小段: "{{本集故事小段}}",
        角色与服装目录: "{{本集角色资料}}",
        本集场景资料: "{{本集场景资料}}",
        本集参考时长秒: "{{本集时长秒}}",
        时长规划: "{{时长规划}}",
      },
      修改意见: "{{修改意见}}",
      待审核内容: "{{待审核内容}}",
      补充需求: "{{补充需求}}",
    },
  },
};
