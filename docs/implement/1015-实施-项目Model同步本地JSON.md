# 项目Model同步本地JSON实施记录

## 已修改文件
- meiji/server/data/model-repository.js：创建、事务提交、幂等重试及启动时同步完整project至项目目录project.json；临时文件原子替换，权限0600。数据库失败不写镜像，镜像失败报告已提交状态；更新返回storage_warning，内存仍反映数据库。
- meiji/tests/stage02-project-json.test.js：新增4项，覆盖任意字段/参考时长/串行/事件发布顺序、校验失败与回滚、镜像写失败与幂等重试、启动补齐修复及删除。
- meiji/tests/stage02-sqlite.test.js：真实进程数据库提交前后退出，恢复时JSON与Model一致。
- .agents/meiji-dev.md、meiji/dev_docs/制作工作流.md：同步存储说明，SQLite仍为唯一数据来源。

## 验收标准核对
AC-1：创建和字段变化后JSON与SQLite/Model一致。
AC-2：单项目串行，原子替换；失败事务保留旧JSON；无任务历史字段。
AC-3：启动回填/修复与真实进程崩溃恢复通过，删除项目移除文件。
AC-4：落盘失败返回明确警告，不伪造回滚；幂等重试修复且不重复业务变更。

## 测试
基线415项413通过、2失败、0取消。全量419项417通过、2失败、0取消；新增4项通过。最后仅调整内存发布在镜像同步之后，8项存储回归再次全通过。
既有失败：恢复组合failed时旧失败组不再提示继续；S7-07 实际 DOM 保留页面与四标签，状态/原因直读，运行中冻结编辑且允许取消。
git diff --check通过，图谱更新完成。日志/tmp/project-json-final.log。
实际数据库通过只读backup制作隔离副本，1个项目生成JSON并与Model逐字段一致，未修改在线数据库或项目目录。

## 运行待办
当前1个任务运行中，未重启App，避免取消任务。下次重启将自动为现有项目生成 ~/.dsh/storages/meiji/projects/<项目ID>/project.json，此后每次项目Model提交自动同步。JSON不会反向覆盖数据库，不会将旧参考时长自行重算为小段合计；此项仅保证已提交项目值的一致性。
