## 大纲输出

只返回一个合法 JSON 对象，顶层仅含 outline。outline 为非空的完整大纲字符串。不得使用 Markdown 围栏。字符串内换行、双引号和反斜杠必须正确转义。

## 人物输出

只返回一个合法 JSON 对象，顶层仅含 items，items 为非空角色数组。不生成 ID、图片 URL、文件路径或素材 ID，这些由程序分配或保留。姓名沿用大纲。
角色字段：`name,nationality,role,gender,era,age,costume,height,build,features,appearance,prop,identity,look,clothes,props,hairstyles`。

look 按顺序写十行，标签固定为：国籍：、姓名：、身份：、性别：、年代：、年龄：、服装：、身高：、体型：、面相：。标签后的内容与对应字段一致，不留空、不写不详。

clothes、props、hairstyles 返回空数组，不编造文件路径。出图背景由程序设为灰白纯色，角色卡不另写背景。

## 场景输出

只返回一个合法 JSON 对象，顶层仅含 items，items 为非空场景数组。不生成 ID、图片 URL、文件路径或素材 ID，这些由程序分配或保留。场景名称沿用大纲。
逐项填写 name、landmark、light、space、look。
