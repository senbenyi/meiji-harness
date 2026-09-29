只返回一个合法 JSON 对象，顶层恰为 outline、characters、scenes。outline 是完整大纲字符串，characters 和 scenes 各为带 items 数组的对象。不得用 Markdown 围栏。人物和场景名称跨三部分保持一致，不生成 ID、图片 URL、文件路径或素材 ID，这些由程序分配或保留。
结构示意（尖括号内容仅作说明，实际须填写完整资料）：
{"outline":"<完整大纲，换行用\n转义>","characters":{"items":[{"name":"<人物名>","nationality":"中国","role":"<身份>","gender":"<性别>","era":"<年代>","age":"<年龄>","costume":"<服装>","height":"<身高>","build":"<体型>","features":"<面相>","appearance":"<外貌总述>","prop":"","identity":"<独立身体身份及意识关系>","look":"<按下文十行填写>","clothes":[],"props":[],"hairstyles":[]}]},"scenes":{"items":[{"name":"<场景名>","landmark":"<稳定地标>","light":"<光位>","space":"<布局、方向与通路>","look":"<至少12字的空环境描述>"}]}}

角色字段：`name,nationality,role,gender,era,age,costume,height,build,features,appearance,prop,identity,look,clothes,props,hairstyles`。

look 按顺序写十行，标签固定为：国籍：、姓名：、身份：、性别：、年代：、年龄：、服装：、身高：、体型：、面相：。标签后的内容与对应字段一致，不留空、不写不详。

clothes、props、hairstyles 返回空数组，不编造文件路径。出图背景由程序设为灰白纯色，角色卡不另写背景。

在 scenes.items 中逐项填写 name、landmark、light、space、look。
