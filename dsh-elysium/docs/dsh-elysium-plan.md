# dsh-elysium 实施入口

当前产品不再使用固定 2 镜、2 视频的 VMP V1 作为主流程。

- 产品范围：`elysium-product-requirements.md`
- 技术实现：`elysium-technical-design.md`

主生产契约：动态章节；每章严格使用 1 张文生图起始帧、5 张后续关键帧和 6 段动作提示词。旧 `/factory.execute` 仅作为兼容入口保留。
