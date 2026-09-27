# Skills 命名与分类

## 命名

- 通用：`skill-{分类拼音}-{功能}-{generate|review}.md`
- 镜头：`skill-jingtou-{子tab拼音}-{功能}-{generate|review}.md`

| 分类拼音 | 右侧模块 |
| --- | --- |
| `gailan` | 项目概要 / 剧集 |
| `juqing` | 剧情 |
| `juese` | 角色场景 |
| `jingtou` | 镜头 |
| `chengpian` | 成片 |
| `hecheng` | 合成（暂无 skill） |
| `gongyong` | 片库 / 面板基础设施 |

镜头子 tab：

| 拼音 | 子 tab |
| --- | --- |
| `jingtoubiao` | 镜头表 |
| `meimiao` | 每秒指令 |
| `wenben` | 文本分镜 |
| `qianbi` | 铅笔分镜 |

模式：`generate` 生成 · `review` 审核。运行时 `name` 与文件名去掉 `.md` 后完全一致。

## 对照

| 文件 | name |
| --- | --- |
| `skill-gailan-episode-generate.md` | skill-gailan-episode-generate |
| `skill-juqing-outline-generate.md` | skill-juqing-outline-generate |
| `skill-juese-character-image-generate.md` | skill-juese-character-image-generate |
| `skill-juese-scene-image-generate.md` | skill-juese-scene-image-generate |
| `skill-juese-part-image-generate.md` | skill-juese-part-image-generate |
| `skill-juese-image-review.md` | skill-juese-image-review |
| `skill-jingtou-jingtoubiao-table-generate.md` | skill-jingtou-jingtoubiao-table-generate |
| `skill-jingtou-jingtoubiao-shot-review.md` | skill-jingtou-jingtoubiao-shot-review |
| `skill-jingtou-meimiao-seconds-generate.md` | skill-jingtou-meimiao-seconds-generate |
| `skill-jingtou-wenben-storyboard-generate.md` | skill-jingtou-wenben-storyboard-generate |
| `skill-jingtou-qianbi-pencil-generate.md` | skill-jingtou-qianbi-pencil-generate |
| `skill-chengpian-video-generate.md` | skill-chengpian-video-generate |
| `skill-gongyong-language-generate.md` | skill-gongyong-language-generate |
| `skill-gongyong-panel-generate.md` | skill-gongyong-panel-generate |

剧情统一由 skill-juqing-outline-generate 一次生成 outline、characters、scenes，并进行一次整包审核；人物和场景图片仍使用各自成图 skill。
