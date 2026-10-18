import { visualExpressionRule, spatialContinuityRule, positiveVisualRule } from './common.js';
// 生成、修订、审核都用短规则。审核分类由 reviewPolicy 统一追加。
const dialogueSentenceRules = "一句台词必须完整放在同一个 <d> 中，不能拆开。同一人连续多句可以放在一个 <d>，也可以在完整句之间分开。逗号、省略号、换气和节拍边界不能拆句。标签内只留原话和原标点，说话人和 (S1) 写在标签外，正确形式为 (S1)说：<d>原话。</d>。心声和实际发声分开标记。画内转画外的同一句要合回完整句。一句拆成多个标签即不通过。";
const sceneSetupRules = "【本镜每秒分镜】中的 shot_setup 是程序从当前镜头表读取的整镜设定。含 scene 时保留布局、地标、材质和本镜 state，角度变化不能改掉固定物件位置。把场景背景、摄影、景别、初始构图、可见范围、光照和开场状态写进 integrated_multimodal_description 开头，再按时间线写变化。audio_arrangement 只补声音基线，不重复台词。事件次序以节拍时间线为准。保留上游具体的动作反馈、空间层次、情绪节奏和特效过程，不用抽象形容替换。切镜后交代观察方向、人物相对地标的位置和面向对象，不直接复制前机位的画面左右。不重新设计背景和摄影；上游有真实空间冲突时指出来源，不自行换位圆场。";
const characterTextRules = "本节点仅生成文本提示词。卡内人物和服装按既定 ID 继承，不重新选服装。群演保留上游表演，不要求角色卡或参考图。只写本镜可见或听得见的特征。人物资料是可用设定，不是逐项转写清单；一般外貌未逐一复述不算遗漏，写反或混淆人物特征才拒绝。明确不可改特征按实际可见、可听范围保留。只拍手和袖口时写明画面只见手和袖口；只有画外声时写明为画外声，画面只呈现在场人物。禁止定妆照、图片地址或编造参考图标签。最终只返回既定三段文本。";
const transcribeRules = "同一机位的各拍写入同一个 [Shot 1]，按节拍顺序写成连贯句子：人物和场景用资料中的姓名，写清谁做什么、停留大约几秒、机位是否变化、这一拍的声音，对白紧跟对应动作。[Shot 1] 从本镜0秒开始，始终不加时间戳。首拍相对前镜的切换或新机位只是本镜开场，不要求 At 00:00.000，也不另开一个 [Shot]。禁止用 0–1秒 这类行首时间码照抄节拍表，也不把节拍边界写成切镜。跨多秒的停留写明大致时长，不拆成新动作，也不省掉停留。只有本镜0秒之后的后续节拍 camera 明确写出剪辑切镜或新机位时，才从 [Shot 2] 起顺序新开 [Shot N]，并在开头写 At 加该拍起点，格式如 [Shot 2] At 00:05.000；时间从 time_range 起点换算成 MM:SS.mmm。不自造 <Subject N> 或 <Picture N>。运镜用{{输出语言}}写完整动作描述，幅度和速度只按原分镜。卡内说话人用资料里的 speaker_tag，如 (S1)、(S2)，不得按本镜出场顺序重新编号。对白和歌词放在 <d> 内。心声时嘴唇闭合。画面中的文字只保留原分镜已有的画面文字。三段正文直接发给视频模型，按正向描述规则呈现具体目标状态，修订时也不照抄审核意见或否定指令。";
const soundRules = "声景用1–4句写环境声、动作声和非语言人声，不重复对白；全静音写 N/A。上游没有配乐时 non_diegetic_music 写 N/A；已有配乐才用1–3句描述，不新增配乐。";
const endingRules = "end_state 是本镜实际结束状态。pending_actions、pending_dialogue、continuing_audio 是切点还没结束的事，写入三段提示词，但不提前完成下一镜，不重复已经说完的台词。";
const sharedRules = {
  画面表达: visualExpressionRule,
  空间连续性: spatialContinuityRule,
  正向描述: positiveVisualRule,
  整镜设定继承: sceneSetupRules,
  参与角色文字资料: characterTextRules,
  对白完整句: dialogueSentenceRules,
  转写: transcribeRules,
  声音: soundRules,
  镜末交接: endingRules,
};
const nodeLanguageRule = "三段正文的画面描述、运镜、声景和配乐说明均使用{{输出语言}}；对白、旁白、心声、歌词及画面文字保留原文。固定段名 integrated_multimodal_description、overall_soundscape、non_diegetic_music，以及 [Shot N]、At、MM:SS.mmm、(S1)、(S2)、<d>、N/A 不翻译。审核原因使用{{输出语言}}。";
export default {
  generate: {
    system: { 规则: sharedRules, 语言要求: nodeLanguageRule },
    user: {
      任务: "把已通过的每秒分镜转写成本镜三段提示词。",
      背景信息: {
        本镜每秒分镜: "{{本镜每秒分镜}}",
        本镜角色资料: "{{本镜角色资料}}",
        本镜参考时长秒: "{{本镜参考时长秒}}",
      },
      补充需求: "{{补充需求}}",
    },
  },
  regenerate: {
    system: {
      规则: {
        ...sharedRules,
        修改范围: "只改意见点到的句子和声音。没点到的事件、原台词和段名保持不变。不新增、重排或重新设计镜头。",
      },
      语言要求: nodeLanguageRule,
    },
    user: { 任务: "按修改意见修订基稿，保留未点到的内容。", 修改意见: "{{修改意见}}" },
  },
  review: {
    system: {
      规则: {
        ...sharedRules,
        核对清单: "对照节拍时间线和人物文字资料。待审三段若已按字段提供，字段名就是段名，不要求在字段正文重复段标题。遗漏事件、漏写跨秒停留的时长、改写原台词、把一句拆成多个 <d>、标签内写入说话人标记、按出场顺序重编 (S1)、把节拍边界写成切镜、同一机位拆成多个 [Shot]、自造 <Subject N> 或 <Picture N>、静音或无配乐却不写 N/A，则拒绝。不凭个人偏好重编动作。修改意见只用来核对上次的问题是否已解决。通过时原因留空。",
      },
      语言要求: nodeLanguageRule,
    },
    user: {
      任务: "对照每秒分镜和人物文字资料审核，核对三段正文的自然语言与{{输出语言}}一致。通过时原因留空。",
      背景信息: {
        本镜每秒分镜: "{{本镜每秒分镜}}",
        本镜角色资料: "{{本镜角色资料}}",
        本镜参考时长秒: "{{本镜参考时长秒}}",
      },
      补充需求: "{{补充需求}}",
      修改意见: "{{修改意见}}",
      待审核内容: "{{待审核内容}}",
    },
  },
};
